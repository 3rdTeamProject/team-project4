import { useEffect, useRef, useState } from 'react'
import '../pages/shipping.css'

const POSTCODE_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
let postcodeLoading = null

// 카카오 우편번호 스크립트를 한 번만 불러온다.
function loadPostcode() {
  if (window.daum?.Postcode) return Promise.resolve()
  if (!postcodeLoading) {
    postcodeLoading = new Promise((resolve, reject) => {
      const el = document.createElement('script')
      el.src = POSTCODE_SRC
      el.onload = resolve
      el.onerror = () => { postcodeLoading = null; reject(new Error('postcode load failed')) }
      document.head.appendChild(el)
    })
  }
  return postcodeLoading
}

// 숫자만 남기고 010-1234-5678 / 02-123-4567 / 031-123-4567 모양으로 하이픈을 넣는다.
function formatPhone(value) {
  const d = value.replace(/\D/g, '').slice(0, 11)
  const head = d.startsWith('02') ? 2 : 3
  if (d.length <= head) return d
  const rest = d.slice(head)
  if (rest.length <= 4) return `${d.slice(0, head)}-${rest}`
  return `${d.slice(0, head)}-${rest.slice(0, -4)}-${rest.slice(-4)}`
}

// 배송지 입력란(받는 분, 연락처, 우편번호+주소 찾기, 기본 주소, 상세 주소). 배송지 관리와 교환 화면이 함께 쓴다.
// form: { recipient, phone, zip, address, address_detail }, onChange(key)는 input의 onChange 핸들러를 돌려준다.
// 주소 찾기를 누르면 카카오 우편번호 검색 창을 시트로 띄우고, 고른 우편번호·기본 주소를 form에 채운다.
export default function AddressFields({ form, onChange, idPrefix }) {
  const [finding, setFinding] = useState(false)
  const [failed, setFailed] = useState(false)
  const boxRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!finding) return
    let alive = true
    setFailed(false)
    loadPostcode().then(() => {
      if (!alive || !boxRef.current) return
      new window.daum.Postcode({
        width: '100%',
        height: '100%',
        oncomplete: (data) => {
          onChangeRef.current('zip')({ target: { value: data.zonecode } })
          onChangeRef.current('address')({ target: { value: data.roadAddress || data.address } })
          setFinding(false)
          setTimeout(() => document.getElementById(`${idPrefix}-detail`)?.focus(), 0)
        },
      }).embed(boxRef.current)
    }).catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [finding, idPrefix])

  return (
    <>
      <div className="ship-field">
        <label htmlFor={`${idPrefix}-name`}>받는 분</label>
        <input id={`${idPrefix}-name`} className="ship-input" type="text" autoComplete="off" maxLength={50}
          placeholder="이름을 입력해 주세요" value={form.recipient} onChange={onChange('recipient')} />
      </div>
      <div className="ship-field">
        <label htmlFor={`${idPrefix}-phone`}>연락처</label>
        <input id={`${idPrefix}-phone`} className="ship-input" type="tel" inputMode="tel" autoComplete="off" maxLength={13}
          placeholder="010-0000-0000" value={form.phone} onChange={(e) => onChange('phone')({ target: { value: formatPhone(e.target.value) } })} />
      </div>
      <div className="ship-field">
        <label htmlFor={`${idPrefix}-zip`}>주소</label>
        <div className="ship-zip-row">
          <input id={`${idPrefix}-zip`} className="ship-input" type="text" inputMode="numeric" autoComplete="off" maxLength={5}
            placeholder="우편번호" value={form.zip} onChange={onChange('zip')} />
          <button type="button" className="ship-find" onClick={() => setFinding(true)}>주소 찾기</button>
        </div>
        <input className="ship-input" type="text" autoComplete="off" maxLength={200} aria-label="기본 주소"
          placeholder="기본 주소" value={form.address} onChange={onChange('address')} />
        <input id={`${idPrefix}-detail`} className="ship-input" type="text" autoComplete="off" maxLength={100} aria-label="상세 주소"
          placeholder="상세 주소 (동·호수)" value={form.address_detail} onChange={onChange('address_detail')} />
      </div>
      {finding && (
        <div className="sheet-backdrop" onClick={() => setFinding(false)}>
          <div className="sheet ship-postcode" role="dialog" aria-modal="true" aria-label="우편번호 검색" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div ref={boxRef} className="ship-postcode-box" />
            {failed && <p className="ship-postcode-error">검색 창을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
          </div>
        </div>
      )}
    </>
  )
}
