-- crop_tasks에 '안내용' 표시 컬럼을 추가하고, 오이의 '밭에 석회·퇴비 섞기'를 안내용으로 표시합니다.
-- 안내용 작업은 '심기 전 준비' 화면에 체크 없이 바로 보여주기만 합니다. 서버를 켜기 전에 한 번만 실행하세요.
BEGIN;
ALTER TABLE crop_tasks ADD COLUMN IF NOT EXISTS info_only BOOLEAN NOT NULL DEFAULT false;
UPDATE crop_tasks SET info_only = true
WHERE title = '밭에 석회·퇴비 섞기'
  AND crop_id IN (SELECT id FROM crops WHERE name IN ('오이(봄)', '오이(여름)'));
COMMIT;

-- 확인: 오이(봄)/오이(여름) 각각 1건이어야 합니다.
SELECT c.name, count(*) AS info_tasks
FROM crop_tasks t JOIN crops c ON c.id = t.crop_id
WHERE t.info_only GROUP BY c.name ORDER BY c.name;
