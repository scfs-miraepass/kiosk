import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupClips, clipId, clipPath, CLIP_ID, writeClip } from "@/lib/tts/cache";
import { sinoKorean, ttsText } from "@/lib/tts/text";
import { encodeWav } from "@/lib/tts/wav";

describe("숫자 한글 읽기", () => {
  it.each([
    [0, "영"],
    [1, "일"],
    [3, "삼"],
    [10, "십"],
    [11, "십일"],
    [20, "이십"],
    [37, "삼십칠"],
    [100, "백"],
    [110, "백십"],
    [237, "이백삼십칠"],
    [1000, "천"],
    [2026, "이천이십육"],
    [10000, "만"],
    [12345, "만이천삼백사십오"],
    [1000000, "백만"],
  ])("%i → %s", (n, s) => expect(sinoKorean(n)).toBe(s));

  it("문장 속 숫자를 바꾸고 공백을 정리한다", () => {
    expect(ttsText("  3학년  홍길동님, 12번   주문 ")).toBe("삼학년 홍길동님, 십이번 주문");
    expect(ttsText("오은영 선생님")).toBe("오은영 선생님");
    expect(ttsText("   ")).toBe("");
  });
});

describe("WAV 인코딩", () => {
  it("16비트 모노 헤더와 샘플", () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 2]), 44100);
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
    expect(buf.readUInt16LE(22)).toBe(1);
    expect(buf.readUInt32LE(24)).toBe(44100);
    expect(buf.readUInt32LE(40)).toBe(8);
    expect([0, 1, 2, 3].map((i) => buf.readInt16LE(44 + i * 2))).toEqual([0, 32767, -32767, 32767]);
  });
});

describe("음성 캐시", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tts-cache-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  const DAY = 86_400_000;
  const put = (dir: string, profile: string, text: string, bytes: number, ageDays: number, now: number) => {
    const file = clipPath(dir, clipId(profile, text));
    writeClip(file, Buffer.alloc(bytes));
    const t = new Date(now - ageDays * DAY);
    fs.utimesSync(file, t, t);
    return file;
  };

  it("id 형식을 검사해 경로 밖으로 나가지 못한다", () => {
    expect(CLIP_ID.test(clipId("abcdef12", "삼학년 홍길동님"))).toBe(true);
    expect(() => clipPath("/tmp", "../etc/passwd")).toThrow();
  });

  it("다른 프로필·오래 안 쓴 파일을 지우고 용량 상한을 지킨다", () => {
    const dir = tmp();
    const now = Date.now();
    const old = put(dir, "aaaaaaaa", "오래됨", 100, 61, now);
    const other = put(dir, "bbbbbbbb", "다른 설정", 100, 1, now);
    const a = put(dir, "aaaaaaaa", "가", 400, 30, now);
    const b = put(dir, "aaaaaaaa", "나", 400, 10, now);
    const c = put(dir, "aaaaaaaa", "다", 400, 1, now);

    const r = cleanupClips(dir, { keepProfile: "aaaaaaaa", maxAgeDays: 60, maxBytes: 900, now });
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(other)).toBe(false);
    expect(fs.existsSync(a)).toBe(false); // 상한 900B를 넘어 가장 오래 안 쓴 것부터
    expect(fs.existsSync(b)).toBe(true);
    expect(fs.existsSync(c)).toBe(true);
    expect(r).toMatchObject({ removed: 3, keptFiles: 2, keptBytes: 800 });
  });

  it("폴더가 없어도 실패하지 않는다", () => {
    expect(cleanupClips(path.join(os.tmpdir(), "no-such-tts-dir-xyz")).removed).toBe(0);
  });
});
