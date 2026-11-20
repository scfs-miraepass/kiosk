import { describe, expect, it } from "vitest";
// @ts-expect-error -- 설정 스크립트(.mjs)는 타입 선언이 없다
import { isRelevant } from "../.github/semantic-release/path-filtered-commit-analyzer.mjs";
// @ts-expect-error -- 설정 스크립트(.mjs)는 타입 선언이 없다
import { client, firmware } from "../release.config.mjs";

type Paths = { only?: string[]; ignore?: string[] };
type Config = { tagFormat: string; plugins: (string | [string, Paths])[] };

/** release.config.mjs에서 경로 필터 설정(첫 플러그인)을 꺼낸다 */
const pathsOf = (config: Config) => (config.plugins[0] as [string, Paths])[1];
const CLIENT = pathsOf(client as Config);
const FIRMWARE = pathsOf(firmware as Config);

/** 클라이언트와 펌웨어가 서로의 변경으로 버전이 올라가지 않는지 확인한다. */

describe("릴리스 대상 구분", () => {
  it("태그가 겹치지 않는다 (기기는 firmware-v* 태그만 본다)", () => {
    expect((client as Config).tagFormat).toBe("v${version}");
    expect((firmware as Config).tagFormat).toBe("firmware-v${version}");
  });

  it.each([
    [["components/kiosk/kiosk-app.tsx"], true, false],
    [["scripts/kiosk-device/install.sh"], false, true],
    [["scripts/kiosk-device/install.sh", "components/kiosk/admin/update-section.tsx"], true, true], // 둘 다 바꾼 커밋
    [["scripts/kiosk-device/README.md"], false, false], // 펌웨어 설명서만
    [["scripts/kiosk-device/VERSION"], false, false], // 펌웨어 릴리스 커밋
    [["package.json"], true, false], // 클라이언트 릴리스 커밋
    [[], false, false], // 머지 커밋
  ])("%j → 클라이언트 %s, 펌웨어 %s", (files, client, firmware) => {
    expect(isRelevant(files, CLIENT)).toBe(client);
    expect(isRelevant(files, FIRMWARE)).toBe(firmware);
  });
});
