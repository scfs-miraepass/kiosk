// 바뀐 파일 경로로 커밋을 걸러 @semantic-release/commit-analyzer에 넘깁니다.
// 클라이언트(웹 앱)와 펌웨어(scripts/kiosk-device)가 한 저장소에 있으면서 버전을 따로 올리기 위해 씁니다.
//   only:   이 경로(접두사)의 파일을 바꾼 커밋만 봅니다
//   ignore: 이 경로(접두사)의 파일만 바꾼 커밋은 보지 않습니다
// 나머지 설정은 commit-analyzer에 그대로 넘깁니다.
import { execFileSync } from "node:child_process";
import { analyzeCommits as analyze } from "@semantic-release/commit-analyzer";

const changedFiles = (cwd, hash) =>
  execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", hash], { cwd, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

export function isRelevant(files, { only = [], ignore = [] } = {}) {
  return files.some((file) => (only.length === 0 || only.some((p) => file.startsWith(p))) && !ignore.some((p) => file.startsWith(p)));
}

export async function analyzeCommits(pluginConfig, context) {
  const { only, ignore, ...analyzerConfig } = pluginConfig;
  const commits = context.commits.filter((commit) => isRelevant(changedFiles(context.cwd, commit.hash), { only, ignore }));
  context.logger.log("경로 조건에 맞는 커밋 %d/%d개로 버전을 정합니다", commits.length, context.commits.length);
  return analyze(analyzerConfig, { ...context, commits });
}
