import { describe, expect, it } from "vitest";
import { renderChimeWav } from "@/lib/speech";

describe("직원 알림음 WAV", () => {
  const buf = renderChimeWav(22050);
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));

  it("16비트 모노 PCM WAV 헤더", () => {
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(buf.byteLength - 44);
  });

  it("5초보다 훨씬 짧다 (Android가 음악을 멈추지 않고 줄였다가 돌려주도록)", () => {
    const seconds = v.getUint32(40, true) / 2 / 22050;
    expect(seconds).toBeGreaterThan(0.5);
    expect(seconds).toBeLessThan(1);
  });

  it("소리가 들어 있고 클리핑되지 않는다", () => {
    let peak = 0;
    for (let o = 44; o < buf.byteLength; o += 2) peak = Math.max(peak, Math.abs(v.getInt16(o, true)));
    expect(peak).toBeGreaterThan(0x7fff * 0.2);
    expect(peak).toBeLessThan(0x7fff);
  });
});
