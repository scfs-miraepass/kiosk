/** TTS에 넣을 문장 다듬기 (서버·테스트 공용, 의존성 없음) */

const DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL_UNITS = ["천", "백", "십", ""];
const BIG_UNITS = ["", "만", "억", "조"];

/** 4자리 이하 덩어리: 1234 → 천이백삼십사 (십·백·천 앞의 '일'은 읽지 않는다) */
function chunk(n: number) {
  return String(n)
    .padStart(4, "0")
    .split("")
    .map((d, i) => {
      const v = Number(d);
      if (v === 0) return "";
      return (v === 1 && i < 3 ? "" : DIGITS[v]) + SMALL_UNITS[i];
    })
    .join("");
}

/** 0 이상 정수를 한자어 수사로 읽는다: 3 → 삼, 12 → 십이, 10000 → 만, 2026 → 이천이십육 */
export function sinoKorean(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) return String(n);
  if (n === 0) return "영";
  const parts: string[] = [];
  for (let i = 0; n > 0 && i < BIG_UNITS.length; i++, n = Math.floor(n / 10000)) {
    const c = n % 10000;
    if (c === 0) continue;
    // 10000 → '일만'이 아니라 '만'
    parts.unshift((i > 0 && c === 1 ? "" : chunk(c)) + BIG_UNITS[i]);
  }
  return parts.join("");
}

/**
 * 모델이 아라비아 숫자를 어눌하게 읽어서 한글로 바꿔 넣는다 (3학년 → 삼학년).
 * 공백은 하나로 줄이고 앞뒤를 자른다.
 */
export function ttsText(text: string) {
  return text
    .replace(/\d+/g, (m) => (m.length > 15 ? m : sinoKorean(Number(m))))
    .replace(/\s+/g, " ")
    .trim();
}
