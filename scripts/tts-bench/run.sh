#!/usr/bin/env sh
# 서버 TTS 성능 측정 (Docker만 있으면 됨, 서비스 컨테이너와 별개로 잠깐 돌고 사라짐)
#
#   ./run.sh              # CPU 2코어로 제한해서 측정 (실서비스 예정 값)
#   CPUS=6 ./run.sh       # 제한 없이 비교
#   SCRIPT=clarity.mjs ./run.sh   # 발음 비교 (숫자 표기·품질 단계·속도)
#
# 모델(약 수백 MB 이하)과 npm 패키지는 이 폴더의 model/, node_modules/에 받아 두고 다음 실행 때 재사용한다.
# 결과: out/summary.json, out/*.wav
set -eu
cd "$(dirname "$0")"

CPUS="${CPUS:-2}"
SCRIPT="${SCRIPT:-bench.mjs}"
MODEL="sherpa-onnx-supertonic-3-tts-int8-2026-05-11"
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${MODEL}.tar.bz2"

docker run --rm --cpus="$CPUS" --memory=2g \
  -v "$PWD":/bench -w /bench \
  -e MODEL_DIR="model/${MODEL}" -e THREADS -e STEPS -e SPEEDS -e SID \
  node:24-bookworm-slim sh -c "
    set -e
    if [ ! -d model/${MODEL} ]; then
      apt-get update -qq && apt-get install -y -qq --no-install-recommends curl bzip2 ca-certificates >/dev/null
      mkdir -p model
      echo '모델 받는 중…'
      curl -fL --progress-bar '${MODEL_URL}' | tar xj -C model
      du -sh model/${MODEL}
    fi
    [ -d node_modules/sherpa-onnx-node ] || npm install --no-save --no-audit --no-fund sherpa-onnx-node@2.0.1 >/dev/null
    echo \"CPU 제한: ${CPUS}코어, 메모리 제한: 2GB\"
    node ${SCRIPT}
  "
