"use client";

/**
 * 직원·관리자 화면 음성 재생: 서버에서 만든 안내 음성(lib/tts) + 알림음을 웹 오디오 하나로 차례대로 재생
 *
 * 다른 앱 음악과 공존하기 (실기기 테스트로 정한 방식, public/audio-test.html)
 * - 기기 TTS(speechSynthesis)는 쓰지 않는다. iOS에서 음악을 멈춘 채 돌려주지 않고, 화면을 만지지 않으면 재생되지도 않았다.
 * - <audio>도 쓰지 않는다. iOS가 음악처럼 다뤄 끊긴 뒤 저절로 다시 재생하면서 알림음이 반복됐다.
 * - iOS는 Audio Session을 "ambient"로 지정해 음악을 끊지 않고 섞어 재생한다 (무음 모드면 소리가 나지 않는다).
 * - AudioContext는 "소리 켜기" 제스처에서 하나 만들어 계속 쓴다. 화면을 만지지 않을 때 오는 알림도 재생된다.
 *   전화·다른 앱 때문에 멈추면 다음 재생 때, 또는 화면을 다시 볼 때·만질 때 다시 켠다.
 */

type AudioSessionLike = { type: string };

function applyAmbientSession() {
  if (typeof navigator === "undefined") return;
  const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
  if (!session) return;
  try {
    session.type = "ambient";
  } catch {}
}

applyAmbientSession();

type AudioContextCtor = typeof AudioContext;
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx || ctx.state === "closed") {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

export const audioSupported = () =>
  typeof window !== "undefined" && !!(window.AudioContext ?? (window as Window & { webkitAudioContext?: unknown }).webkitAudioContext);

/** 멈춰 있으면 다시 켠다. 제스처 없이 막히는 경우가 있어 오래 기다리지 않는다 */
async function ensureRunning(c: AudioContext) {
  if (c.state === "running") return true;
  try {
    await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 1500))]);
  } catch {}
  return (c.state as AudioContextState) === "running";
}

let listenersInstalled = false;
function installResumeListeners() {
  if (listenersInstalled || typeof document === "undefined") return;
  listenersInstalled = true;
  const wake = () => {
    if (ctx && ctx.state !== "running" && ctx.state !== "closed") void ctx.resume().catch(() => {});
  };
  document.addEventListener("pointerdown", wake, { passive: true });
  document.addEventListener("keydown", wake);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && wake());
}

/** 자동재생 정책 해제: 사용자 제스처(클릭) 안에서 동기적으로 호출 */
export function unlockAudio() {
  const c = context();
  if (!c) return;
  installResumeListeners();
  void c.resume().catch(() => {});
  // iOS는 제스처 안에서 실제로 무언가를 재생해야 풀린다 (무음 1샘플)
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start();
  } catch {}
}

/* ------------------------------------------------------------------ */
/* 소리 만들기                                                          */
/* ------------------------------------------------------------------ */

const chimeCache = new WeakMap<AudioContext, AudioBuffer>();

/** 2음 알림음 (880Hz → 1318.5Hz, 약 0.7초) */
function chimeBuffer(c: AudioContext) {
  const cached = chimeCache.get(c);
  if (cached) return cached;
  const sr = c.sampleRate;
  const len = Math.ceil(0.68 * sr);
  const buf = c.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const env = (t: number) => {
    if (t < 0 || t >= 0.45) return 0;
    if (t < 0.02) return 0.0001 * Math.pow(0.35 / 0.0001, t / 0.02);
    return 0.35 * Math.pow(0.0001 / 0.35, (t - 0.02) / 0.43);
  };
  for (let n = 0; n < len; n++) {
    const time = n / sr;
    let x = 0;
    [880, 1318.5].forEach((f, i) => {
      const t = time - i * 0.18;
      x += env(t) * Math.sin(2 * Math.PI * f * t);
    });
    d[n] = x;
  }
  chimeCache.set(c, buf);
  return buf;
}

function decode(c: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  // 구형 Safari는 콜백형만 지원한다
  return new Promise((resolve, reject) => {
    const p = c.decodeAudioData(bytes, resolve, reject);
    if (p && typeof p.then === "function") p.then(resolve, reject);
  });
}

function play(c: AudioContext, buf: AudioBuffer): Promise<void> {
  return new Promise((resolve) => {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    const done = () => resolve();
    src.onended = done;
    setTimeout(done, buf.duration * 1000 + 1000); // onended가 안 올 때 대비
    src.start();
  });
}

/* ------------------------------------------------------------------ */
/* 서버 음성 받기                                                       */
/* ------------------------------------------------------------------ */

const FETCH_TIMEOUT_MS = 12_000;
const clipCache = new Map<string, ArrayBuffer>();
const CLIP_CACHE_MAX = 20;

/** 서버 음성 파일 받기 (실패하면 null). 같은 주소는 최근 20개까지 메모리에 둔다 */
export async function fetchClip(url: string, init?: RequestInit): Promise<ArrayBuffer | null> {
  // 옵션 없이 받는 주소(/api/tts/:id)만 캐시한다. id가 같으면 내용도 같다
  const cacheable = !init;
  const hit = cacheable ? clipCache.get(url) : undefined;
  if (hit) return hit;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: "same-origin", ...init, signal: abort.signal });
    if (!res.ok) {
      console.warn("[voice] 음성을 받지 못했어요", url, res.status);
      return null;
    }
    const bytes = await res.arrayBuffer();
    if (cacheable) {
      clipCache.set(url, bytes);
      if (clipCache.size > CLIP_CACHE_MAX) clipCache.delete(clipCache.keys().next().value!);
    }
    return bytes;
  } catch (e) {
    console.warn("[voice] 음성을 받지 못했어요", url, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 차례대로 재생                                                        */
/* ------------------------------------------------------------------ */

export type AnnounceResult = { played: boolean; voice: boolean };
type Job = { chime: boolean; clip: Promise<ArrayBuffer | null> | null; resolve: (r: AnnounceResult) => void };

const queue: Job[] = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const result: AnnounceResult = { played: false, voice: false };
      try {
        const c = context();
        if (c && (await ensureRunning(c))) {
          if (job.chime) {
            await play(c, chimeBuffer(c));
            result.played = true;
          }
          const bytes = await job.clip;
          if (bytes) {
            // decodeAudioData는 넘긴 버퍼를 비우므로 캐시된 원본 대신 복사본을 넘긴다
            await play(c, await decode(c, bytes.slice(0)));
            result.played = result.voice = true;
          }
        } else {
          console.warn("[voice] 오디오가 꺼져 있어 재생하지 못했어요 (소리 켜기를 다시 눌러 주세요)");
        }
      } catch (e) {
        console.warn("[voice] 재생 실패", e);
      }
      job.resolve(result);
    }
  } finally {
    draining = false;
  }
}

/**
 * 알림음과 서버 음성을 차례대로 재생한다 (앞선 안내가 끝난 뒤).
 * 음성 파일은 알림음이 나는 동안 미리 받는다.
 * - url: 서버 음성 주소 (GET). null이면 알림음만
 * - clip: 이미 받고 있는 음성 (관리자 미리 듣기 등)
 */
export function announce(opts: { url?: string | null; clip?: Promise<ArrayBuffer | null>; chime?: boolean }) {
  const clip = opts.clip ?? (opts.url ? fetchClip(opts.url) : null);
  return new Promise<AnnounceResult>((resolve) => {
    queue.push({ chime: opts.chime ?? false, clip, resolve });
    void drain();
  });
}
