"use client";

import { koreanVoice, speechSupported } from "./speech";

/**
 * 키오스크 효과음 + 음성 안내.
 *
 * 효과음은 WebAudio로 그때그때 만든다 (파일이 필요 없고 지연이 거의 없어 라즈베리파이에서도 가볍다).
 * 음성 안내는 다음 순서로 낸다.
 *   1) 녹음 파일: public/sounds/voice/<이름>.mp3 (문장 하나에 필요한 파일이 모두 있을 때)
 *   2) 브라우저 한국어 음성(speechSynthesis): 라즈베리파이 Chromium에는 기본으로 없다
 *   3) 둘 다 없으면 말하지 않는다 (효과음만)
 * 새 안내가 오면 이전 안내는 끊는다. 화면이 바뀌었는데 지난 화면의 안내가 이어지지 않게 하기 위해서다.
 * 실제로 나오는 스피커와 볼륨은 기기 설정(관리자 모드 › 소리)을 따른다.
 */

export type SoundEffect = "tap" | "add" | "remove" | "success" | "error";

export type VoiceLine = { text: string; clips: string[] };

const VOICE_DIR = "/sounds/voice";

// ───────────────────────── 문장 ─────────────────────────

/**
 * 녹음 파일 목록과 내용. public/sounds/voice/README.md와 같아야 한다 (테스트로 확인).
 * 주문번호처럼 바뀌는 부분은 숫자 파일(num-*)을 이어 붙여 읽는다.
 */
export const VOICE_CLIPS = {
  welcome: "어서 오세요. 원하시는 메뉴를 골라 주세요.",
  review: "주문 내역을 확인해 주세요.",
  identify: "학번이나 아이디를 입력해 주세요. 선생님은 이름으로 찾을 수 있어요.",
  pin: "키오스크 결제 비밀번호 여섯 자리를 눌러 주세요.",
  "pin-setup": "처음 오셨네요. 결제할 때 쓸 비밀번호 여섯 자리를 정해 주세요.",
  "pin-confirm": "확인을 위해 같은 숫자를 한 번 더 눌러 주세요.",
  "pin-wrong": "비밀번호가 맞지 않아요. 다시 눌러 주세요.",
  done: "주문이 완료됐어요. 주문번호",
  "done-tail": "번입니다. 음료가 준비되면 불러 드릴게요.",
  error: "결제하지 못했어요. 화면의 안내를 확인해 주세요.",
  "num-0": "영",
  "num-1": "일",
  "num-2": "이",
  "num-3": "삼",
  "num-4": "사",
  "num-5": "오",
  "num-6": "육",
  "num-7": "칠",
  "num-8": "팔",
  "num-9": "구",
  "num-10": "십",
  "num-100": "백",
  "num-1000": "천",
} as const;

export type VoiceClip = keyof typeof VOICE_CLIPS;

const line = (clip: VoiceClip): VoiceLine => ({ text: VOICE_CLIPS[clip], clips: [clip] });

/** 숫자를 한자어 수 읽기 파일로 나눈다. 예: 237 → 이·백·삼·십·칠, 110 → 백·십 (앞의 '일'은 읽지 않음) */
export function numberClips(n: number): VoiceClip[] {
  const value = Math.floor(Math.abs(n));
  if (value === 0) return ["num-0"];
  // 만 이상은 숫자를 하나씩 읽는다 (주문번호는 보통 이보다 작다)
  if (value > 9999) return String(value).split("").map((d) => `num-${d}` as VoiceClip);
  const clips: VoiceClip[] = [];
  const units: [number, VoiceClip | null][] = [
    [1000, "num-1000"],
    [100, "num-100"],
    [10, "num-10"],
    [1, null],
  ];
  for (const [unit, clip] of units) {
    const digit = Math.floor(value / unit) % 10;
    if (digit === 0) continue;
    if (digit > 1 || clip === null) clips.push(`num-${digit}` as VoiceClip);
    if (clip) clips.push(clip);
  }
  return clips;
}

export const VOICE = {
  welcome: () => line("welcome"),
  review: () => line("review"),
  identify: () => line("identify"),
  pin: () => line("pin"),
  pinSetup: () => line("pin-setup"),
  pinConfirm: () => line("pin-confirm"),
  pinWrong: () => line("pin-wrong"),
  error: () => line("error"),
  done: (orderNo: number): VoiceLine => ({
    text: `${VOICE_CLIPS.done} ${orderNo}${VOICE_CLIPS["done-tail"]}`,
    clips: ["done", ...numberClips(orderNo), "done-tail"],
  }),
};

// ───────────────────────── 설정 ─────────────────────────

const enabled = { effects: true, voice: true };

/** 관리자 설정(효과음·음성 안내 켜기/끄기)을 반영한다 */
export function configureKioskSound(next: { effects: boolean; voice: boolean }) {
  enabled.effects = next.effects;
  enabled.voice = next.voice;
  if (!next.voice) stopVoice();
}

// ───────────────────────── 효과음 ─────────────────────────

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

type Note = { freq: number; at: number; length: number; gain: number; type?: OscillatorType };

const EFFECTS: Record<SoundEffect, Note[]> = {
  // 짧고 부드러운 '톡' (계속 눌러도 거슬리지 않게 작게)
  tap: [{ freq: 1250, at: 0, length: 0.05, gain: 0.12 }],
  // 올라가는 두 음: 담았어요
  add: [
    { freq: 660, at: 0, length: 0.09, gain: 0.22 },
    { freq: 990, at: 0.08, length: 0.14, gain: 0.22 },
  ],
  // 내려가는 두 음: 뺐어요
  remove: [
    { freq: 700, at: 0, length: 0.08, gain: 0.18 },
    { freq: 470, at: 0.07, length: 0.12, gain: 0.18 },
  ],
  // 밝은 세 음: 주문 완료
  success: [
    { freq: 784, at: 0, length: 0.16, gain: 0.25 },
    { freq: 988, at: 0.12, length: 0.16, gain: 0.25 },
    { freq: 1319, at: 0.24, length: 0.4, gain: 0.25 },
  ],
  // 낮은 두 번: 다시 해 주세요
  error: [
    { freq: 220, at: 0, length: 0.14, gain: 0.22, type: "triangle" },
    { freq: 196, at: 0.18, length: 0.22, gain: 0.22, type: "triangle" },
  ],
};

export function playEffect(effect: SoundEffect) {
  if (!enabled.effects) return;
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime + 0.005;
  for (const note of EFFECTS[effect]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = note.type ?? "sine";
    osc.frequency.value = note.freq;
    const t = now + note.at;
    // 빠르게 올리고 지수로 줄여 '딱' 소리 없이 끝낸다
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(note.gain, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + note.length);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + note.length + 0.02);
  }
}

// ───────────────────────── 음성 안내 ─────────────────────────

/** 이보다 작은 소리는 무음으로 본다 (-45dBFS) */
const SILENCE = 10 ** (-45 / 20);
/** 무음을 자른 뒤 남겨 둘 여유 (초). 문장을 이을 때 사이 간격은 앞 파일 뒤 + 다음 파일 앞 = 약 0.07초 */
const PAD_START = 0.02;
const PAD_END = 0.05;

/**
 * 소리가 있는 구간(초). 녹음·TTS 파일은 앞뒤에 0.1~0.3초 무음이 붙어 있는 경우가 많아,
 * 숫자 파일(삼·십·칠)을 그대로 이어 붙이면 "삼… 십… 칠"처럼 끊겨 들린다. 재생할 때 이 구간만 쓴다.
 */
export function voicedRange(samples: ArrayLike<number>, sampleRate: number): { start: number; end: number } {
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > SILENCE) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const duration = samples.length / sampleRate;
  if (first < 0) return { start: 0, end: duration };
  return { start: Math.max(0, first / sampleRate - PAD_START), end: Math.min(duration, (last + 1) / sampleRate + PAD_END) };
}

type Clip = { buffer: AudioBuffer; start: number; end: number };

/**
 * 녹음 파일: 이름별로 한 번만 받는다. 파일이 없거나(404) 읽을 수 없으면 null로 기억한다.
 * 네트워크 오류처럼 잠깐의 실패는 기억하지 않고 다음 안내 때 다시 받는다 (부팅 직후 망이 늦게 붙어도 복구되도록).
 */
const clipCache = new Map<string, Promise<Clip | null>>();

function loadClip(name: string): Promise<Clip | null> {
  let cached = clipCache.get(name);
  if (!cached) {
    cached = (async () => {
      const ac = audio();
      if (!ac) return null;
      let data: ArrayBuffer;
      try {
        const res = await fetch(`${VOICE_DIR}/${name}.mp3`);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.arrayBuffer();
      } catch {
        clipCache.delete(name);
        return null;
      }
      try {
        // 확장자와 상관없이 내용으로 형식을 알아낸다 (mp3·wav·ogg 등)
        const buffer = await ac.decodeAudioData(data);
        return { buffer, ...voicedRange(buffer.getChannelData(0), buffer.sampleRate) };
      } catch {
        return null;
      }
    })();
    clipCache.set(name, cached);
  }
  return cached;
}

/** 키오스크가 켜질 때 녹음 파일을 미리 받아 둔다 (첫 안내가 늦지 않게) */
export function preloadVoice() {
  for (const name of Object.keys(VOICE_CLIPS)) void loadClip(name);
}

let generation = 0;
let playing: AudioBufferSourceNode[] = [];

export function stopVoice() {
  generation++;
  for (const src of playing) {
    try {
      src.stop();
    } catch {}
  }
  playing = [];
  if (speechSupported()) window.speechSynthesis.cancel();
}

/** 안내를 말한다. 이전 안내는 끊는다. */
export async function speak(voiceLine: VoiceLine) {
  stopVoice();
  if (!enabled.voice) return;
  const mine = generation;

  const clips = await Promise.all(voiceLine.clips.map(loadClip));
  if (mine !== generation) return; // 기다리는 사이 다른 안내가 왔다
  const ac = audio();
  if (ac && clips.every((c): c is Clip => c !== null)) {
    // 소리가 있는 구간만 틈 없이 이어서 재생한다 (오디오 스레드가 시각에 맞춰 이어 주므로 메인 스레드가 바빠도 끊기지 않는다)
    let t = ac.currentTime + 0.05;
    playing = clips.map(({ buffer, start, end }) => {
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(ac.destination);
      src.start(t, start, end - start);
      t += end - start;
      return src;
    });
    return;
  }

  const voice = koreanVoice();
  if (!voice) return;
  const u = new SpeechSynthesisUtterance(voiceLine.text);
  u.lang = "ko-KR";
  u.voice = voice;
  window.speechSynthesis.speak(u);
}
