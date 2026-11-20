import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/** 앱 버전 (semantic-release가 package.json에 기록). 키오스크 관리자 모드에 표시한다. */
const { version } = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  transpilePackages: ["@miraepass/api-client"],
  serverExternalPackages: ["better-sqlite3"],
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
