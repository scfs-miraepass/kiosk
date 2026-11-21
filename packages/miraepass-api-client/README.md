# @miraepass/api-client (vendored)

[scfs-miraepass/MIRAE-PASS](https://github.com/scfs-miraepass/MIRAE-PASS) 의 `api-client` 를 그대로 복사한 패키지입니다.

- 원본 커밋: `62a6f96393fe16f6400ded524d995ef115eb1635`
- `src/gen/**` 는 자동 생성 코드이므로 수정하지 않습니다.
- `.github/workflows/sync-api-client.yml` 이 매일 원본을 확인해 `src/gen/**`, `openapi-ts.config.ts` 와 위 원본 커밋을 갱신하는 PR 을 `dev` 로 엽니다.
  (Actions 탭에서 `upstream_ref` 를 지정해 수동 실행할 수도 있습니다.) 원본 커밋 줄의 형식은 워크플로우가 읽으므로 유지해주세요.
- 아래 변경점 파일은 동기화 대상이 아니며, 원본에서 바뀌면 PR 본문에 diff 로 알려줍니다.
- 변경점
  - `src/client.config.ts`: `baseUrl` 을 `MIRAEPASS_API_URL` 환경변수로 지정
  - `package.json`: yarn catalog 의존성을 버전으로 치환, `./client` export 추가
