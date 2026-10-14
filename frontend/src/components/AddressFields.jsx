import '../pages/shipping.css'

// 배송지 입력란(받는 분, 연락처, 우편번호+주소 찾기, 기본 주소, 상세 주소). 배송지 관리와 교환 화면이 함께 쓴다.
// form: { recipient, phone, zip, address, address_detail }, onChange(key)는 input의 onChange 핸들러를 돌려준다.
export default function AddressFields({ form, onChange, onFind, idPrefix }) {
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
          placeholder="010-0000-0000" value={form.phone} onChange={onChange('phone')} />
      </div>
      <div className="ship-field">
        <label htmlFor={`${idPrefix}-zip`}>주소</label>
        <div className="ship-zip-row">
          <input id={`${idPrefix}-zip`} className="ship-input" type="text" inputMode="numeric" autoComplete="off" maxLength={5}
            placeholder="우편번호" value={form.zip} onChange={onChange('zip')} />
          <button type="button" className="ship-find" onClick={onFind}>주소 찾기</button>
        </div>
        <input className="ship-input" type="text" autoComplete="off" maxLength={200} aria-label="기본 주소"
          placeholder="기본 주소" value={form.address} onChange={onChange('address')} />
        <input className="ship-input" type="text" autoComplete="off" maxLength={100} aria-label="상세 주소"
          placeholder="상세 주소 (동·호수)" value={form.address_detail} onChange={onChange('address_detail')} />
      </div>
    </>
  )
}
