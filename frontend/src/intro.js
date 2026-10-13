// 첫 실행 안내(/intro) 완료 여부. 로그인 토큰과는 별개로 localStorage에 둔다.
const KEY = 'introDone'

export const intro = {
  get done() {
    return !!localStorage.getItem(KEY)
  },
  markDone() {
    localStorage.setItem(KEY, '1')
  },
  // /intro?reset 로 들어오면 호출: 안내를 처음 보는 상태로 되돌린다
  reset() {
    localStorage.removeItem(KEY)
  },
}

// 로그인 성공 직후 갈 곳: 안내를 아직 안 봤으면 /intro, 봤으면 /home
export function pathAfterLogin() {
  return intro.done ? '/home' : '/intro'
}
