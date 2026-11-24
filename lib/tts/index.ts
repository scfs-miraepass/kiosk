import fs from "node:fs";
import path from "node:path";
import { getSettings } from "../settings";
import type { VoiceSettings } from "../types";
import { cleanupClips, clipId, clipPath, sha, touchClip, writeClip } from "./cache";
import { MODEL_ID, ttsEngine } from "./engine";
import { ttsText } from "./text";
import { encodeWav } from "./wav";

/**
 * 직원 화면 음성 안내 (서버에서 만든 음성 파일)
 *
 * 기기 TTS는 기기마다 목소리·속도가 다르고, iOS에서는 다른 앱 음악을 멈춘 채 돌려주지 않는다.
 * 그래서 서버가 문장을 WAV로 만들어 두고 직원 화면은 그 파일을 웹 오디오로 재생한다.
 *
 * - 주문이 들어오면 새 주문 안내와 함께 픽업 호출 음성도 미리 만들어, 호출할 때는 기다리지 않는다.
 * - 같은 문장은 디스크 캐시에서 다시 쓴다 (lib/tts/cache.ts).
 * - TTS를 쓸 수 없으면 음성 주소 대신 null을 보내고, 직원 화면은 알림음만 낸다.
 */

// 실행 중에 정해지는 데이터 경로라 빌드 추적 대상에서 뺀다
const CACHE_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.TTS_CACHE_DIR ?? "data/tts-cache");
const SID = Number(process.env.TTS_SID ?? 0) || 0;
const STEPS = Number(process.env.TTS_STEPS ?? 8) || 8;
const MAX_AGE_DAYS = Number(process.env.TTS_CACHE_MAX_AGE_DAYS ?? 60) || 60;
const MAX_BYTES = (Number(process.env.TTS_CACHE_MAX_MB ?? 1024) || 1024) * 1024 * 1024;

type Inflight = Map<string, Promise<boolean>>;
declare global {
  var __ttsInflight: Inflight | undefined;
  var __ttsMaintenance: NodeJS.Timeout | undefined;
}
const inflight = (): Inflight => (globalThis.__ttsInflight ??= new Map());

export const ttsEnabled = () => ttsEngine().enabled;

/** 모델·목소리·품질·속도·안내 문구가 같으면 같은 프로필 (바뀌면 이전 파일을 지운다) */
export function voiceProfile(voice: VoiceSettings) {
  const { newOrder, callStudent, callTeacher, rate } = voice;
  return sha(JSON.stringify([MODEL_ID, SID, STEPS, rate, newOrder, callStudent, callTeacher])).slice(0, 8);
}

export const clipUrl = (id: string) => `/api/tts/${id}`;

/**
 * 문장 음성을 요청하고 id를 돌려준다. 캐시에 있으면 바로, 없으면 백그라운드에서 만든다.
 * TTS를 쓸 수 없거나 읽을 내용이 없으면 null.
 */
export function requestClip(text: string, voice: VoiceSettings = getSettings().voice): string | null {
  const engine = ttsEngine();
  if (!engine.enabled) return null;
  const spoken = ttsText(text);
  if (!spoken) return null;
  const id = clipId(voiceProfile(voice), spoken);
  const file = clipPath(CACHE_DIR, id);
  if (touchClip(file)) return id;

  const jobs = inflight();
  if (!jobs.has(id)) {
    const start = performance.now();
    const job = engine
      .synth(spoken, { sid: SID, numSteps: STEPS, speed: voice.rate })
      .then((audio) => {
        writeClip(file, encodeWav(audio.samples, audio.sampleRate));
        console.log(`[tts] 생성 ${(performance.now() - start).toFixed(0)}ms (대기 포함) ${id}`);
        return true;
      })
      .catch((e) => {
        console.error("[tts] 생성 실패", id, e);
        return false;
      })
      .finally(() => jobs.delete(id));
    jobs.set(id, job);
  }
  return id;
}

/** 음성 주소를 바로 돌려준다 (파일은 아직 만드는 중일 수 있음 — 받는 쪽 요청이 끝날 때까지 기다린다) */
export function requestClipUrl(text: string, voice?: VoiceSettings) {
  const id = requestClip(text, voice);
  return id ? clipUrl(id) : null;
}

/** 음성 파일 읽기. 만드는 중이면 최대 waitMs까지 기다린다. 없으면 null */
export async function readClip(id: string, waitMs = 8000): Promise<Buffer | null> {
  const file = clipPath(CACHE_DIR, id);
  const read = () => {
    try {
      const data = fs.readFileSync(file);
      touchClip(file);
      return data;
    } catch {
      return null;
    }
  };
  const ready = read();
  if (ready) return ready;
  const job = inflight().get(id);
  if (!job) return null;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([job, new Promise((r) => (timer = setTimeout(r, waitMs)))]);
  clearTimeout(timer);
  return read();
}

/** 관리자 미리 듣기: 저장 전 문구·속도로 만들고 캐시하지 않는다 */
export async function synthPreview(text: string, rate: number): Promise<Buffer | null> {
  const spoken = ttsText(text);
  if (!spoken || !ttsEnabled()) return null;
  const audio = await ttsEngine().synth(spoken, { sid: SID, numSteps: STEPS, speed: rate });
  return encodeWav(audio.samples, audio.sampleRate);
}

/** 캐시 정리: 현재 프로필이 아닌 파일, 오래 안 쓴 파일, 용량 상한 초과분 */
export function cleanupTtsCache(voice: VoiceSettings = getSettings().voice) {
  const r = cleanupClips(CACHE_DIR, { keepProfile: voiceProfile(voice), maxAgeDays: MAX_AGE_DAYS, maxBytes: MAX_BYTES });
  if (r.removed) {
    console.log(
      `[tts] 캐시 정리: ${r.removed}개 삭제 (${(r.freedBytes / 1048576).toFixed(1)}MB), 남은 ${r.keptFiles}개 ${(r.keptBytes / 1048576).toFixed(1)}MB`,
    );
  }
  return r;
}

/** 서버 시작 시: 모델을 미리 읽고, 하루 한 번 캐시를 정리한다 */
export function startTtsMaintenance() {
  if (globalThis.__ttsMaintenance || !ttsEnabled()) return;
  void ttsEngine().load();
  const run = () => {
    try {
      cleanupTtsCache();
    } catch (e) {
      console.error("[tts] 캐시 정리 실패", e);
    }
  };
  setTimeout(run, 60_000).unref();
  globalThis.__ttsMaintenance = setInterval(run, 86_400_000);
  globalThis.__ttsMaintenance.unref();
}
