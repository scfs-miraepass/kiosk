import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** 기기 로컬 서비스(Python)의 업데이트 판단 로직을 확인한다. 틀리면 업데이트가 안 되거나 잘못된 버전으로 내려간다. */
const CONTROL = path.join(process.cwd(), "scripts", "kiosk-device", "miraepass-kiosk-control.py");

function py<T>(expr: string): T {
  const code = `
import importlib.util, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("m", ${JSON.stringify(CONTROL)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps(${expr}))
`;
  return JSON.parse(execFileSync("python3", ["-I", "-B", "-c", code], { encoding: "utf8" })) as T;
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

  it("기기 스크립트 VERSION 파일이 앱 버전과 같다 (릴리스할 때 함께 올라감)", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };
    expect(readFileSync(path.join(process.cwd(), "scripts", "kiosk-device", "VERSION"), "utf8").trim()).toBe(pkg.version);
  });

  it("README·숨김 파일·경로가 섞인 이름은 설치하지 않는다", () => {
    const names = ["install.sh", "launch.html", "README.md", ".env", "x.pyc", "../evil.sh", "a/b.sh"];
    expect(py<string[]>(`[n for n in ${JSON.stringify(names)} if m.is_bundle_file(n)]`)).toEqual(["install.sh", "launch.html"]);
  });
});
