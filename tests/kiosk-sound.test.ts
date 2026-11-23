import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { numberClips, VOICE, VOICE_CLIPS, voicedRange } from "@/lib/kiosk-sound";

describe("kiosk voice guide", () => {
  it.each([
    [0, ["num-0"]],
    [7, ["num-7"]],
    [10, ["num-10"]],
    [12, ["num-10", "num-2"]],
    [37, ["num-3", "num-10", "num-7"]],
    [100, ["num-100"]],
    [110, ["num-100", "num-10"]],
    [237, ["num-2", "num-100", "num-3", "num-10", "num-7"]],
    [1005, ["num-1000", "num-5"]],
    [2019, ["num-2", "num-1000", "num-10", "num-9"]],
    [12345, ["num-1", "num-2", "num-3", "num-4", "num-5"]], // 만 이상은 하나씩
  ])("주문번호 %i는 %j로 읽는다", (n, clips) => {
    expect(numberClips(n)).toEqual(clips);
  });

  it("주문 완료 안내는 앞·숫자·뒤 파일을 잇고, 기기 음성용 문장도 만든다", () => {
    expect(VOICE.done(37)).toEqual({
      clips: ["done", "num-3", "num-10", "num-7", "done-tail"],
      text: "주문이 완료됐어요. 주문번호 37번입니다. 음료가 준비되면 불러 드릴게요.",
    });
  });

  it("안내에 쓰는 파일은 모두 목록에 있다", () => {
    const lines = [...Object.values(VOICE).filter((f) => f.length === 0).map((f) => (f as () => { clips: string[] })()), VOICE.done(9876)];
    for (const l of lines) for (const clip of l.clips) expect(Object.keys(VOICE_CLIPS)).toContain(clip);
  });

  it("녹음 파일 안내(README)의 표가 코드의 문장 목록과 같다", () => {
    const readme = readFileSync(path.join(process.cwd(), "public", "sounds", "voice", "README.md"), "utf8");
    const rows = [...readme.matchAll(/^\| `([^`]+)\.mp3` \| (.+?) \|/gm)].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(VOICE_CLIPS);
  });
});

describe("voicedRange", () => {
  const rate = 1000;
  const clip = (lead: number, sound: number, tail: number) => [...Array(lead).fill(0), ...Array(sound).fill(0.5), ...Array(tail).fill(0.001)];

  it("앞뒤 무음을 자르고 앞 0.02초·뒤 0.05초만 남긴다", () => {
    const r = voicedRange(clip(110, 400, 120), rate);
    expect(r.start).toBeCloseTo(0.09);
    expect(r.end).toBeCloseTo(0.56);
  });

  it("무음이 거의 없으면 파일 범위를 넘지 않는다", () => {
    expect(voicedRange(clip(5, 100, 10), rate)).toEqual({ start: 0, end: 0.115 });
  });

  it("전부 무음이면 그대로 둔다", () => {
    expect(voicedRange(clip(50, 0, 50), rate)).toEqual({ start: 0, end: 0.1 });
  });
});
