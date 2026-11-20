#!/usr/bin/env bash
# scfs-miraepass/MIRAE-PASS 의 api-client 를 packages/miraepass-api-client 로 동기화합니다.
# 사용법: sync-api-client.sh <MIRAE-PASS 체크아웃 경로> <결과를 쓸 디렉터리>
#
# - src/gen/** 와 openapi-ts.config.ts 는 원본을 그대로 덮어씁니다.
# - src/client.config.ts, package.json 은 키오스크에서 수정해 쓰므로 덮어쓰지 않고,
#   이전 동기화 커밋 이후 원본에서 바뀐 내용만 <결과 디렉터리>/manual.diff 로 남깁니다.
# - 원본 커밋은 README.md 의 "원본 커밋" 줄에 기록하며, 다음 동기화 때 비교 기준이 됩니다.
#
# GITHUB_OUTPUT 이 있으면 prev_sha, new_sha, changed, manual_diff 를 출력합니다.
set -euo pipefail

UPSTREAM_DIR="${1:?MIRAE-PASS 체크아웃 경로를 지정해주세요}"
OUT_DIR="${2:?결과를 쓸 디렉터리를 지정해주세요}"

PKG_DIR="packages/miraepass-api-client"
SRC_DIR="${UPSTREAM_DIR}/api-client"
README="${PKG_DIR}/README.md"
# 원본과 다르게 수정해서 쓰는 파일 (동기화하지 않고 변경 여부만 알립니다)
MANUAL_FILES=(api-client/src/client.config.ts api-client/package.json)

if [[ ! -d "${SRC_DIR}/src/gen" ]]; then
  echo "[sync] ${SRC_DIR}/src/gen 이 없습니다. 원본 저장소 구조가 바뀌었는지 확인해주세요." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

NEW_SHA=$(git -C "${UPSTREAM_DIR}" rev-parse HEAD)
PREV_SHA=$(sed -n 's/^- 원본 커밋: `\([0-9a-f]\{40\}\)`.*$/\1/p' "${README}" | head -n1)

if [[ -z "${PREV_SHA}" ]]; then
  echo "[sync] ${README} 에서 원본 커밋을 찾지 못했습니다." >&2
  exit 1
fi

echo "[sync] ${PREV_SHA} -> ${NEW_SHA}"

# 생성 코드는 삭제된 파일까지 그대로 반영합니다.
rsync -a --delete "${SRC_DIR}/src/gen/" "${PKG_DIR}/src/gen/"
cp "${SRC_DIR}/openapi-ts.config.ts" "${PKG_DIR}/openapi-ts.config.ts"

# 수동 반영이 필요한 파일의 원본 변경분을 남깁니다.
MANUAL_DIFF="${OUT_DIR}/manual.diff"
: > "${MANUAL_DIFF}"
if [[ "${PREV_SHA}" != "${NEW_SHA}" ]]; then
  if git -C "${UPSTREAM_DIR}" cat-file -e "${PREV_SHA}^{commit}" 2>/dev/null; then
    git -C "${UPSTREAM_DIR}" diff "${PREV_SHA}" "${NEW_SHA}" -- "${MANUAL_FILES[@]}" > "${MANUAL_DIFF}"
  else
    echo "[sync] 원본 저장소에서 이전 커밋 ${PREV_SHA} 를 찾지 못해 수동 반영 파일 비교를 건너뜁니다." >&2
  fi
fi

CHANGED=false
if [[ -n "$(git status --porcelain -- "${PKG_DIR}")" ]]; then
  CHANGED=true
  # 코드가 바뀐 경우에만 기록된 원본 커밋을 올립니다.
  sed -i "s/^- 원본 커밋: \`${PREV_SHA}\`/- 원본 커밋: \`${NEW_SHA}\`/" "${README}"
fi

echo "[sync] changed=${CHANGED}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "prev_sha=${PREV_SHA}"
    echo "new_sha=${NEW_SHA}"
    echo "changed=${CHANGED}"
    echo "manual_diff=$([[ -s "${MANUAL_DIFF}" ]] && echo true || echo false)"
  } >> "${GITHUB_OUTPUT}"
fi
