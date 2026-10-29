// 작물 그림 파일: frontend/public/garden/assets/crops/<이름표>-<번호>.png (번호 = 성장 단계 - 1, 1단계는 그림 파일이 없다)
// 이름표 표는 frontend/public/garden/crop-art.js의 assetByName과 같아야 한다(constants/cropArt.test.js가 같은지 확인한다).
// 표에 없는 새 작물은 괄호 앞 한글 이름이 그대로 이름표다. 예) 배추 → crops/배추-4.png (5단계 그림)
export const ASSET_BY_NAME = {
  '아스파라거스': 'asparagus', '아욱': 'auk', '비트': 'beet', '브로콜리': 'broccoli',
  '부추': 'buchu', '당근': 'carrot', '셀러리': 'celery', '오이': 'cucumber',
  '두릅': 'dureup', '가지': 'eggplant', '마늘': 'garlic', '갓': 'gat',
  '근대': 'geundae', '생강': 'ginger', '고들빼기': 'godeulppaegi', '곰취': 'gomchwi',
  '고사리': 'gosari', '상추': 'lettuce', '미나리': 'minari', '냉이': 'naengi',
  '고추': 'pepper', '감자': 'potato', '무': 'radish', '신선초': 'sinsuncho',
  '시금치': 'spinach', '쑥갓': 'ssukgat', '딸기': 'strawberry', '방울토마토': 'tomato',
  '애호박': 'zucchini',
}

const CROP_IMAGE_DIR = '/garden/assets/crops'

// baseName: 괄호 앞 작물 이름. stage: 1~5(기본 5, 다 자란 모습). 그림 파일이 없는 1단계는 null
export function cropImageUrl(baseName, stage = 5) {
  if (stage < 2) return null
  const key = ASSET_BY_NAME[baseName] ?? baseName
  return `${CROP_IMAGE_DIR}/${encodeURIComponent(key)}-${stage - 1}.png`
}
