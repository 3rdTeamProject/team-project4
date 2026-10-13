import { useLocation, useNavigate } from 'react-router-dom'

// 뒤로가기/닫기 동작을 화면마다 같게 맞춘다: 직전 화면으로 한 단계 되돌아간다.
// 되돌아갈 기록이 없거나(주소로 바로 들어옴), 카카오 로그인에서 막 돌아온 경우(한 단계 뒤가 카카오 화면)에는
// fallback 화면으로 이동한다(기록을 쌓지 않고 바꿔치기).
// 화면을 새로 이동(navigate('/menu'))시키는 방식으로 뒤로가기를 만들면 기록이 쌓여 메뉴와 화면을 오가며 갇힌다.
export function useGoBack(fallback) {
  const navigate = useNavigate()
  const { state } = useLocation()
  return () => {
    const fromKakao = state?.linkFailed || state?.fromKakao
    if (window.history.state?.idx > 0 && !fromKakao) navigate(-1)
    else navigate(fallback, { replace: true })
  }
}
