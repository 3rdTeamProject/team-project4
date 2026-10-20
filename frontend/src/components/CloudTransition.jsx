import './CloudTransition.css'

// 화면을 덮는 구름: 왼쪽·오른쪽 각각 뒤(연한 푸른색)와 앞(흰색) 2겹. 움직임은 useCloudTransition이 정한 phase를 따른다.
export default function CloudTransition({ phase, timing }) {
  if (phase === 'idle') return null
  return (
    <div className="cloud-transition" data-phase={phase} style={timing} aria-hidden="true">
      <div className="cloud cloud-back cloud-left" />
      <div className="cloud cloud-back cloud-right" />
      <div className="cloud cloud-front cloud-left" />
      <div className="cloud cloud-front cloud-right" />
    </div>
  )
}
