# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

# ---------- 공통 베이스 ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------- 의존성 설치용 베이스 ----------
FROM base AS deps-base
# better-sqlite3 프리빌드 바이너리가 없을 때 소스 빌드를 위한 도구
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock .yarnrc ./
COPY packages/miraepass-api-client/package.json packages/miraepass-api-client/package.json

# deps와 prod-deps는 병렬로 빌드되는데 yarn 1 캐시는 동시 쓰기에 안전하지 않으므로
# 캐시 마운트를 sharing=locked로 순서대로 사용하게 합니다.

# ---------- 전체 의존성 (빌드·개발용) ----------
FROM deps-base AS deps
RUN --mount=type=cache,id=yarn-cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile --network-timeout 600000

# ---------- 프로덕션 의존성 (실행용) ----------
FROM deps-base AS prod-deps
RUN --mount=type=cache,id=yarn-cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile --production --network-timeout 600000 \
    # yarn 1은 libc를 구분하지 않아 musl용 바이너리까지 받으므로 제거
    && rm -rf node_modules/@next/swc-*-musl node_modules/@img/*linuxmusl* \
    # better-sqlite3 소스 빌드 중간 산출물 제거
    && rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src \
              node_modules/better-sqlite3/build/Release/obj* node_modules/better-sqlite3/build/deps

# ---------- 개발 (docker-compose.dev.yml 전용) ----------
# 소스는 바인드 마운트로 들어오고, node_modules는 이미지에 설치된 리눅스용을 사용합니다.
FROM deps AS dev
EXPOSE 3000
CMD ["yarn", "dev"]

# ---------- Next 빌드 + 커스텀 서버 번들 ----------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build && yarn build:server

# ---------- 실행 ----------
FROM base AS runner
# 선택: 빌드한 커밋 (기기 스크립트 버전 표시에 붙음). 예: docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD) .
ARG GIT_COMMIT=""
ENV GIT_COMMIT=${GIT_COMMIT}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/cafe.db \
    UPLOAD_DIR=/app/data/uploads

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/next.config.ts ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.next ./.next
# 키오스크 기기가 /api/kiosk/device-bundle 로 받아 가는 기기 스크립트 (업데이트용)
COPY --from=builder /app/scripts/kiosk-device ./scripts/kiosk-device
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN rm -rf .next/cache && mkdir -p data && chown node:node data

# USER는 지정하지 않습니다. 엔트리포인트가 /app/data 권한을 맞춘 뒤 node 사용자로 전환합니다.
EXPOSE 3000
# SQLite DB와 업로드된 메뉴 이미지가 저장되는 위치
VOLUME ["/app/data"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.mjs"]
