"""Image, response-content and prompt regressions; no external API calls."""
import asyncio
import io
import struct
import unittest
import zlib
from types import SimpleNamespace
from unittest.mock import AsyncMock
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
from PIL import Image
from pydantic import ValidationError

from diagnosis import (
    DiagnosisAnalysis, OpenAIDiagnosisService, read_photo,
    MAX_PHOTO_DIMENSION, MAX_PHOTO_PIXELS, MAX_PHOTO_BYTES,
    photo_display_size, validate_photo_content, PHOTO_DECODE_BUDGET_BYTES,
    PHOTO_DECODE_CONCURRENCY, PHOTO_DECODE_BYTES_PER_PIXEL,
)


def photo(fmt="PNG", size=(12, 10)):
    out = io.BytesIO()
    Image.new("RGB", size, "green").save(out, format=fmt)
    return out.getvalue()


def upload(data, mime="image/png"):
    return UploadFile(io.BytesIO(data), filename="untrusted-name.dat", headers=Headers({"content-type": mime}))


def png_dimensions(width, height):
    data = bytearray(photo())
    data[16:24] = struct.pack(">II", width, height)
    data[29:33] = struct.pack(">I", zlib.crc32(data[12:29]))
    return bytes(data)


def outcome(**overrides):
    return dict(status="diagnosed", disease_name="suspected water stress", evidence=["visible wilting"],
                management=["check soil moisture"], additional_checks=[], reason=None,
                retake_guidance=[]) | overrides


class DiagnosisValidationTest(unittest.TestCase):
    def test_reported_jpeg_dimensions_are_within_limits(self):
        # Synthetic regression only; this is not the user's original 001.jpg.
        data = photo("JPEG", (2048, 1365))
        with Image.open(io.BytesIO(data)) as image:
            self.assertEqual(image.width * image.height, 2_795_520)
        self.assertEqual(asyncio.run(read_photo(upload(data, "image/jpeg"), "close", True)), data)

    def test_normal_jpeg_png_webp(self):
        for fmt, mime in [("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp")]:
            with self.subTest(fmt=fmt):
                data = photo(fmt)
                self.assertEqual(asyncio.run(read_photo(upload(data, mime), "close", True)), data)

    def test_corrupted_images_are_rejected(self):
        for fmt, mime in [("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp")]:
            data = photo(fmt)
            for broken in [data[:len(data)//2], data[:12]]:
                with self.subTest(fmt=fmt, length=len(broken)):
                    with self.assertRaises(HTTPException) as error:
                        asyncio.run(read_photo(upload(broken, mime), "close", True))
                    self.assertEqual(error.exception.status_code, 422)
                    self.assertIn("디코딩", error.exception.detail)

    def test_dimension_and_pixel_limits_before_decoding(self):
        for size in [(MAX_PHOTO_DIMENSION+1, 1), (1, MAX_PHOTO_DIMENSION+1), (10000, 10000)]:
            with self.subTest(size=size), self.assertRaises(HTTPException) as error:
                asyncio.run(read_photo(upload(png_dimensions(*size)), "close", True))
            self.assertEqual(error.exception.status_code, 413)

    def test_original_resolution_jpeg_bytes_preserved(self):
        data = photo("JPEG", (6336, 4224))
        self.assertEqual(asyncio.run(read_photo(upload(data, "image/jpeg"), "close", True)), data)

    def test_exif_orientation_preserves_original_bytes(self):
        for orientation in range(1, 9):
            with self.subTest(orientation=orientation):
                image = Image.new("RGB", (30, 20), "green")
                exif = Image.Exif(); exif[274] = orientation
                output = io.BytesIO(); image.save(output, format="JPEG", exif=exif)
                data = output.getvalue()
                with Image.open(io.BytesIO(data)) as decoded:
                    self.assertEqual(photo_display_size(decoded), (20, 30) if orientation >= 5 else (30, 20))
                self.assertEqual(asyncio.run(read_photo(upload(data, "image/jpeg"), "close", True)), data)

    def test_safety_cap_is_derived_from_decode_budget(self):
        self.assertEqual(MAX_PHOTO_PIXELS * PHOTO_DECODE_CONCURRENCY * PHOTO_DECODE_BYTES_PER_PIXEL, PHOTO_DECODE_BUDGET_BYTES)
        # Test the exact boundary without allocating a full-size pixel buffer.
        from diagnosis import _check_photo_dimensions
        _check_photo_dimensions(8192, 8192, "close")
        with self.assertRaises(HTTPException):
            _check_photo_dimensions(8192, 8193, "close")

    def test_concurrent_decode_backpressure_and_slot_release(self):
        entered, release = Event(), Event()
        def decode(*args):
            entered.set()
            if not release.wait(5):
                raise AssertionError("test synchronization timeout")
            raise HTTPException(422, "synthetic corruption")
        with patch("diagnosis.PHOTO_DECODE_WAIT_SECONDS", 0), patch("diagnosis._decode_photo_content", side_effect=decode), ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(validate_photo_content, b"", "image/jpeg", "close")
            try:
                self.assertTrue(entered.wait(2))
                with self.assertRaises(HTTPException) as error:
                    validate_photo_content(b"", "image/jpeg", "close")
                self.assertEqual(error.exception.status_code, 503)
            finally:
                release.set()
            with self.assertRaises(HTTPException):
                first.result(timeout=2)
        # Exception must not leak the decoder slot.
        data = photo()
        validate_photo_content(data, "image/png", "close")

    def test_pixel_boundary_and_byte_limit(self):
        # A narrow image at the dimension boundary is valid and cheap to decode.
        data = photo(size=(MAX_PHOTO_DIMENSION, 1))
        self.assertEqual(asyncio.run(read_photo(upload(data), "close", True)), data)
        with self.assertRaises(HTTPException) as error:
            asyncio.run(read_photo(upload(b"x" * (MAX_PHOTO_BYTES + 1)), "close", True))
        self.assertEqual(error.exception.status_code, 413)

    def test_mime_and_missing_image(self):
        with self.assertRaises(HTTPException):
            asyncio.run(read_photo(upload(photo(), "image/jpeg"), "close", True))
        self.assertIsNone(asyncio.run(read_photo(None, "back", False)))
        with self.assertRaises(HTTPException):
            asyncio.run(read_photo(None, "close", True))

    def test_text_is_trimmed_without_changing_response_keys(self):
        value = DiagnosisAnalysis(**outcome(disease_name="  stress  ", evidence=["  wilting  "], management=[" check soil "]))
        self.assertEqual(value.disease_name, "stress")
        self.assertEqual(value.evidence, ["wilting"])
        self.assertEqual(value.management, ["check soil"])
        self.assertEqual(set(value.model_dump()), set(outcome()))

    def test_blank_names_evidence_and_list_items_are_rejected(self):
        cases = [{"disease_name": " \t"}, {"evidence": []}, {"evidence": [" \n"]},
                 {"management": []}, {"management": [""]}, {"additional_checks": [" "]},
                 {"retake_guidance": [" "]}, {"reason": " "}]
        for overrides in cases:
            with self.subTest(overrides=overrides), self.assertRaises(ValidationError):
                DiagnosisAnalysis(**outcome(**overrides))

    def test_uncertain_requires_reason_and_either_kind_of_guidance(self):
        base = outcome(status="uncertain", disease_name=None, evidence=[], management=[], reason=" not enough detail ")
        for guidance in [{"retake_guidance": [" closer photo "]}, {"additional_checks": [" check watering "]}]:
            result = DiagnosisAnalysis(**(base | guidance))
            self.assertEqual(result.reason, "not enough detail")
        for changes in [{}, {"reason": None, "additional_checks": ["check soil"]},
                        {"reason": " ", "retake_guidance": ["closer"]}]:
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                DiagnosisAnalysis(**(base | changes))

    def test_photo_roles_only_for_present_images_and_environment_prompt(self):
        for slots in [("close",), ("close", "whole"), ("close", "back"), ("close", "whole", "back")]:
            parsed = DiagnosisAnalysis(**outcome())
            parse = AsyncMock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=parsed, refusal=None))]))
            service = OpenAIDiagnosisService(SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=parse))))
            images = {slot: photo() if slot in slots else None for slot in ("close", "whole", "back")}
            asyncio.run(service.analyze("crop", ["symptom"], "description", images, AsyncMock()))
            kwargs = parse.await_args.kwargs
            content = kwargs["messages"][1]["content"]
            self.assertEqual(len(content), 1 + 2 * len(slots))
            for i, slot in enumerate(slots):
                self.assertEqual(content[1+2*i]["type"], "text")
                role = {"close": "근접", "whole": "전체", "back": "뒷면"}[slot]
                self.assertIn(role, content[1+2*i]["text"])
                self.assertEqual(content[2+2*i]["type"], "image_url")
            prompt = kwargs["messages"][0]["content"]
            for term in ["과습", "수분 부족", "영양", "온도", "햇빛", "uncertain", "확정하지"]:
                self.assertIn(term, prompt)
