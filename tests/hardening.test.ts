import { describe, expect, it } from "vitest";
import { rateLimit, rateLimitSize, resetRateLimit } from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { parseUploadPath } from "@/lib/uploads";

describe("parseUploadPath", () => {
  it("파일명과 MIME을 꺼낸다", () => {
    expect(parseUploadPath("/uploads/abc.webp?v=1")).toEqual({ name: "abc.webp", type: "image/webp" });
    expect(parseUploadPath("/uploads/%EC%BB%A4%ED%94%BC.PNG")).toEqual({ name: "커피.PNG", type: "image/png" });
  });

  it("잘못된 퍼센트 인코딩은 예외 대신 null", () => {
    expect(() => parseUploadPath("/uploads/%E0%A4%A")).not.toThrow();
    expect(parseUploadPath("/uploads/%E0%A4%A")).toBeNull();
    expect(parseUploadPath("/uploads/%")).toBeNull();
  });

  it("디렉터리 이동과 허용하지 않는 확장자를 막는다", () => {
    expect(parseUploadPath("/uploads/..%2F..%2Fdata%2Fcafe.db")).toBeNull();
    expect(parseUploadPath("/uploads/..%2Fsecret.png")).toEqual({ name: "secret.png", type: "image/png" });
    expect(parseUploadPath("/uploads/")).toBeNull();
  });
});

describe("csvCell", () => {
  it("수식으로 실행될 수 있는 문자열 앞에 '를 붙인다", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("일반 값과 숫자는 그대로, 쉼표·따옴표·줄바꿈은 따옴표로 감싼다", () => {
    expect(csvCell("아메리카노 x2")).toBe("아메리카노 x2");
    expect(csvCell(-500)).toBe("-500");
    expect(csvCell(null)).toBe("");
    expect(csvCell("a,b")).toBe(`"a,b"`);
    expect(csvCell("줄\n바꿈")).toBe(`"줄\n바꿈"`);
  });
});

describe("rateLimit", () => {
  it("한도를 넘으면 막고, 만료된 키는 주기적으로 지운다", () => {
    resetRateLimit();
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 1_000, t);
    expect(() => rateLimit("k", 3, 1_000, t)).toThrow("잠시 후");
    for (let i = 0; i < 100; i++) rateLimit(`login:${i}`, 10, 1_000, t);
    expect(rateLimitSize()).toBe(101);

    // 창이 지나고 정리 주기가 돌아오면 만료된 키가 사라진다
    rateLimit("k", 3, 1_000, t + 61_000);
    expect(rateLimitSize()).toBe(1);
  });
});
