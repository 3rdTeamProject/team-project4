import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('single and cart checkout preserve click locking, balance refresh, and safe error handling', async () => {
  let slots, cursor, effects, submissions, finish, rejectPurchase, navigations
  globalThis.exchangePageHooks = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = initial
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useEffect: fn => effects.push(fn),
  }
  globalThis.exchangePageRouting = {
    Navigate: ({ to }) => React.createElement('span', { 'data-redirect': to }),
    useNavigate: () => (...args) => navigations.push(args), useParams: () => ({ rewardId: '1' }),
    useLocation: () => ({ state: { ids: [1] } }),
  }
  const reward = { id: 1, reward_id: 1, name: 'mock reward', is_shipping: true, price: 100, quantity: 2 }
  const address = { recipient: 'saved recipient', phone: '01012345678', zip: '12345', address: 'saved road', address_detail: '' }
  globalThis.exchangePageApi = { rewards: async () => [reward], cart: async () => [reward], shippingAddress: async () => address }
  globalThis.exchangePageStorage = { token: 'mock' }
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, plugins: [{
    name: 'exchange-page-doubles', enforce: 'pre',
    transform(source, id) {
      if (!/\/(PointExchange|CartExchange)\.jsx$/.test(id)) return
      return source
        .replace("import { useEffect, useRef, useState } from 'react'", 'const {useEffect,useRef,useState}=globalThis.exchangePageHooks')
        .replace(/import \{ ([^}]+) \} from 'react-router-dom'/, 'const {$1}=globalThis.exchangePageRouting')
        .replace("import { api, storage } from '../api.js'", 'const api=globalThis.exchangePageApi, storage=globalThis.exchangePageStorage')
        .replace("import { useMe } from '../hooks/useMe.js'", "const useMe=()=>({me:{id:1,point:1000,login_type:'kakao'}})")
        .replace("import { useToast } from '../hooks/useToast.js'", "const useToast=()=>['',()=>{}]")
        .replace("import { useGoBack } from '../hooks/useGoBack.js'", 'const useGoBack=()=>()=>{}')
        .replace('  return (', '  globalThis.exchangePageActions={submit,setAgree};\n  return (')
    },
  }] })
  try {
    for (const name of ['PointExchange', 'CartExchange']) {
      slots = []; submissions = []; navigations = []
      globalThis.exchangePageApi.cart = async () => [reward]
      globalThis.exchangePageApi.exchange = body => {
        submissions.push({ body })
        return new Promise((resolve, reject) => { finish = resolve; rejectPurchase = reject })
      }
      const { default: Page } = await server.ssrLoadModule(`/src/pages/${name}.jsx`)
      const render = () => { cursor = 0; effects = []; return renderToStaticMarkup(React.createElement(Page)) }
      render(); effects.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve))
      render()
      globalThis.exchangePageActions.setAgree(true)
      render()
      globalThis.exchangePageActions.submit()
      globalThis.exchangePageActions.submit()
      assert.equal(submissions.length, 1, 'synchronous double click sends one request')
      assert.deepEqual(submissions[0].body.address, address)
      assert.equal(submissions[0].body.items[0].quantity, name === 'CartExchange' ? 2 : 1)
      assert.equal(submissions[0].body.remove_from_cart, name === 'CartExchange' ? true : undefined)
      finish({ order_id: 1 })
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(navigations[0][0], '/pointshop')
      globalThis.exchangePageActions.submit()
      assert.equal(submissions.length, 1, 'success stays locked through navigation')

      // Fresh checkout: definitive rejection permits correction, uncertain
      // response leaves the purchase page and never resends automatically.
      slots = []; navigations = []; submissions = []
      render(); effects.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve))
      render(); globalThis.exchangePageActions.setAgree(true); render()
      globalThis.exchangePageActions.submit()
      rejectPurchase(Object.assign(Error('insufficient points'), { status: 400 }))
      await new Promise(resolve => setImmediate(resolve))
      render()
      assert.equal(navigations.length, 0)
      globalThis.exchangePageActions.submit()
      assert.equal(submissions.length, 2)
      rejectPurchase(Error('response unknown'))
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(navigations[0][1].state.purchaseUncertain, true)
      globalThis.exchangePageActions.submit()
      assert.equal(submissions.length, 2, 'unknown outcome cannot resend while navigating')
      assert.ok(!render().includes('PendingExchange'))

    }
  } finally {
    await server.close()
    for (const name of ['Hooks','Routing','Api','Storage','Actions']) delete globalThis[`exchangePage${name}`]
  }
})
