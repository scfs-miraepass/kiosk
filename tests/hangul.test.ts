import { describe, expect, it } from "vitest";
import { initialsOf, matchesInitials } from "@/lib/hangul";

describe("initialsOf", () => {
  it.each([
    ["홍길동", "ㅎㄱㄷ"],
    ["김선생", "ㄱㅅㅅ"],
    ["가힣", "ㄱㅎ"], // 한글 음절 범위의 처음과 끝
    ["남궁 민수", "ㄴㄱㅁㅅ"], // 공백은 뺀다
    ["김뚜리", "ㄱㄷㄹ"], // 쌍자음은 기본 자음으로 (키패드에 쌍자음 키가 없다)
    ["John", "John"], // 한글이 아니면 그대로
    ["", ""],
  ])("%s → %s", (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});

describe("matchesInitials", () => {
  it("이름 앞부분의 초성이 같을 때만 맞는다", () => {
    expect(matchesInitials("홍길동", "ㅎ")).toBe(true);
    expect(matchesInitials("홍길동", "ㅎㄱ")).toBe(true);
    expect(matchesInitials("홍길동", "ㅎㄱㄷ")).toBe(true);
    expect(matchesInitials("홍길동", "ㄱ")).toBe(false); // 이름 중간의 초성
    expect(matchesInitials("홍길동", "ㅎㄱㄷㅅ")).toBe(false);
  });

  it("초성이 비어 있으면 아무도 맞지 않는다 (전체 명단을 내주지 않는다)", () => {
    expect(matchesInitials("홍길동", "")).toBe(false);
  });
});
