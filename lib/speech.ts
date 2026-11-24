"use client";

/**
 * 브라우저 한국어 음성(speechSynthesis) 고르기 — 키오스크 음성 안내의 대체 수단 (lib/kiosk-sound.ts)
 * 직원·관리자 화면은 서버 음성을 쓴다 (lib/voice-player.ts)
 */

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
