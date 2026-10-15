# 5단계 성장 적용

기존 PostgreSQL/Supabase DB는 아래 SQL을 SQL Editor에서 실행한 뒤 백엔드를 재시작한다. 앱 코드에서 기존 테이블의 제한을 자동 변경하지 않는다.

```sql
BEGIN;
ALTER TABLE plantings DROP CONSTRAINT IF EXISTS plantings_stage_check;
ALTER TABLE plantings ADD CONSTRAINT plantings_stage_check CHECK (stage BETWEEN 1 AND 5);
ALTER TABLE crop_stages DROP CONSTRAINT IF EXISTS crop_stages_stage_no_check;
ALTER TABLE crop_stages ADD CONSTRAINT crop_stages_stage_no_check CHECK (stage_no BETWEEN 1 AND 5);

INSERT INTO crop_stages (crop_id, stage_no, start_day, name)
SELECT c.id, s.stage_no, CEIL(c.total_days * s.ratio)::integer, s.name
FROM crops c
CROSS JOIN (VALUES
  (1, 0.0, '심음'), (2, 0.1, '새싹'), (3, 0.3, '성장'),
  (4, 0.65, '개화'), (5, 1.0, '열매')
) AS s(stage_no, ratio, name)
ON CONFLICT (crop_id, stage_no)
DO UPDATE SET start_day = EXCLUDED.start_day, name = EXCLUDED.name;
COMMIT;
```

노션 공통 설계에 반영할 내용: plantings.stage와 crop_stages.stage_no의 범위가 1~5로 변경됨. 단계는 심음·새싹·성장·개화·열매. 예상 재배 기간의 0%·10%·30%·65%·100%를 기준으로 화면에서 계산하며 모종은 30% 시점부터 시작한다. 현재 비율은 임시 기준이다. 감자는 마지막 단계에서 땅속 덩이줄기를 표시한다. 상추 원본은 개화·열매 그림 대신 기존의 큰 잎 상태를 표시한다.

기존 SQLite DB의 CHECK 제한은 이 SQL로 변경되지 않는다. 이 문서는 PostgreSQL/Supabase용이다.
