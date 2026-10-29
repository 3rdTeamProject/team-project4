import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

// 포인트 획득 카드와 레벨업 팝업이 실제로 그려지는지, 값에 맞는 글자가 나오는지 확인한다.
test('reward effect and level-up modal render points, level and title', async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
  try {
    const { default: RewardEffect } = await server.ssrLoadModule('/src/components/RewardEffect.jsx')
    const { default: LevelUpModal } = await server.ssrLoadModule('/src/components/LevelUpModal.jsx')
    const noop = () => {}
    const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))

    // 80exp(+20 받은 뒤): 받기 전 60exp는 1레벨(0~120) 절반(50%)에서 시작해 80exp(67%)로 차오른다
    const normal = render(RewardEffect, {
      reward: { earned: 20, bonus: 0, firstHarvest: false, motion: true, level: { exp: 80, before: 1, after: 1, leveledUp: false } },
      onDone: noop,
    })
    assert.match(normal, /\+20P/)
    assert.match(normal, /일지를 올렸어요/)
    assert.match(normal, /Lv\.1/)
    assert.match(normal, /견습 농부/)
    assert.match(normal, /\+20 EXP/)
    assert.match(normal, /data-motion="on"/)
    assert.match(normal, /width:50%/)
    assert.doesNotMatch(normal, /첫 수확 보너스/)

    // 움직임을 끄면 처음부터 채운 상태로 보여 준다
    const still = render(RewardEffect, {
      reward: { earned: 20, bonus: 0, firstHarvest: false, motion: false, level: { exp: 80, before: 1, after: 1, leveledUp: false } },
      onDone: noop,
    })
    assert.match(still, /data-motion="off"/)
    assert.match(still, /width:67%/)

    // 첫 수확 보너스와 레벨업(막대는 가득 찬 상태로 끝난다)
    const bonus = render(RewardEffect, {
      reward: { earned: 130, bonus: 120, firstHarvest: true, motion: false, level: { exp: 130, before: 1, after: 2, leveledUp: true } },
      onDone: noop,
    })
    assert.match(bonus, /\+130P/)
    assert.match(bonus, /첫 수확 보너스 \+120P 포함/)
    assert.match(bonus, /width:100%/)
    assert.match(bonus, /첫 수확을 축하해요/)

    // 레벨 정보가 없어도(구버전 응답) 포인트 카드는 그려진다
    const noLevel = render(RewardEffect, {
      reward: { earned: 10, bonus: 0, firstHarvest: false, motion: true, level: null },
      onDone: noop,
    })
    assert.match(noLevel, /\+10P/)
    assert.doesNotMatch(noLevel, /EXP/)

    // 단계가 오르면 문구가 나오고, 포인트가 0이면 +P와 경험치 막대 없이 문구만 나온다
    const grown = render(RewardEffect, {
      reward: { earned: 0, bonus: 0, firstHarvest: false, grownTo: 3, motion: true, level: { exp: 80, before: 1, after: 1, leveledUp: false } },
      onDone: noop,
    })
    assert.match(grown, /일지를 올렸어요/)
    assert.match(grown, /3단계로 자랐어요/)
    assert.doesNotMatch(grown, /\+0P|EXP/)

    // 별칭이 바뀌는 레벨업(2→3): 새 별칭 안내가 나온다
    const titleUp = render(LevelUpModal, { from: 2, to: 3, motion: true, onClose: noop })
    assert.match(titleUp, /레벨 업!/)
    assert.match(titleUp, /Lv\.2 → Lv\.3/)
    assert.match(titleUp, /role="dialog"/)
    assert.match(titleUp, /새 별칭을 얻었어요! 견습 농부 → 초보 농부/)

    // 별칭이 그대로인 레벨업(1→2)에는 새 별칭 안내가 없다
    const sameTitle = render(LevelUpModal, { from: 1, to: 2, motion: false, onClose: noop })
    assert.match(sameTitle, /data-motion="off"/)
    assert.doesNotMatch(sameTitle, /새 별칭/)
  } finally {
    await server.close()
  }
})
