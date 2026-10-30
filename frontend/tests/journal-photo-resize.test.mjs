import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../public/garden/original-photos.js', import.meta.url), 'utf8')
const declaration = source.slice(source.indexOf('async function resizedJournalPhoto('), source.indexOf('async function saveOriginalPhoto('))

test('journal photo keeps its aspect ratio and saves a 2000px JPEG', async () => {
  const calls = []
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ fillRect: (...args) => calls.push(['fill', ...args]), drawImage: (...args) => calls.push(['draw', ...args]) }),
    toBlob: (callback, type, quality) => { calls.push(['encode', type, quality]); callback(new Blob(['jpeg'], { type })) },
  }
  let closed = false
  const resize = runInNewContext(`(${declaration})`, {
    createImageBitmap: async () => ({ width: 4000, height: 3000, close: () => { closed = true } }),
    document: { createElement: () => canvas }, Blob, File, Promise, Math,
  })
  const result = await resize(new File(['input'], 'leaf.png', { type: 'image/png' }))
  assert.deepEqual([canvas.width, canvas.height], [2000, 1500])
  assert.deepEqual(calls.at(-1), ['encode', 'image/jpeg', 0.85])
  assert.equal(result.name, 'leaf.jpg')
  assert.equal(result.type, 'image/jpeg')
  assert.equal(closed, true)
})

test('journal photo rejects files above the 10MB input limit', async () => {
  const resize = runInNewContext(`(${declaration})`, { createImageBitmap: () => { throw new Error('should not decode') } })
  await assert.rejects(resize({ size: 10 * 1024 * 1024 + 1 }), /10MB/)
})
