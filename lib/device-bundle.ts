import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 키오스크 기기 스크립트 묶음 (scripts/kiosk-device).
 * 기기의 로컬 서비스가 /api/kiosk/device-bundle 로 받아 스스로 업데이트한다.
 * 묶음 규칙과 해시 계산은 기기 쪽(miraepass-kiosk-control.py의 bundle_hash)과 반드시 같아야 한다.
 */
export const DEVICE_BUNDLE_DIR = path.join(process.cwd(), "scripts", "kiosk-device");
const EXCLUDE = new Set(["README.md"]);

export type DeviceBundleFile = { path: string; mode: number; sha256: string; content: string };
export type DeviceBundle = { version: string; hash: string; files: DeviceBundleFile[] };

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** sha256("이름\0해시\n" ... 이름순) */
export function bundleHash(entries: { path: string; sha256: string }[]) {
  const h = createHash("sha256");
  for (const e of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    h.update(`${e.path}\0${e.sha256}\n`);
  }
  return h.digest("hex");
}

function appVersion() {
  const { version } = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };
  // Docker 빌드에는 .git이 없으므로 커밋은 빌드 인자(GIT_COMMIT)로만 받는다
  const commit = process.env.GIT_COMMIT?.trim().slice(0, 7);
  return commit ? `${version}+${commit}` : version;
}

export function loadDeviceBundle(dir = DEVICE_BUNDLE_DIR): DeviceBundle {
  const files: DeviceBundleFile[] = readdirSync(dir)
    .filter((name) => !name.startsWith(".") && !EXCLUDE.has(name) && !name.endsWith(".pyc") && statSync(path.join(dir, name)).isFile())
    .sort()
    .map((name) => {
      const content = readFileSync(path.join(dir, name));
      return { path: name, mode: /\.(sh|py)$/.test(name) ? 0o755 : 0o644, sha256: sha256(content), content: content.toString("base64") };
    });
  if (!files.some((f) => f.path === "install.sh")) throw new Error(`기기 스크립트 묶음을 찾을 수 없어요: ${dir}`);
  return { version: appVersion(), hash: bundleHash(files), files };
}

// 실행 중에는 파일이 바뀌지 않으므로 운영 환경에서는 한 번만 읽는다
let cached: DeviceBundle | null = null;
export function getDeviceBundle() {
  if (process.env.NODE_ENV !== "production") return loadDeviceBundle();
  cached ??= loadDeviceBundle();
  return cached;
}
