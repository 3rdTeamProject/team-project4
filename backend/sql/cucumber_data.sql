-- (info_only 컬럼이 먼저 있어야 해요: backend/sql/crop_tasks_info_only.sql 을 먼저 실행)
-- 오이(봄)/오이(여름) 데이터 입력 (crops 2행, crop_stages 5행씩, crop_tasks 16행씩)
-- Supabase SQL Editor에서 한 번에 실행하세요. 다시 실행해도 같은 결과가 됩니다(오이 단계·할 일을 지우고 다시 넣음).
-- points는 임시로 전부 10P입니다. 정해지면 마지막의 "포인트 바꾸기" 예시처럼 고치세요.
BEGIN;

-- 1) 작물: 기존 '오이'(id 3)는 오이(봄)으로 이름을 바꿔 쓰고, 오이(여름)을 추가
UPDATE crops SET name = '오이(봄)', total_days = NULL WHERE name = '오이';
INSERT INTO crops (name) SELECT '오이(여름)' WHERE NOT EXISTS (SELECT 1 FROM crops WHERE name = '오이(여름)');

-- 2) 할 일 원본표(임시)
CREATE TEMP TABLE _cucumber_tasks (
    crop TEXT, title TEXT, points INTEGER, seed_only BOOLEAN, anchor TEXT,
    start_day INTEGER, end_day INTEGER, repeat_min_days INTEGER, repeat_max_days INTEGER,
    after_title TEXT, tip TEXT, how_to TEXT, info_only BOOLEAN DEFAULT false
) ON COMMIT DROP;

INSERT INTO _cucumber_tasks (crop, title, points, seed_only, anchor, start_day, end_day, repeat_min_days, repeat_max_days, after_title, tip, how_to, info_only) VALUES
    ('오이(봄)', '포트에 씨앗 심기', 10, true, 'sow', 0, 3, NULL, NULL, NULL, '4월 초~5월 초에 시작하면 좋아요', '포트에 흙을 채우고 씨앗을 얕게 묻은 뒤 물을 줘요', false),
    ('오이(봄)', '밭에 석회·퇴비 섞기', 10, true, 'sow', 0, 7, NULL, NULL, NULL, '모종을 밭에 옮기기 한 달 전쯤 미리 해 두면 흙이 안정돼요', '밭 전체에 석회와 퇴비를 뿌리고 흙과 섞어요', true),
    ('오이(봄)', '모종 물 주기', 10, true, 'sow', 3, 25, 2, NULL, NULL, '포트 겉흙이 마르면 주세요. 늘 젖어 있으면 뿌리가 상해요', '겉흙이 마르면 물을 줘요', false),
    ('오이(봄)', '밭에 밑거름 주기', 10, true, 'sow', 20, 23, NULL, NULL, NULL, '모종을 옮기기 일주일~열흘 전에 해 두세요', '비료를 밭에 뿌려 흙과 섞어요', false),
    ('오이(봄)', '모종 옮겨심기', 10, true, 'sow', 28, 32, NULL, NULL, NULL, '모종 잎이 3~4장 나오면 옮길 때예요(약 한 달). 맑은 날 오후 4시 전이 좋아요', '구덩이에 물을 먼저 듬뿍 주고 모종을 얕게 심어요. 포기 사이는 35~40cm를 띄워요', false),
    ('오이(봄)', '심은 자리 물 주기', 10, false, 'transplant', 0, 1, NULL, NULL, NULL, '심은 포기 주변에만 주세요', '심은 포기 주변에만 물을 줘요', false),
    ('오이(봄)', '지지대·오이그물 세우기', 10, false, 'transplant', 7, 10, NULL, NULL, NULL, '줄기가 크기 전에 미리 세워야 뿌리가 덜 다쳐요', '지지대 2개를 위에서 X자로 엇갈려 세우고 오이그물을 걸어요', false),
    ('오이(봄)', '줄기 묶어 주기', 10, false, 'transplant', 10, NULL, 7, NULL, NULL, '줄기가 지지대 가까이 자라면 느슨하게 묶어 주세요. 꽉 묶으면 줄기가 굵어지며 눌려요', '줄기를 끈으로 느슨하게 지지대에 묶어요', false),
    ('오이(봄)', '아래쪽 곁가지·꽃 따기', 10, false, 'transplant', 10, 20, NULL, NULL, NULL, '줄기에 마디가 5~6개 생기면 아래쪽 것을 따 주세요. 아래쪽에서 힘을 빼야 위쪽이 잘 커요', '아래쪽 5~6마디의 곁가지와 꽃을 손으로 따요', false),
    ('오이(봄)', '첫 웃거름 주기', 10, false, 'transplant', 25, 35, NULL, NULL, NULL, '심은 지 한 달쯤 됐을 때 주세요', '포기 사이 땅에 비료를 뿌리고 흙을 살짝 덮어요', false),
    ('오이(봄)', '물 주기', 10, false, 'transplant', 3, NULL, 3, NULL, NULL, '흙 겉이 마르면 주세요. 더울수록 자주 필요해요', '포기 주변 흙이 촉촉해지게 줘요', false),
    ('오이(봄)', '잎 살펴보기', 10, false, 'transplant', 7, NULL, 7, NULL, NULL, '일주일에 한 번 잎 앞뒤를 보세요. 얼룩이나 벌레가 보이면 사진을 찍어 AI에 물어보세요', '잎 앞뒤를 보고, 이상하면 사진을 찍어요', false),
    ('오이(봄)', '늙은 잎 정리', 10, false, 'transplant', 30, NULL, 14, NULL, NULL, '아래 잎이 누렇거나 서로 겹쳐서 그늘질 때 잘라 주세요', '아래쪽 누런 잎을 가위로 잘라요', false),
    ('오이(봄)', '줄기 끝 자르기', 10, false, 'transplant', 40, 60, NULL, NULL, NULL, '줄기가 지지대 꼭대기까지 닿으면 끝을 잘라 주세요', '줄기 끝을 가위로 잘라요', false),
    ('오이(봄)', '오이 따기', 10, false, 'transplant', 28, 35, 2, NULL, NULL, '길이 20~25cm쯤 되면 따세요. 아침 일찍이 좋고, 늦게 따면 다음 열매가 작아져요', '꼭지 부분을 가위로 잘라요', false),
    ('오이(봄)', '웃거름 주기 (수확 중)', 10, false, 'transplant', NULL, NULL, 7, 10, '첫 웃거름 주기', '따기를 시작한 뒤 일주일~열흘마다 주세요', '포기 사이 땅에 비료를 뿌려요', false),
    ('오이(여름)', '포트에 씨앗 심기', 10, true, 'sow', 0, 3, NULL, NULL, NULL, '5월 초~6월 하순에 시작하면 좋아요. 더울 때라 모종이 빨리 커요', '포트에 흙을 채우고 씨앗을 얕게 묻은 뒤 물을 줘요', false),
    ('오이(여름)', '밭에 석회·퇴비 섞기', 10, true, 'sow', 0, 7, NULL, NULL, NULL, '모종을 밭에 옮기기 전에 미리 해 두면 흙이 안정돼요', '밭 전체에 석회와 퇴비를 뿌리고 흙과 섞어요', true),
    ('오이(여름)', '모종 물 주기', 10, true, 'sow', 3, 20, 2, NULL, NULL, '더운 때라 포트 흙이 빨리 말라요. 겉흙을 자주 확인하세요', '겉흙이 마르면 물을 줘요', false),
    ('오이(여름)', '밭에 밑거름 주기', 10, true, 'sow', 15, 18, NULL, NULL, NULL, '모종을 옮기기 일주일~열흘 전에 해 두세요', '비료를 밭에 뿌려 흙과 섞어요', false),
    ('오이(여름)', '모종 옮겨심기', 10, true, 'sow', 23, 27, NULL, NULL, NULL, '모종 잎이 3장 나오면 옮길 때예요(약 25일, 한여름엔 20일). 맑은 날 오후 4시 전이 좋아요', '구덩이에 물을 먼저 듬뿍 주고 모종을 얕게 심어요. 포기 사이는 30cm를 띄워요', false),
    ('오이(여름)', '심은 자리 물 주기', 10, false, 'transplant', 0, 4, NULL, NULL, NULL, '3~4일 동안은 시들지 않을 만큼만 적게 주세요. 그다음부터 늘리고, 짚을 덮어 주면 좋아요', '심은 포기 주변에 물을 조금만 주고 흙 위에 짚을 덮어요', false),
    ('오이(여름)', '지지대·오이그물 세우기', 10, false, 'transplant', 7, 10, NULL, NULL, NULL, '줄기가 크기 전에 미리 세워야 뿌리가 덜 다쳐요', '지지대 2개를 위에서 X자로 엇갈려 세우고 오이그물을 걸어요', false),
    ('오이(여름)', '줄기 묶어 주기', 10, false, 'transplant', 10, NULL, 7, NULL, NULL, '줄기가 지지대 가까이 자라면 느슨하게 묶어 주세요. 꽉 묶으면 줄기가 굵어지며 눌려요', '줄기를 끈으로 느슨하게 지지대에 묶어요', false),
    ('오이(여름)', '아래쪽 곁가지·꽃 따기', 10, false, 'transplant', 10, 20, NULL, NULL, NULL, '줄기에 마디가 5~6개 생기면 아래쪽 것을 따 주세요. 아래쪽에서 힘을 빼야 위쪽이 잘 커요', '아래쪽 5~6마디의 곁가지와 꽃을 손으로 따요', false),
    ('오이(여름)', '첫 웃거름 주기', 10, false, 'transplant', 25, 35, NULL, NULL, NULL, '심은 지 한 달쯤 됐을 때 주세요', '포기 사이 땅에 비료를 뿌리고 흙을 살짝 덮어요', false),
    ('오이(여름)', '물 주기', 10, false, 'transplant', 4, NULL, 2, NULL, NULL, '더운 시기라 이틀에 한 번쯤 흙을 확인하세요. 흙 겉이 마르면 주세요', '포기 주변 흙이 촉촉해지게 줘요', false),
    ('오이(여름)', '잎 살펴보기', 10, false, 'transplant', 7, NULL, 7, NULL, NULL, '일주일에 한 번 잎 앞뒤를 보세요. 비가 오래 이어진 뒤엔 특히 잘 보세요', '잎 앞뒤를 보고, 이상하면 사진을 찍어요', false),
    ('오이(여름)', '늙은 잎 정리', 10, false, 'transplant', 30, NULL, 14, NULL, NULL, '아래 잎이 누렇거나 서로 겹쳐서 그늘질 때 잘라 주세요', '아래쪽 누런 잎을 가위로 잘라요', false),
    ('오이(여름)', '줄기 끝 자르기', 10, false, 'transplant', 40, 60, NULL, NULL, NULL, '줄기가 지지대 꼭대기까지 닿으면 끝을 잘라 주세요', '줄기 끝을 가위로 잘라요', false),
    ('오이(여름)', '오이 따기', 10, false, 'transplant', 45, 50, 2, NULL, NULL, '길이 20~25cm쯤 되면 따세요. 아침 일찍이 좋고, 늦게 따면 다음 열매가 작아져요', '꼭지 부분을 가위로 잘라요', false),
    ('오이(여름)', '웃거름 주기 (수확 중)', 10, false, 'transplant', NULL, NULL, 5, 6, '첫 웃거름 주기', '따기를 시작한 뒤 5~6일마다 조금씩 주세요', '포기 사이 땅에 비료를 조금 뿌려요', false);

-- 3) 성장 단계 5개(2단계는 파종 5일 뒤, 3·4·5단계는 아래 4)에서 할 일과 연결)
DELETE FROM crop_stages WHERE crop_id IN (SELECT id FROM crops WHERE name IN ('오이(봄)', '오이(여름)'));
INSERT INTO crop_stages (crop_id, stage_no, start_day, name)
SELECT c.id, n, CASE WHEN n = 2 THEN 5 END, n::text || '단계'
FROM crops c CROSS JOIN generate_series(1, 5) AS n
WHERE c.name IN ('오이(봄)', '오이(여름)');

-- 4) 할 일
DELETE FROM crop_tasks WHERE crop_id IN (SELECT id FROM crops WHERE name IN ('오이(봄)', '오이(여름)'));
-- 먼저 '완료 후 시작'이 아닌 할 일을 넣고
INSERT INTO crop_tasks (crop_id, title, points, seed_only, info_only, anchor, start_day, end_day, repeat_min_days, repeat_max_days, tip, how_to)
SELECT c.id, t.title, t.points, t.seed_only, t.info_only, t.anchor, t.start_day, t.end_day, t.repeat_min_days, t.repeat_max_days, t.tip, t.how_to
FROM _cucumber_tasks t JOIN crops c ON c.name = t.crop
WHERE t.after_title IS NULL;

-- '첫 웃거름 완료 후' 시작하는 할 일은 연결(after_task_id)과 함께 넣는다
INSERT INTO crop_tasks (crop_id, title, points, seed_only, info_only, anchor, start_day, end_day, repeat_min_days, repeat_max_days, after_task_id, tip, how_to)
SELECT c.id, t.title, t.points, t.seed_only, t.info_only, t.anchor, t.start_day, t.end_day, t.repeat_min_days, t.repeat_max_days, a.id, t.tip, t.how_to
FROM _cucumber_tasks t
JOIN crops c ON c.name = t.crop
JOIN crop_tasks a ON a.crop_id = c.id AND a.title = t.after_title
WHERE t.after_title IS NOT NULL;

-- 단계를 올리는 할 일 연결: 3단계=모종 옮겨심기, 4단계=지지대·오이그물 세우기, 5단계=첫 웃거름 주기
UPDATE crop_stages s SET trigger_task_id = ct.id
FROM (VALUES (3, '모종 옮겨심기'), (4, '지지대·오이그물 세우기'), (5, '첫 웃거름 주기')) AS m(stage_no, title)
JOIN crop_tasks ct ON ct.title = m.title
WHERE s.crop_id = ct.crop_id AND s.stage_no = m.stage_no
  AND ct.crop_id IN (SELECT id FROM crops WHERE name IN ('오이(봄)', '오이(여름)'));

COMMIT;

-- 확인: 오이(봄)/오이(여름) 모두 stages 5, tasks 16, 단계 연결 3, 완료 후 연결 1이어야 합니다.
SELECT c.name,
       (SELECT count(*) FROM crop_stages s WHERE s.crop_id = c.id) AS stages,
       (SELECT count(*) FROM crop_stages s WHERE s.crop_id = c.id AND s.trigger_task_id IS NOT NULL) AS stage_triggers,
       (SELECT count(*) FROM crop_tasks t WHERE t.crop_id = c.id) AS tasks,
       (SELECT count(*) FROM crop_tasks t WHERE t.crop_id = c.id AND t.after_task_id IS NOT NULL) AS after_links
FROM crops c WHERE c.name IN ('오이(봄)', '오이(여름)') ORDER BY c.id;

-- 포인트 바꾸기 예시(실행하지 않음):
-- UPDATE crop_tasks SET points = 20 WHERE title = '오이 따기';
