/** 한글 초성 처리 (키오스크의 교사 이름 찾기에서 서버·화면이 함께 사용) */

const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;
/** 한 초성에 딸린 음절 수 (중성 21 × 종성 28) */
const SYLLABLES_PER_INITIAL = 588;

/** 유니코드 초성 순서. 쌍자음은 기본 자음으로 바꿔서 비교한다 (키패드에 쌍자음 키가 없다) */
const INITIALS = ["ㄱ", "ㄱ", "ㄴ", "ㄷ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅂ", "ㅅ", "ㅅ", "ㅇ", "ㅈ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

/** 초성 키패드에 놓는 자음 14개 */
export const INITIAL_KEYS = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"] as const;
export type InitialKey = (typeof INITIAL_KEYS)[number];

/** 이름의 초성: 홍길동 → ㅎㄱㄷ, 김빛나 → ㄱㅂㄴ. 한글 음절이 아닌 글자는 그대로 두고 공백은 뺀다 */
export function initialsOf(text: string): string {
  let out = "";
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    const code = ch.codePointAt(0)!;
    out += code >= SYLLABLE_START && code <= SYLLABLE_END ? INITIALS[Math.floor((code - SYLLABLE_START) / SYLLABLES_PER_INITIAL)] : ch;
  }
  return out;
}

/** 이름의 앞부분 초성이 입력한 초성과 같은지: ("홍길동", "ㅎㄱ") → true */
export function matchesInitials(name: string, initials: string): boolean {
  return initials.length > 0 && initialsOf(name).startsWith(initials);
}
