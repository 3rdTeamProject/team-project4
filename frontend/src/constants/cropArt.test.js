import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ASSET_BY_NAME, cropImageUrl } from './cropArt.js'

test('이름표 표가 농장 화면(public/garden/crop-art.js)과 같다', () => {
  const source = readFileSync(new URL('../../public/garden/crop-art.js', import.meta.url), 'utf8')
  const block = source.match(/const assetByName = (\{[\s\S]*?\});/)[1]
  assert.deepEqual(ASSET_BY_NAME, Function(`return ${block}`)())
})

test('5단계 그림은 -4 파일이고 1단계는 그림 파일이 없다', () => {
  assert.equal(cropImageUrl('방울토마토'), '/garden/assets/crops/tomato-4.png')
  assert.equal(cropImageUrl('무', 2), '/garden/assets/crops/radish-1.png')
  assert.equal(cropImageUrl('무', 1), null)
})

test('표에 없는 새 작물은 한글 이름 파일을 찾는다', () => {
  assert.equal(cropImageUrl('배추'), `/garden/assets/crops/${encodeURIComponent('배추')}-4.png`)
})
