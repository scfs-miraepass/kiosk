#!/bin/sh
set -e

# root로 시작했으면 데이터 디렉터리 소유권을 node로 맞춘 뒤 node 권한으로 실행합니다.
# 바인드 마운트(./data:/app/data)나 이전에 만든 볼륨이 root 소유라면
# node 사용자가 SQLite 파일을 만들지 못해 SQLITE_CANTOPEN이 나기 때문입니다.
if [ "$(id -u)" = "0" ]; then
  DB_DIR="$(dirname "${DATABASE_PATH:-/app/data/cafe.db}")"
  UPLOAD_DIR="${UPLOAD_DIR:-/app/data/uploads}"
  mkdir -p "$DB_DIR" "$UPLOAD_DIR"
  find "$DB_DIR" "$UPLOAD_DIR" ! -user node -exec chown node:node {} +
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
