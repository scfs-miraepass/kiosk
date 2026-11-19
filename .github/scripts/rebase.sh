#!/usr/bin/env bash
# master에 릴리스 커밋이 올라온 뒤 dev를 master 위로 rebase해 두 브랜치의 버전 이력을 맞춥니다.
# 사용법: rebase.sh <rebase할 브랜치> <기준 브랜치>   예) rebase.sh dev master
set -euo pipefail

TARGET_BRANCH="${1:?rebase할 브랜치를 지정해주세요 (예: dev)}"
BASE_BRANCH="${2:?기준 브랜치를 지정해주세요 (예: master)}"

git config advice.detachedHead false
git fetch --no-tags origin "${BASE_BRANCH}" "${TARGET_BRANCH}"

git checkout -B "${TARGET_BRANCH}" "origin/${TARGET_BRANCH}"
TARGET_SHA=$(git rev-parse HEAD)

if git merge-base --is-ancestor "origin/${BASE_BRANCH}" HEAD; then
  echo "[rebase] ${TARGET_BRANCH}에 이미 ${BASE_BRANCH}가 포함되어 있어 건너뜁니다."
  exit 0
fi

# dev의 사전 릴리스 커밋(chore(release): x.y.z-dev.n)은 package.json 버전만 바꾸므로
# master의 릴리스 커밋과 항상 충돌합니다. master 버전을 기준으로 삼도록 rebase 중에 제외합니다.
# 이미 master에 들어간 커밋은 git rebase가 알아서 건너뜁니다.
# (git 버전에 따라 todo 줄이 "pick <sha> # <제목>" 형태일 수 있어 "# "를 선택적으로 매칭합니다.)
export GIT_SEQUENCE_EDITOR="perl -i -pe 's/^pick (?=\\S+ (?:# )?chore\\(release\\): .*\\[skip ci\\]\$)/drop /'"
if ! git rebase -i "origin/${BASE_BRANCH}"; then
  echo "::error::${TARGET_BRANCH}를 ${BASE_BRANCH} 위로 rebase하는 중 충돌이 발생했습니다. 직접 rebase 후 푸시해주세요."
  git status --short || true
  git rebase --abort || true
  exit 1
fi

# rebase 중 다른 푸시가 들어왔다면 덮어쓰지 않고 실패합니다.
git push --force-with-lease="refs/heads/${TARGET_BRANCH}:${TARGET_SHA}" origin "HEAD:refs/heads/${TARGET_BRANCH}"
echo "[rebase] ${TARGET_BRANCH}를 ${BASE_BRANCH}($(git rev-parse --short "origin/${BASE_BRANCH}")) 위로 rebase했습니다."
