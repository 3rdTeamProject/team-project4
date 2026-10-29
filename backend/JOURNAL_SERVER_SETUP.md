# 재배일지 서버 기능 설정

이 변경은 별도 브랜치 `feature/journal-server-history`에 있다. 앱 시작 시 `garden_journal_meta`, `garden_original_photos`, `garden_storage_cleanup` 테이블을 추가하며 기존 테이블의 컬럼이나 기존 기록은 지우지 않는다.

## 원본 사진 저장소

Supabase Storage에 비공개 버킷을 만든 뒤 백엔드 실행 환경에 다음 값을 설정한다. 현재 로컬 `.env`에는 이 설정이 없으므로 원본 업로드 API는 503을 반환하고, 프런트엔드는 기존 브라우저 원본 보기를 사용한다.

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only-key>
GARDEN_PHOTO_BUCKET=<private-bucket-name>
```

서비스 키는 프런트엔드 환경 변수에 넣지 않는다. 기존 일지에 있는 축소 사진은 원본으로 복원할 수 없다. 버킷을 설정한 뒤 새로 올린 원본부터 서버에서 조회할 수 있다.

## 삭제와 되돌리기

`DELETE /garden/history/{planting_id}`는 끝난 재배의 일지, 원본 사진 연결, 할 일 기록, 재배 행을 삭제한다. 지급된 포인트와 포인트 내역은 변경하지 않는다. 삭제된 데이터는 코드 롤백만으로 복구되지 않으므로 운영 환경에서 사용하기 전에 DB와 버킷의 백업 방법을 확인한다.

코드만 되돌릴 때는 이 브랜치를 병합하지 않거나 관련 커밋을 revert한다. 새 테이블은 즉시 삭제하지 않아도 기존 코드의 동작을 막지 않는다. 저장소 파일 삭제가 실패하면 `garden_storage_cleanup`에 경로가 남고 다음 삭제 요청에서 재시도한다.

기존 기록 중 `planting_id`가 없거나 잘못 연결된 기록은 자동으로 특정 재배에 소급 연결하지 않는다. 그런 기록의 지난 재배 삭제는 브라우저 숨김 방식으로 남는다.
