"use client";

/** Web Speech API 래퍼: 한국어 음성 선택 + 큐(겹쳐 말하지 않기) + 알림음 */

type Job = { text: string; rate: number; chime: boolean };

const queue: Job[] = [];
let speaking = false;
let koVoice: SpeechSynthesisVoice | null = null;

export const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

function pickVoice() {
  if (!speechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  const ko = voices.filter((v) => v.lang?.toLowerCase().startsWith("ko"));
  // 품질 좋은 음성 우선 (Google/Yuna/Siri 등)
  koVoice = ko.find((v) => /google|yuna|siri|premium|enhanced/i.test(v.name)) ?? ko[0] ?? null;
  return koVoice;
}

if (speechSupported()) {
  pickVoice();
  window.speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

export function hasKoreanVoice() {
  return !!(koVoice ?? pickVoice());
}

/** 고른 한국어 음성 (없으면 null) */
export function koreanVoice() {
  return koVoice ?? pickVoice();
}

/*
 * 다른 앱 음악과 공존하기
 *
 * 직원 폰에서 음악을 틀어 둔 채로 쓰는 경우가 많다. 오래 살아 있는 AudioContext는 기기의 오디오 출력을
 * 계속 붙잡아서, iOS는 음악을 끊은 채 돌려주지 않고 Android도 음악 앱이 다시 재생되지 않는 일이 생긴다.
 * - 알림음은 5초 미만의 짧은 <audio>로 재생한다. Android Chrome은 이런 소리를 일회성으로 보고
 *   음악을 잠깐 줄였다가 끝나면 돌려준다.
 * - iOS 16.4+ 등 Audio Session API를 지원하면 "transient"로 지정해 음악을 끊지 않고 섞어 재생한다.
 *   (iOS에서는 무음 스위치가 켜져 있으면 알림음이 나지 않는다)
 * - <audio>를 쓸 수 없을 때만 AudioContext를 쓰고, 재생이 끝나면 바로 닫는다.
 * TTS 음성은 OS 음성 엔진이 재생하므로 여기서 제어할 수 없다.
 */

type AudioSessionLike = { type: string };

function applyTransientAudioSession() {
  if (typeof navigator === "undefined") return;
  const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
  if (!session) return;
  try {
    session.type = "transient";
  } catch {}
}

applyTransientAudioSession();

const CHIME_TONES = [880, 1318.5];
const CHIME_GAP = 0.18;
const CHIME_TONE_LEN = 0.5;
const CHIME_PEAK = 0.35;
const CHIME_MS = 650;

/** 톤 하나의 음량: 0.02초 동안 올라갔다가 0.45초에 사라지는 지수 곡선 (예전 WebAudio 알림음과 같은 모양) */
function chimeEnvelope(t: number) {
  const floor = 0.0001;
  if (t < 0 || t >= 0.45) return 0;
  if (t < 0.02) return floor * Math.pow(CHIME_PEAK / floor, t / 0.02);
  return CHIME_PEAK * Math.pow(floor / CHIME_PEAK, (t - 0.02) / 0.43);
}

/** 2음 알림음을 16비트 모노 WAV로 만든다 (외부 파일 불필요, 약 0.7초) */
export function renderChimeWav(sampleRate = 22050): ArrayBuffer {
  const length = Math.ceil(((CHIME_TONES.length - 1) * CHIME_GAP + CHIME_TONE_LEN) * sampleRate);
  const buf = new ArrayBuffer(44 + length * 2);
  const v = new DataView(buf);
  const str = (o: number, x: string) => [...x].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // 모노
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, length * 2, true);
  for (let n = 0; n < length; n++) {
    const time = n / sampleRate;
    let x = 0;
    CHIME_TONES.forEach((freq, i) => {
      const t = time - i * CHIME_GAP;
      x += chimeEnvelope(t) * Math.sin(2 * Math.PI * freq * t);
    });
    v.setInt16(44 + n * 2, Math.round(Math.max(-1, Math.min(1, x)) * 0x7fff), true);
  }
  return buf;
}

let chimeEl: HTMLAudioElement | null = null;

function chimeAudio(): HTMLAudioElement | null {
  if (chimeEl) return chimeEl;
  if (typeof Audio === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return null;
  try {
    const url = URL.createObjectURL(new Blob([renderChimeWav()], { type: "audio/wav" }));
    chimeEl = new Audio(url);
    chimeEl.preload = "auto";
    return chimeEl;
  } catch {
    return null;
  }
}

/** <audio>를 못 쓸 때만: 재생 후 바로 닫는 일회용 AudioContext */
function playChimeWebAudio(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const ctx = new AudioContext();
      const now = ctx.currentTime;
      CHIME_TONES.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = now + i * CHIME_GAP;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(CHIME_PEAK, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + CHIME_TONE_LEN);
      });
      setTimeout(() => {
        void ctx.close().catch(() => {});
        resolve();
      }, CHIME_MS);
    } catch {
      resolve();
    }
  });
}

/** 2음 알림음 */
export function playChime(): Promise<void> {
  const el = chimeAudio();
  if (!el) return playChimeWebAudio();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener("ended", done);
      resolve();
    };
    el.addEventListener("ended", done);
    // ended가 오지 않는 경우 대비
    setTimeout(done, CHIME_MS + 400);
    try {
      el.currentTime = 0;
      el.play().catch(() => {
        // 자동재생 정책 등으로 막히면 소리 없이 넘어간다 (AudioContext로 돌리면 다시 출력을 붙잡는다)
        done();
      });
    } catch {
      done();
    }
  });
}

/** 자동재생 정책 해제: 사용자 제스처 안에서 호출 */
export function unlockAudio() {
  const el = chimeAudio();
  if (el) {
    // 제스처 안에서 한 번 play()하면 이후 이 요소는 자유롭게 재생된다. 바로 멈춰서 소리는 나지 않는다.
    try {
      el.play().catch(() => {});
      el.pause();
      el.currentTime = 0;
    } catch {}
  }
  if (speechSupported()) {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
}

async function drain() {
  if (speaking) return;
  const job = queue.shift();
  if (!job) return;
  speaking = true;
  if (job.chime) await playChime();
  if (speechSupported() && job.text.trim()) {
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(job.text);
      u.lang = "ko-KR";
      u.rate = job.rate;
      const voice = koVoice ?? pickVoice();
      if (voice) u.voice = voice;
      const done = () => resolve();
      u.onend = done;
      u.onerror = done;
      // 일부 브라우저에서 onend가 오지 않는 경우 대비
      setTimeout(done, Math.max(4000, job.text.length * 250));
      window.speechSynthesis.speak(u);
    });
  }
  speaking = false;
  void drain();
}

export function announce(text: string, opts: { rate?: number; chime?: boolean } = {}) {
  queue.push({ text, rate: opts.rate ?? 1, chime: opts.chime ?? true });
  void drain();
}
