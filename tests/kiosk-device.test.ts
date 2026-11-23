import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** 기기 로컬 서비스(Python)의 업데이트 판단 로직을 확인한다. 틀리면 업데이트가 안 되거나 잘못된 버전으로 내려간다. */
const CONTROL = path.join(process.cwd(), "scripts", "kiosk-device", "miraepass-kiosk-control.py");

// Windows의 python3는 Microsoft Store 연결용 껍데기라 실행되지 않는다
const PYTHON = process.platform === "win32" ? "python" : "python3";

function py<T>(expr: string): T {
  const code = `
import importlib.util, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("m", ${JSON.stringify(CONTROL)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps(${expr}))
`;
  return JSON.parse(execFileSync(PYTHON, ["-I", "-B", "-c", code], { encoding: "utf8" })) as T;
}

describe("kiosk device updater", () => {
  it.each([
    ["1.1.2", "1.1.1", true],
    ["1.1.1", "1.1.1", false],
    ["1.1.1", "1.1.1+abc1234.dirty", false], // 저장소에서 설치한 같은 버전
    ["1.1.0", "1.1.1", false], // 내려가지 않는다
    ["1.2.0", "1.2.0-dev.3", true], // 정식 > 프리릴리스
    ["1.2.0-dev.3", "1.2.0", false],
    ["1.2.0-dev.10", "1.2.0-dev.9", true],
    ["v2.0.0", "1.9.9", true],
    ["1.0.0", "unknown", true], // 설치 버전을 모르면 업데이트
    ["not-a-version", "1.0.0", false],
  ])("version_newer(%s, %s) = %s", (latest, current, expected) => {
    expect(py<boolean>(`m.version_newer(${JSON.stringify(latest)}, ${JSON.stringify(current)})`)).toBe(expected);
  });

  it("GitHub contents API와 같은 git blob 해시로 파일을 검증한다", () => {
    // `printf 'hello\\n' | git hash-object --stdin`
    expect(py<string>(`m.git_blob_sha(b"hello\\n")`)).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("펌웨어 VERSION 파일은 semver 버전이다 (펌웨어 릴리스할 때 올라감)", () => {
    const version = readFileSync(path.join(process.cwd(), "scripts", "kiosk-device", "VERSION"), "utf8").trim();
    expect(version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it("펌웨어 태그 중 가장 높은 정식 버전을 고른다 (클라이언트 태그·dev 프리릴리스 제외)", () => {
    const refs = ["v9.0.0", "firmware-v1.3.0", "firmware-v1.10.0", "firmware-v1.9.2", "firmware-v2.0.0-dev.1", "firmware-vbad", "firmware-vv3.0.0"].map((tag) => ({
      ref: `refs/tags/${tag}`,
    }));
    expect(py<unknown>(`m.pick_latest_firmware(${JSON.stringify(refs)})`)).toEqual({ tag: "firmware-v1.10.0", version: "1.10.0" });
    expect(py<unknown>(`m.pick_latest_firmware([{"ref": "refs/tags/v1.0.0"}])`)).toBeNull();
    expect(py<unknown>(`m.pick_latest_firmware({"message": "Not Found"})`)).toBeNull();
  });

  it.each([
    [1.25, 1.25],
    ["1.5", 1.5],
    [2, 2],
    [0.5, 0.5],
    [3.001, 3],
    [0.4, null], // 범위 밖
    [3.5, null],
    ["abc", null],
    [null, null],
    [true, null],
    ["nan", null],
  ])("parse_scale(%j) = %j", (value, expected) => {
    expect(py<number | null>(`m.parse_scale(json.loads(${JSON.stringify(JSON.stringify(value))}))`)).toBe(expected);
  });

  it("화면 비율은 세션 스크립트가 읽는 형식으로 저장한다", () => {
    expect(py<string[]>(`[m.format_scale(x) for x in (1.25, 1.0, 1.5, 2.0, 0.75)]`)).toEqual(["1.25", "1", "1.5", "2", "0.75"]);
  });

  it("README·숨김 파일·경로가 섞인 이름은 설치하지 않는다", () => {
    const names = ["install.sh", "launch.html", "README.md", ".env", "x.pyc", "../evil.sh", "a/b.sh"];
    expect(py<string[]>(`[n for n in ${JSON.stringify(names)} if m.is_bundle_file(n)]`)).toEqual(["install.sh", "launch.html"]);
  });
});

describe("kiosk device audio", () => {
  const cards = [
    { id: "Headphones", kind: "headphones", connected: null },
    { id: "vc4hdmi0", kind: "hdmi", connected: false },
    { id: "vc4hdmi1", kind: "hdmi", connected: true },
  ];

  it.each([
    ["auto", "vc4hdmi1"], // 모니터가 연결된 HDMI 우선
    ["vc4hdmi0", "vc4hdmi0"], // 직접 고른 출력
    ["USB", "vc4hdmi1"], // 고른 장치가 빠져 있으면 자동으로
  ])("resolve_output(%s) = %s", (setting, expected) => {
    expect(py<string | null>(`m.resolve_output(${JSON.stringify(setting)}, json.loads(${JSON.stringify(JSON.stringify(cards))}))`)).toBe(expected);
  });

  it("연결 여부를 모르는 HDMI → 이어폰 잭 순으로 고르고, 장치가 없으면 None", () => {
    const unknown = [
      { id: "Headphones", kind: "headphones", connected: null },
      { id: "vc4hdmi0", kind: "hdmi", connected: null },
    ];
    expect(py<string | null>(`m.resolve_output("auto", json.loads(${JSON.stringify(JSON.stringify(unknown))}))`)).toBe("vc4hdmi0");
    expect(py<string | null>(`m.resolve_output("auto", [{"id": "Headphones", "kind": "headphones", "connected": None}])`)).toBe("Headphones");
    expect(py<string | null>(`m.resolve_output("auto", [])`)).toBeNull();
  });

  it("라즈베리파이 사운드 카드를 화면용 이름으로 바꾼다", () => {
    expect(py<Record<string, string>>(`{k: v for k, v in m.describe_card("vc4hdmi1", "vc4-hdmi", "vc4-hdmi-1").items() if k != "connected"}`)).toEqual({
      kind: "hdmi",
      label: "HDMI 1 (모니터 스피커)",
    });
    expect(py<string>(`m.describe_card("Headphones", "bcm2835_headpho", "bcm2835 Headphones")["kind"]`)).toBe("headphones");
    expect(py<string>(`m.describe_card("Device", "USB-Audio", "USB Audio Device")["label"]`)).toBe("USB 오디오 · USB Audio Device");
  });

  it.each([
    [80, 80],
    ["55", 55],
    [0, 0],
    [100, 100],
    [101, null],
    [-1, null],
    ["abc", null],
    [true, null],
    [null, null],
  ])("parse_volume(%j) = %j", (value, expected) => {
    expect(py<number | null>(`m.parse_volume(json.loads(${JSON.stringify(JSON.stringify(value))}))`)).toBe(expected);
  });

  it("Chromium이 쓰는 ALSA 장치는 고른 카드로 소프트웨어 볼륨을 거친다", () => {
    const conf = py<string>(`m.alsa_conf("vc4hdmi0")`);
    expect(conf).toContain("pcm.miraepass {");
    expect(conf).toContain('slave.pcm "default:CARD=vc4hdmi0"');
    expect(conf).toContain('name "MIRAEPASS Volume"');
    expect(conf).toContain("show on"); // aplay -L 에 보여야 세션 스크립트가 장치를 쓴다
  });

  it("볼륨은 컨트롤 이름 그대로 찾는다 (simple mixer는 ' Volume'을 떼어 'MIRAEPASS'로 보여 sget/sset이 실패한다)", () => {
    expect(py<string>(`m.volume_control_id()`)).toBe("name=MIRAEPASS Volume");
  });

  it("테스트음 크기는 softvol과 같은 곡선을 따른다", () => {
    expect(py<number[]>(`[round(m.volume_gain(v), 3) for v in (0, 50, 100)]`)).toEqual([0, 0.1, 1]);
    // 48kHz 16비트 스테레오 0.72초 + WAV 헤더 44바이트
    expect(py<number>(`len(m.test_tone(80))`)).toBe(44 + Math.round(48000 * 0.25) * 4 + Math.round(48000 * 0.12) * 4 + Math.round(48000 * 0.35) * 4);
  });
});
