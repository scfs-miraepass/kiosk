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

# ---------- 전체 의존성 (빌드·개발용) ----------
FROM deps-base AS deps
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --network-timeout 600000

# ---------- 프로덕션 의존성 (실행용) ----------
FROM deps-base AS prod-deps
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
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
RUN rm -rf .next/cache && mkdir -p data && chown node:node data

USER node
EXPOSE 3000
# SQLite DB와 업로드된 메뉴 이미지가 저장되는 위치
VOLUME ["/app/data"]

CMD ["node", "dist/server.mjs"]
