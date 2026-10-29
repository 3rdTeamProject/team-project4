import { useState } from 'react'
import { cropImageUrl } from '../constants/cropArt.js'
import { SeedIcon, SproutIcon } from './Icons.jsx'
import './crop-image.css'

// 작물 그림. name은 괄호 앞 작물 이름, stage는 성장 단계(기본 5단계=다 자란 모습).
// 1단계(씨앗)는 그림 파일 없이 작은 씨앗을 보여 주고, 그 밖에 그림 파일이 없거나 불러오지 못하면 임시 아이콘(새싹)을 보여 준다. 그림 파일만 추가하면 코드 수정 없이 자동으로 나온다.
export default function CropImage({ name, stage = 5, alt = '', className = '' }) {
  const url = cropImageUrl(name, stage)
  const [failedUrl, setFailedUrl] = useState(null)
  if (stage < 2) {
    return (
      <span className={`crop-image crop-image-empty crop-image-seed ${className}`.trim()} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
        <SeedIcon size={24} />
      </span>
    )
  }
  if (!url || failedUrl === url) {
    return (
      <span className={`crop-image crop-image-empty ${className}`.trim()} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
        <SproutIcon size={24} />
      </span>
    )
  }
  return <img className={`crop-image ${className}`.trim()} src={url} alt={alt} loading="lazy" onError={() => setFailedUrl(url)} />
}
