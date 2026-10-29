import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

test('keeps the unmodified photo for the same user and preview', async () => {
  const values = new Map()
  const db = {
    createObjectStore() {},
    close() {},
    transaction() {
      const tx = {
        objectStore() {
          return {
            put(value, key) { queueMicrotask(() => { values.set(key, value); tx.oncomplete?.() }) },
            get(key) {
              const request = {}
              queueMicrotask(() => { request.result = values.get(key); request.onsuccess?.() })
              return request
            },
          }
        },
      }
      return tx
    },
  }
  const indexedDB = {
    open() {
      const request = { result: db }
      queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.() })
      return request
    },
  }
  const window = { indexedDB, GARDEN_STORAGE_KEY: 'user-1' }
  const source = readFileSync(new URL('../public/garden/original-photos.js', import.meta.url), 'utf8')
  runInNewContext(source, { window, indexedDB, crypto: webcrypto, TextEncoder, Uint8Array, Promise, Array })
  const original = new Blob(['unmodified image bytes'], { type: 'image/png' })
  original.name = 'original.png'
  await window.GardenOriginalPhotos.save('data:image/jpeg;base64,preview', original)
  const loaded = await window.GardenOriginalPhotos.load('data:image/jpeg;base64,preview')
  assert.equal(loaded.name, 'original.png')
  assert.equal(await loaded.blob.text(), 'unmodified image bytes')
  window.GARDEN_STORAGE_KEY = 'user-2'
  assert.equal(await window.GardenOriginalPhotos.load('data:image/jpeg;base64,preview'), null)
})
