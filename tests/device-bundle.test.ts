import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundleHash, DEVICE_BUNDLE_DIR, loadDeviceBundle } from "@/lib/device-bundle";

describe("device bundle", () => {
  it("README를 빼고 설치에 필요한 파일을 담는다", () => {
    const names = loadDeviceBundle().files.map((f) => f.path);
    expect(names).toEqual(expect.arrayContaining(["install.sh", "uninstall.sh", "miraepass-kiosk-control.py", "launch.html"]));
    expect(names).not.toContain("README.md");
  });

  it("해시는 파일 순서와 무관하다", () => {
    const a = { path: "a", sha256: "1" };
    const b = { path: "b", sha256: "2" };
    expect(bundleHash([a, b])).toBe(bundleHash([b, a]));
    expect(bundleHash([a, b])).not.toBe(bundleHash([a, { ...b, sha256: "3" }]));
  });

  it("기기(Python)와 서버(TypeScript)의 묶음 해시가 같다", () => {
    const py = execFileSync("python3", ["-I", path.join(DEVICE_BUNDLE_DIR, "miraepass-kiosk-control.py"), "bundle-hash", DEVICE_BUNDLE_DIR], {
      encoding: "utf8",
    }).trim();
    expect(py).toBe(loadDeviceBundle().hash);
  });
});
