'use strict';

// 서버에는 작은 표시용 JPEG가 저장된다. 원본은 같은 브라우저의 IndexedDB에 보관한다.
const ORIGINAL_PHOTO_DB = 'woori-garden-original-photos';

function openOriginalPhotoDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(ORIGINAL_PHOTO_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function originalPhotoHash(preview) {
  const bytes = new TextEncoder().encode(preview);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function originalPhotoKey(preview) {
  return `${window.GARDEN_STORAGE_KEY}|${await originalPhotoHash(preview)}`;
}

async function saveOriginalPhoto(preview, file) {
  // Storage 설정 전이나 네트워크 오류 때도 현재 브라우저에서는 원본을 볼 수 있게 둔다.
  let uploaded = false;
  try { await hostApi('uploadOriginal', { preview, file }); uploaded = true; } catch {}
  let db;
  try { db = await openOriginalPhotoDb(); } catch (error) { if (!uploaded) throw error; return; }
  try {
    const key = await originalPhotoKey(preview);
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('photos', 'readwrite');
      transaction.objectStore('photos').put({ blob: file, name: file.name, type: file.type }, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) { if (!uploaded) throw error; } finally { db.close(); }
}

async function loadOriginalPhoto(preview) {
  try {
    const original = await hostApi('loadOriginal', { previewHash: await originalPhotoHash(preview) });
    if (original?.blob instanceof Blob) return { blob: original.blob, name: original.name, type: original.blob.type };
  } catch {}
  const db = await openOriginalPhotoDb();
  try {
    const key = await originalPhotoKey(preview);
    return await new Promise((resolve, reject) => {
      const request = db.transaction('photos', 'readonly').objectStore('photos').get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

window.GardenOriginalPhotos = { save: saveOriginalPhoto, load: loadOriginalPhoto };
