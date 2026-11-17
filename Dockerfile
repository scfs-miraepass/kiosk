# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

# ---------- 의존성 설치 ----------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 프리빌드 바이너리가 없을 때 소스 빌드를 위한 도구
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock .yarnrc ./
COPY packages/miraepass-api-client/package.json packages/miraepass-api-client/package.json
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --network-timeout 600000

# ---------- 개발 (docker-compose.dev.yml 전용) ----------
# 소스는 바인드 마운트로 들어오고, node_modules는 이미지에 설치된 리눅스용을 사용합니다.
FROM deps AS dev
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["yarn", "dev"]

# ---------- Next 빌드 ----------
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build \
    # 빌드 중 DB 모듈이 로드되며 생긴 SQLite 파일이 이미지에 들어가지 않도록 제거
    && rm -rf data .next/cache

# ---------- 실행 ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/cafe.db \
    UPLOAD_DIR=/app/data/uploads

# server.ts는 tsx로 실행되므로 소스와 전체 node_modules가 함께 필요합니다.
COPY --from=builder --chown=node:node /app ./
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000
# SQLite DB와 업로드된 메뉴 이미지가 저장되는 위치
VOLUME ["/app/data"]

CMD ["node_modules/.bin/tsx", "server.ts"]
