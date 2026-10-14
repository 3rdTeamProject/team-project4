import '../pages/exchange.css'
import AddressFields from './AddressFields.jsx'

// 교환 화면 3종과 장바구니 교환 화면이 함께 쓰는 조각들.

export function ExchangeCard({ title, children }) {
  return (
    <section className="ex-card">
      <h2 className="ex-card-title">{title}</h2>
      {children}
    </section>
  )
}

// 교환 상품 한 줄: (그림), 분류, 이름, 보조 줄(배지, 수량 등), 가격
export function ExchangeLine({ thumb, category, name, sub, badge, badgeClass = '', price }) {
  return (
    <div className="ex-line">
      {thumb && <div className="ex-thumb">{thumb}</div>}
      <div className="ex-line-main">
        {category && <span className="ex-line-cat">{category}</span>}
        <span className="ex-line-name">{name}</span>
        {(badge || sub) && (
          <span className="ex-line-sub">
            {badge && <span className={`ex-badge ${badgeClass}`}>{badge}</span>}
            {sub}
          </span>
        )}
      </div>
      <span className="ex-line-price">{price.toLocaleString()}P</span>
    </div>
  )
}

export function SavedAddress({ address, onChange }) {
  return (
    <>
      <div className="ex-card-head">
        <h2 className="ex-card-title">배송지</h2>
        <button type="button" className="ex-change" aria-label="배송지 변경" onClick={onChange}>변경</button>
      </div>
      <div className="ex-saved">
        <div className="ex-saved-name">
          <span>{address.recipient}</span>
          <span className="ex-saved-tag">저장된 배송지</span>
        </div>
        <span>{address.phone}</span>
        <span>
          {address.address}
          {address.address_detail && (
            <>
              <br />
              {address.address_detail}
            </>
          )}
        </span>
      </div>
    </>
  )
}

function MemoField({ value, onChange }) {
  return (
    <div className="ex-memo">
      <label htmlFor="ex-memo">배송 요청사항</label>
      <input id="ex-memo" className="ship-input" type="text" autoComplete="off" maxLength={200}
        placeholder="예) 문 앞에 놓아 주세요" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

// 배송지 영역. 저장된 배송지를 쓰면 카드 + 변경 버튼, 아니면 입력란 + "다음에도 이 배송지 사용".
// 어느 쪽이든 배송 요청사항(한 줄)을 받는다. hint는 배송지 아래 안내 문구.
export function ShippingBlock({ useSaved, saved, onEdit, form, onField, note, onNote, saveAddress, onSaveAddress, onFind, hint }) {
  if (useSaved) {
    return (
      <section className="ex-card">
        <SavedAddress address={saved} onChange={onEdit} />
        {hint && <p className="ex-hint">{hint}</p>}
        <MemoField value={note} onChange={onNote} />
      </section>
    )
  }
  return (
    <ExchangeCard title="배송지">
      <AddressFields form={form} onChange={onField} onFind={onFind} idPrefix="ex" />
      {hint && <p className="ex-hint">{hint}</p>}
      <MemoField value={note} onChange={onNote} />
      <label className="ex-check">
        <input type="checkbox" checked={saveAddress} onChange={(e) => onSaveAddress(e.target.checked)} />
        다음에도 이 배송지 사용
      </label>
    </ExchangeCard>
  )
}

export function PointsCard({ costLabel, cost, point }) {
  return (
    <ExchangeCard title="포인트 사용">
      <div className="ex-sum"><span>{costLabel}</span><span className="ex-sum-num">{cost.toLocaleString()}P</span></div>
      <div className="ex-sum"><span>내 포인트</span><span className="ex-sum-num">{point.toLocaleString()}P</span></div>
      <hr className="ex-divider" />
      <div className="ex-sum ex-sum-after">
        <span>교환 후 남는 포인트</span>
        <span className="ex-sum-after-num">{(point - cost).toLocaleString()}P</span>
      </div>
    </ExchangeCard>
  )
}

export function RefundNotice() {
  return (
    <div className="ex-notice">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 4l9 16H3zM12 10v4M12 17h.01" />
      </svg>
      <div>교환하면 포인트를 돌려받을 수 없어요.</div>
    </div>
  )
}

// 화면 아래 고정 영역: 확인 체크, 취소 / 교환하기. 체크하기 전에는 교환하기가 눌리지 않는다.
export function ExchangeFooter({ agreeLabel, agree, onAgree, price, busy, onCancel, onSubmit }) {
  return (
    <div className="ex-footer">
      <label className="ex-check">
        <input type="checkbox" checked={agree} onChange={(e) => onAgree(e.target.checked)} />
        {agreeLabel}
      </label>
      <div className="ex-actions">
        <button type="button" className="ex-cancel" onClick={onCancel}>취소</button>
        <button type="button" className="ex-submit" disabled={!agree || busy} onClick={onSubmit}>
          {price.toLocaleString()}P 교환하기
        </button>
      </div>
    </div>
  )
}
