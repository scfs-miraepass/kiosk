// semantic-release 설정. RELEASE_TARGET 환경 변수로 무엇을 릴리스할지 고릅니다.
//   client (기본): 웹 앱(SSR 서버). 태그 v1.2.3 + GitHub 릴리스 + Docker 이미지
//   firmware: 키오스크 기기 스크립트(scripts/kiosk-device). 태그 firmware-v1.2.3, 펌웨어 파일이 바뀐 커밋이 있을 때만 올라갑니다.
//             기기는 이 태그에서 업데이트를 받습니다. GitHub 릴리스는 만들지 않습니다
//             (만들면 '최신 릴리스'가 펌웨어로 바뀌어 클라이언트 릴리스 목록과 섞입니다).
const FIRMWARE_DIR = "scripts/kiosk-device/";
const FIRMWARE_VERSION_FILE = `${FIRMWARE_DIR}VERSION`;
const ANALYZER = "./.github/semantic-release/path-filtered-commit-analyzer.mjs";
const branches = ["master", { name: "dev", prerelease: "dev" }];

export const client = {
  tagFormat: "v${version}",
  branches,
  plugins: [
    // 펌웨어 파일만 바꾼 커밋으로는 클라이언트 버전을 올리지 않습니다
    [ANALYZER, { ignore: [FIRMWARE_DIR] }],
    ["@semantic-release/exec", { prepareCmd: 'echo "NEW_VERSION=${nextRelease.version}" >> build.env && npm pkg set "version=${nextRelease.version}"' }],
    ["@semantic-release/git", { assets: ["package.json"], message: "chore(release): ${nextRelease.version} [skip ci]" }],
    "@semantic-release/github",
  ],
};

export const firmware = {
  tagFormat: "firmware-v${version}",
  branches,
  plugins: [
    // 설명서와 버전 파일만 바뀐 커밋은 펌웨어 변경으로 보지 않습니다
    [ANALYZER, { only: [FIRMWARE_DIR], ignore: [`${FIRMWARE_DIR}README.md`, FIRMWARE_VERSION_FILE] }],
    ["@semantic-release/exec", { prepareCmd: `echo "FIRMWARE_VERSION=\${nextRelease.version}" >> firmware.env && echo "\${nextRelease.version}" > ${FIRMWARE_VERSION_FILE}` }],
    ["@semantic-release/git", { assets: [FIRMWARE_VERSION_FILE], message: "chore(release): firmware ${nextRelease.version} [skip ci]" }],
  ],
};

const target = process.env.RELEASE_TARGET ?? "client";
if (target !== "client" && target !== "firmware") throw new Error(`RELEASE_TARGET은 client 또는 firmware여야 합니다: ${target}`);

export default target === "firmware" ? firmware : client;
