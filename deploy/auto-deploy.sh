#!/bin/bash
# 서버에서 2분마다 실행된다. GitHub main이 바뀌었을 때만 새로 빌드해 앱을 바꾼다.
# 빌드가 실패하면 기존 앱이 그대로 돌아간다.
set -euo pipefail

cd /home/ubuntu/woori-garden

# 빌드가 2분을 넘겨도 다음 실행이 겹치지 않게 한다
exec 9>/tmp/woori-deploy.lock
flock -n 9 || exit 0

git fetch -q origin main
current=$(git rev-parse HEAD)
latest=$(git rev-parse origin/main)
[ "$current" = "$latest" ] && exit 0

echo "배포 시작: ${current:0:7} -> ${latest:0:7}"
git reset -q --hard origin/main
docker compose build
docker compose up -d --no-build
docker image prune -f >/dev/null
echo "배포 완료: ${latest:0:7}"
