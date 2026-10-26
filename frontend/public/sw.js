// 우리텃밭 서비스 워커: 앱 화면 틀(코드·글꼴·이미지)만 폰에 저장해 두고, 서버 데이터(API)는 절대 저장하지 않는다.
// 배포 후 옛 파일이 남지 않도록 화면 틀을 바꿨다면 아래 VERSION 숫자를 올린다.
const VERSION = 'woori-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll([OFFLINE_URL, '/garden/design-tokens.css', '/icon-192.png'])).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

// 화면 틀 파일만 저장 대상이다. 확장자가 없는 주소(서버 API 등)는 건드리지 않는다.
const STATIC_FILE = /\.(?:js|css|png|jpg|jpeg|svg|webp|ico|woff2?|ttf|webmanifest)$/
// 파일 이름에 내용 표식이 붙은 빌드 파일은 바뀔 일이 없으니 저장본을 먼저 쓴다
const HASHED_FILE = /^\/assets\//

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return // 서버 API·외부 글꼴은 그대로 통과

  // 화면 이동: 항상 서버에서 받고, 인터넷이 없으면 안내 페이지
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)))
    return
  }

  if (!STATIC_FILE.test(url.pathname)) return

  if (HASHED_FILE.test(url.pathname)) {
    event.respondWith(caches.match(request).then(hit => hit || fetchAndStore(request)))
    return
  }
  // 농장 화면 파일 등은 이름이 그대로라 최신을 먼저 받고, 인터넷이 없을 때만 저장본을 쓴다
  event.respondWith(fetchAndStore(request).catch(() => caches.match(request)))
})

function fetchAndStore(request) {
  return fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone()
      caches.open(VERSION).then(cache => cache.put(request, copy))
    }
    return response
  })
}
