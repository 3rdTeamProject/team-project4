"""Private Supabase Storage access for original journal photos.

The bucket and service key are server-only settings. No bucket is created here.
"""

import os
from urllib.parse import quote

import httpx
from fastapi import HTTPException


def _settings():
    url = os.getenv('SUPABASE_URL', '').rstrip('/')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
    bucket = os.getenv('GARDEN_PHOTO_BUCKET', '')
    if not all((url, key, bucket)):
        raise HTTPException(503, '원본 사진 저장소가 아직 설정되지 않았습니다.')
    if not url.startswith('https://') or not bucket.replace('-', '').replace('_', '').isalnum():
        raise HTTPException(503, '원본 사진 저장소 설정을 확인해 주세요.')
    return url, key, bucket


def _headers(key, content_type=None):
    result = {'apikey': key, 'Authorization': f'Bearer {key}'}
    if content_type:
        result['Content-Type'] = content_type
    return result


def upload_original(path, data, content_type):
    url, key, bucket = _settings()
    try:
        response = httpx.post(
            f'{url}/storage/v1/object/{quote(bucket)}/{quote(path, safe="/")}',
            content=data, headers=_headers(key, content_type), timeout=30,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(502, '원본 사진을 저장하지 못했습니다.') from error


def download_original(path):
    url, key, bucket = _settings()
    try:
        response = httpx.get(
            f'{url}/storage/v1/object/authenticated/{quote(bucket)}/{quote(path, safe="/")}',
            headers=_headers(key), timeout=30,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(502, '원본 사진을 불러오지 못했습니다.') from error
    return response.content


def remove_originals(paths):
    if not paths:
        return
    url, key, bucket = _settings()
    try:
        response = httpx.request(
            'DELETE', f'{url}/storage/v1/object/{quote(bucket)}',
            json={'prefixes': paths}, headers=_headers(key, 'application/json'), timeout=30,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(502, '원본 사진을 삭제하지 못했습니다.') from error
