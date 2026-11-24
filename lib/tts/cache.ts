import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * 만든 음성 파일 디스크 캐시
 *
 * 파일 이름: <프로필>-<문장 해시>.wav
 * - 프로필: 모델·목소리·품질·속도·안내 문구를 묶은 해시. 설정이 바뀌면 이전 프로필 파일을 한 번에 지운다.
 * - 마지막 사용 시각은 파일 수정 시각(mtime)으로 기록한다 (재생할 때마다 갱신).
 * - 오래 안 쓴 파일(기본 60일)과 전체 용량 상한(기본 1GB)을 넘는 오래된 파일은 정리한다.
 */

export const CLIP_ID = /^[0-9a-f]{8}-[0-9a-f]{24}$/;

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function clipId(profile: string, text: string) {
  return `${profile}-${sha(text).slice(0, 24)}`;
}

export function clipPath(dir: string, id: string) {
  if (!CLIP_ID.test(id)) throw new Error(`잘못된 음성 id: ${id}`);
  return path.join(dir, `${id}.wav`);
}

/** 있으면 마지막 사용 시각을 갱신하고 true */
export function touchClip(file: string) {
  try {
    const now = new Date();
    fs.utimesSync(file, now, now);
    return true;
  } catch {
    return false;
  }
}

/** 임시 파일에 쓴 뒤 이름을 바꿔, 읽는 쪽이 반쯤 쓴 파일을 보지 않게 한다 */
export function writeClip(file: string, data: Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

type Entry = { file: string; name: string; size: number; mtimeMs: number };

function list(dir: string): Entry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: Entry[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      if (st.isFile()) out.push({ file, name, size: st.size, mtimeMs: st.mtimeMs });
    } catch {}
  }
  return out;
}

function remove(e: Entry) {
  try {
    fs.unlinkSync(e.file);
    return true;
  } catch {
    return false;
  }
}

export type CleanupOptions = {
  /** 지우지 않을 프로필. 다른 프로필의 .wav는 모두 지운다 */
  keepProfile?: string;
  maxAgeDays?: number;
  maxBytes?: number;
  now?: number;
};

export type CleanupResult = { removed: number; freedBytes: number; keptFiles: number; keptBytes: number };

export function cleanupClips(dir: string, opts: CleanupOptions = {}): CleanupResult {
  const { keepProfile, maxAgeDays = 60, maxBytes = 1024 ** 3, now = Date.now() } = opts;
  const minMtime = now - maxAgeDays * 86_400_000;
  let removed = 0;
  let freedBytes = 0;
  const kept: Entry[] = [];

  for (const e of list(dir)) {
    const stale =
      // 중단된 쓰기에서 남은 임시 파일 (1시간 넘은 것만)
      (e.name.endsWith(".tmp") && e.mtimeMs < now - 3_600_000) ||
      (e.name.endsWith(".wav") &&
        ((keepProfile !== undefined && !e.name.startsWith(`${keepProfile}-`)) || e.mtimeMs < minMtime));
    if (stale) {
      if (remove(e)) {
        removed++;
        freedBytes += e.size;
      }
    } else if (e.name.endsWith(".wav")) kept.push(e);
  }

  // 용량 상한: 가장 오래 안 쓴 파일부터
  let total = kept.reduce((s, e) => s + e.size, 0);
  kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
  while (total > maxBytes && kept.length) {
    const e = kept.shift()!;
    if (remove(e)) {
      removed++;
      freedBytes += e.size;
      total -= e.size;
    }
  }
  return { removed, freedBytes, keptFiles: kept.length, keptBytes: total };
}
