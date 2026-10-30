'use strict';

// 표시용 사진은 일지에, 확대·다운로드용 사진은 비율을 유지해 줄인 뒤 서버 DB에 저장한다.
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

async function resizedJournalPhoto(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('사진은 10MB 이하로 선택해 주세요.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.type !== 'image/jpeg' || blob.size > 10 * 1024 * 1024) {
      throw new Error('사진을 저장할 수 없어요. 다른 사진을 선택해 주세요.');
    }
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' });
  } finally { bitmap.close(); }
}

async function saveOriginalPhoto(preview, file) {
  const storedPhoto = await resizedJournalPhoto(file);
  const hosted = window.parent !== window;
  if (hosted) await hostApi('uploadOriginal', { preview, file: storedPhoto });
  let db;
  try { db = await openOriginalPhotoDb(); } catch (error) { if (!hosted) throw error; return; }
  try {
    const key = await originalPhotoKey(preview);
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('photos', 'readwrite');
      transaction.objectStore('photos').put({ blob: storedPhoto, name: storedPhoto.name, type: storedPhoto.type }, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) { if (!hosted) throw error; } finally { db.close(); }
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
