"""Make planted versions of root-crop artwork from the preserved full illustrations."""

from pathlib import Path

import numpy as np
from PIL import Image


FRONTEND = Path(__file__).resolve().parents[1]
SOURCE = FRONTEND / "assets" / "crop-source"
DESTINATION = FRONTEND / "public" / "garden" / "assets" / "crops"

# (center x, horizontal radius, edge height, center height)
# The curved lower edge leaves a small, rounded root shoulder above the soil.
CROWNS = {
    "radish-3": (255, 43, 348, 406),
    "radish-4": (255, 55, 318, 392),
    "beet-3": (255, 62, 352, 419),
    "beet-4": (255, 70, 348, 415),
    "carrot-3": (255, 40, 370, 430),
    "carrot-4": (255, 57, 300, 393),
    "garlic-3": (255, 55, 380, 442),
    "garlic-4": (255, 65, 350, 423),
    "ginger-3": (255, 120, 374, 446),
    "ginger-4": (255, 125, 359, 433),
    "potato-4": (255, 170, 392, 462),
}


def planted_image(source: Image.Image, crown: tuple[int, int, int, int]) -> Image.Image:
    pixels = np.array(source.convert("RGBA"), dtype=np.uint8)
    center, radius, edge, middle = crown
    x = np.arange(512, dtype=np.float32)
    y = np.arange(512, dtype=np.float32)[:, None]
    normalized = (x - center) / radius
    cutoff = np.full(512, float(edge), dtype=np.float32)
    inside = np.abs(normalized) <= 1
    cutoff[inside] = edge + (middle - edge) * np.sqrt(1 - normalized[inside] ** 2)

    # Keep foliage intact where leaves hang below the root's shoulder.
    green = pixels[:, :, 1].astype(np.float32) > pixels[:, :, 0].astype(np.float32) * 1.08
    # Feather the exposed root's curved lower edge.
    coverage = np.clip((cutoff[None, :] - y + 0.5) / 2, 0, 1)
    coverage[green] = 1
    pixels[:, :, 3] = np.rint(pixels[:, :, 3] * coverage).astype(np.uint8)
    pixels[pixels[:, :, 3] == 0, :3] = 0
    clipped = Image.fromarray(pixels, "RGBA")
    bounds = clipped.getchannel("A").point(lambda alpha: 255 if alpha > 16 else 0).getbbox()
    if bounds is None:
        raise ValueError("The root mask removed the entire illustration")
    result = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    result.alpha_composite(clipped, (0, 443 - bounds[3]))
    return result


if __name__ == "__main__":
    for name, crown in CROWNS.items():
        with Image.open(SOURCE / f"{name}.png") as source:
            planted_image(source, crown).save(DESTINATION / f"{name}.png", optimize=True)
    print(f"Updated {len(CROWNS)} planted crop illustrations.")
