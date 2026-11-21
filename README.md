# 미래카페 키오스크

순천미래과학고등학교 교내 카페용 주문·결제 시스템입니다. 결제는 학교 자체 포인트인 **MIRAEPASS**로 합니다.

| 화면 | 경로 | 사용 기기 | 설명 |
|---|---|---|---|
| 키오스크 | `/kiosk` | 주문용 태블릿 | 메뉴 선택 → 주문 확인 → MIRAEPASS ID(학번·교사 ID 4자리) → 키오스크 비밀번호 → 검증 → 포인트 차감 → 주문 완료 |
| 주문 처리 | `/staff` | 직원용 태블릿 | 실시간 주문 수신, 접수/제조/픽업 처리, 취소(자동 환불), 품절 관리, 음성 호출 |
| 관리자 | `/admin` | PC·태블릿 | 매출 대시보드, 메뉴·옵션 등록, 주문 기록(CSV), 영업시간·음성·키오스크 설정 |

모든 화면은 태블릿을 기준으로 만들었고, 데스크톱과 모바일에서도 쓸 수 있습니다.

## 기술 스택

- **Next.js 16 (App Router)** + TypeScript, 커스텀 서버(`server.ts`)
- **Tailwind CSS v4 + shadcn/ui + Magic UI**: MIRAEPASS 브랜드 톤(Pretendard, blue, slate-100)
- **상태 관리**
  - 서버 상태(메뉴, 주문, 통계, 설정): **TanStack React Query**
  - 클라이언트 상태(장바구니, 키오스크 단계, 직원 기기별 설정): **Jotai** (`store/`)
- **실시간 통신**: Socket.IO (`order:new`, `order:updated`, `order:call`, `menu:changed`, `store:changed`)
- **DB**: SQLite + Drizzle ORM (`data/cafe.db`, 서버를 켤 때 마이그레이션 자동 적용)
- **MIRAEPASS SDK**: [MIRAE-PASS](https://github.com/scfs-miraepass/MIRAE-PASS)의 `api-client`를 `packages/miraepass-api-client`로 복사해 사용

> Recoil은 Meta에서 보관(archived) 처리됐고 React 19와 호환되지 않아서, 같은 atom 모델인 Jotai로 대체했습니다.

## 시작하기

```bash
yarn install
cp .env.example .env     # 값 수정
yarn dev                 # http://localhost:3000
```

`MIRAEPASS_MOCK=1`이면 실제 MIRAEPASS 대신 모의 데이터로 동작합니다.

### Windows에서 개발하기

- 의존성은 `yarn install --ignore-scripts`로 설치합니다. yarn 1은 `better-sqlite3`를 소스 빌드하려고 하는데, Visual Studio C++ 빌드 도구가 없으면 설치가 중단됩니다. 패키지에 Windows용 바이너리가 들어 있어 빌드하지 않아도 됩니다.
- `yarn test`의 기기 펌웨어 테스트는 Python 3을 `python` 명령으로 실행합니다. (`python3`은 Microsoft Store 연결용이라 쓰지 않습니다)
- 셸 스크립트·Dockerfile·`scripts/kiosk-device`는 `.gitattributes`로 줄바꿈을 LF로 고정했습니다. 이 설정 전에 받은 작업 폴더는 해당 파일을 다시 체크아웃해야 LF로 바뀝니다.

| 용도 | ID | 비밀번호 / 비고 |
|---|---|---|
| 관리자 | 9001 | `admin` |
| 직원 | 9002 | `staff` |
| 학생 | 1101, 1215, 2307, 3412, 3101, 3105 | 키오스크 비밀번호 `123456`. 3101은 잔액 0P, 3105는 비밀번호 미설정 |
| 교사 | 4001 ~ 4007 | 키오스크 비밀번호 `123456`. 키오스크에서 이름 초성으로도 찾을 수 있음 (4001 홍길동 → `ㅎㄱㄷ`) |

키오스크를 처음 열면 기기 토큰(`KIOSK_DEVICE_TOKEN`)을 입력합니다. 입력한 토큰은 그 기기의 브라우저에 저장됩니다.

- **토큰을 바꿨을 때**: 서버의 `KIOSK_DEVICE_TOKEN`을 바꾸고 재시작하면, 키오스크가 켜질 때나 서버에 다시 연결될 때 토큰을 확인해서 맞지 않으면 저장된 토큰을 지우고 등록 화면을 띄웁니다. 새 토큰만 입력하면 됩니다.
- **직접 바꾸기**: 메뉴 화면 왼쪽 위 로고(영업 종료 화면은 가운데 달 아이콘)를 5초 동안 누르면 관리자 PIN 확인 화면이 열립니다. PIN 확인 후 관리자 모드의 **기기 토큰** 메뉴에서 새 토큰을 입력합니다. 새 토큰이 서버에서 확인돼야 바뀌므로, 틀린 토큰을 넣으면 기존 토큰을 그대로 씁니다.

### 운영 배포

```bash
yarn build
yarn start               # NODE_ENV=production, PORT 기본 3000
```

- 키오스크·직원 태블릿은 같은 네트워크에서 `http://<서버IP>:3000/kiosk`, `/staff`로 접속합니다.
- 브라우저의 키오스크 모드나 전체화면, 또는 홈 화면에 추가해서 사용하는 것을 권장합니다.
- `data/` 폴더(DB, 업로드한 메뉴 이미지)는 꼭 백업하세요.
- 로그인 쿠키의 `Secure`는 HTTPS로 접속했을 때만 자동으로 붙습니다(리버스 프록시의 `X-Forwarded-Proto` 포함). 그래서 `http://서버IP` 로 접속하는 태블릿에서도 로그인이 유지됩니다.

### 라즈베리파이 키오스크 (Raspberry Pi 4B + Chromium)

키오스크 화면은 라즈베리파이 4B에서도 끊기지 않도록 다음 원칙으로 만들었습니다(`components/kiosk`).

- **배경 흐림(`backdrop-filter`)을 쓰지 않습니다.** 뒤 화면이 바뀔 때마다 흐림을 매 프레임 다시 계산해서 Pi GPU에서 가장 크게 끊기던 원인이었습니다. 옵션 창·장바구니 드로어는 반투명 단색으로만 어둡게 합니다(`components/kiosk/styles.ts`).
- **계속 움직이는 효과는 CSS `transform`·`opacity`만 씁니다.** JS로 매 프레임 그리는 효과(MagicCard, BorderBeam, BlurFade, NumberTicker, ShimmerButton, motion)는 키오스크에서 쓰지 않습니다. 애니메이션은 `app/globals.css`의 `.kiosk-*` 클래스에 있습니다.
- 메뉴 이미지는 관리자 화면에서 올릴 때 긴 변 800px WebP로 줄여서 저장합니다(`lib/resize-image.ts`).

Chromium은 GPU 가속을 켜고 실행하세요. (Raspberry Pi OS Bookworm은 `chromium-browser`, 이후 버전은 `chromium`)

라즈베리파이 OS Lite(또는 systemd + NetworkManager를 쓰는 다른 리눅스: Debian·Ubuntu·Armbian·Fedora·Arch 등)를 새로 준비할 때는 Xorg/openbox/Chromium 자동 실행과 터치 설정용 로컬 서비스를 한 번에 설치할 수 있습니다.

```bash
sudo CLOUD_URL=https://<서버주소>/kiosk ADMIN_PIN=2580 ./scripts/kiosk-device/install.sh
sudo reboot
```

설치 후 키오스크 최초 등록 화면에서 터치 키보드로 기기 토큰을 입력할 수 있습니다. 기기 토큰 재설정, 유선 LAN·Wi‑Fi·화면 방향·비율·방화벽·SSH 설정, 재부팅·종료, 펌웨어 업데이트는 키오스크 화면의 숨은 관리자 모드에서 관리자 PIN을 확인한 뒤 사용할 수 있습니다. 자세한 내용은 `scripts/kiosk-device/README.md`를 보세요.

버전은 둘로 나눠 관리합니다. **클라이언트**(이 웹 앱, `package.json`)는 semantic-release로 `v*` 태그·GitHub 릴리스·Docker 이미지를 만들고, **펌웨어**(`scripts/kiosk-device`, `VERSION`)는 펌웨어 파일이 바뀌었을 때만 `firmware-v*` 태그로 올라가며 기기가 이 태그에서 업데이트를 받습니다. 설정은 `release.config.mjs`를 보세요.

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars --no-first-run \
  --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy \
  --disable-pinch --overscroll-history-navigation=0 \
  --disable-features=Translate --check-for-update-interval=31536000 \
  http://<서버IP>:3000/kiosk
```

- `chrome://gpu`에서 *Compositing*, *Rasterization*이 `Hardware accelerated`인지 확인하세요. `Software only`면 `/boot/firmware/config.txt`에 `dtoverlay=vc4-kms-v3d`가 켜져 있는지 확인합니다.
- 화면 해상도는 1920×1080 이하를 권장합니다. 4K 모니터라도 출력 해상도를 1080p로 낮추세요. Pi 4B GPU에서 4K 합성은 버거워서 끊깁니다.
- 가능하면 서버(`yarn start` 또는 Docker)는 다른 기기에서 실행하고, Pi에서는 브라우저만 실행하세요.

## 환경 변수

| 이름 | 설명 |
|---|---|
| `MIRAEPASS_API_URL` | MIRAEPASS API 주소 |
| `MIRAEPASS_SERVICE_ID` / `MIRAEPASS_SERVICE_PASSWORD` | 결제용 서비스 계정. **DEDUCT_POINT**(결제)와 **GRANT_POINT**(취소 환불) 권한이 필요합니다 |
| `MIRAEPASS_MOCK` | `1`이면 모의 모드 |
| `MIRAEPASS_TIMEOUT_MS` | MIRAEPASS 요청 하나의 제한 시간(ms). 기본 `8000` |
| `ADMIN_USER_IDS` / `STAFF_USER_IDS` | 관리자·직원으로 로그인할 수 있는 MIRAEPASS ID 목록(쉼표로 구분) |
| `SESSION_SECRET` | 세션 암호화 키(32자 이상) |
| `KIOSK_DEVICE_TOKEN` | 키오스크 기기 등록 토큰 |
| `DATABASE_PATH`, `UPLOAD_DIR` | 기본값은 `./data/cafe.db`, `./data/uploads` |

## 결제 흐름

**MIRAEPASS ID**는 4자리입니다. 학생은 학번(3학년 4반 12번 → `3412`), 교사는 고유 4자리 번호입니다.

1. 키오스크에서 ID를 입력하면 `POST /api/customers/lookup`이 MIRAEPASS `/search`로 학생·교사를 찾습니다. 이름은 가운데를 가려서(최*딩) 보여주고, 잔액이 확실히 부족하면 여기서 미리 알려줍니다.
   - 교사 ID는 계정을 만든 순서대로 붙어서 본인도 모르는 경우가 많습니다. 그래서 교사는 **이름으로 찾기**를 눌러 성함의 초성(홍길동 → `ㅎㄱㄷ`)으로 찾을 수 있습니다. 첫 초성을 누르면 `POST /api/customers/teachers`가 MIRAEPASS `/search`로 그 초성으로 시작하는 교사 목록을 가져오고, 이어서 누르는 초성은 키오스크가 받아 둔 목록에서 좁힙니다. 이름을 고르면 ID를 입력했을 때와 같은 조회로 이어지며, ID는 화면에 보여 주지 않습니다.
   - 비교 금액은 키오스크가 보낸 장바구니로 서버가 다시 계산합니다. 임의 금액을 받으면 금액을 바꿔 가며 조회해 잔액을 알아낼 수 있기 때문입니다. 같은 ID는 10분에 10번까지만 조회할 수 있습니다.
2. 키오스크 비밀번호(숫자 6자리)를 입력하면 `POST /api/orders`를 호출합니다. 비밀번호는 이 요청에만 쓰고 키오스크 메모리에서 바로 지웁니다.
3. 서버가 영업 상태를 확인하고, DB 기준으로 가격·옵션을 다시 계산하고, 고객을 다시 조회합니다.
4. 서비스 계정으로 MIRAEPASS `POST /auth/kiosk`(키오스크 비밀번호 검사)를 호출합니다.
   - 틀리면 주문을 만들지 않고 비밀번호 화면으로 돌아갑니다(남은 시도 횟수 안내, 키패드 재배열).
   - 같은 ID로 10분 안에 5번 틀리면 10분 동안 결제를 막습니다(`lib/pin-guard.ts`).
   - 비밀번호를 설정하지 않은 사용자는 MIRAEPASS에서 먼저 설정하도록 안내합니다.
5. 비밀번호가 맞으면 주문을 `pending_payment`로 저장하고 `/point/deduct`로 차감합니다(`change_type: cafe`).
   - MIRAEPASS가 거절하면(잔액 부족 등) 결제 실패(`failed`)로 남깁니다.
   - **응답을 받지 못하면**(타임아웃·네트워크 오류·5xx) 실제로 빠졌는지 알 수 없으므로 실패로 단정하지 않고 **결제 확인 필요**(`payment_status = unknown`)로 남깁니다. 키오스크는 다시 결제하지 말고 직원에게 알리라고 안내합니다(이중 차감 방지).
   - 관리자는 대시보드 배너나 주문 기록(결제 상태: 결제 확인 필요)에서 MIRAEPASS 포인트 내역을 보고 **차감됨 · 주문 접수** 또는 **차감 안 됨**으로 확정합니다. 차감됨으로 확정하면 주문번호가 붙어 직원 화면에 새 주문으로 올라갑니다.
   - 서버가 결제·환불 도중 재시작되면 시작할 때 `pending_payment` 주문은 결제 확인 필요로, 환불 중이던 주문은 환불 실패로 바꿉니다(`lib/payment-recovery.ts`).
6. 차감에 성공하면 그날의 주문번호를 부여하고, 직원 기기에 `order:new`를 보내며 "주문이 들어왔어요" 음성 알림이 나갑니다.
7. 직원이 **제조 완료**를 누르면 `order:call`이 나가고 "3학년 홍길동님, 주문하신 음료가 나왔습니다"라고 호출합니다.
8. 직원이 주문을 취소하면 `/point/grant`로 자동 환불합니다. 환불에 실패하면 `refund_failed`로 표시되고, 관리자 화면에서 다시 시도할 수 있습니다.
   - 환불은 **취소된 주문만** 할 수 있습니다. 지급 전에 주문을 `refunding`으로 선점하므로 재시도를 여러 번 눌러도 한 번만 지급됩니다.
   - 응답을 받지 못한 환불 실패는 이미 지급됐을 수 있으니 MIRAEPASS 포인트 내역을 확인한 뒤 재시도하세요.

## 음성 호출

- 직원 기기의 브라우저 Web Speech API(ko-KR)를 사용합니다.
- 브라우저 정책 때문에 직원 화면을 연 뒤 "음성 알림 켜기"를 한 번 눌러야 소리가 납니다.
- 새 주문 알림과 픽업 호출은 **기기별로** 켜고 끌 수 있습니다(상단 스피커 아이콘). 카운터 스피커에 연결된 기기에서만 호출을 켜 두세요.
- 안내 문구는 관리자 › 설정 › 음성 호출에서 바꿀 수 있습니다(`{name}`, `{grade}`, `{orderNo}`, `{menu}`).

## 개발

```bash
yarn typecheck     # tsc
yarn lint          # eslint
yarn test          # vitest (결제·환불 흐름, MIRAEPASS 클라이언트, 고객 조회, 포맷 등)
yarn db:generate   # 스키마를 바꾼 뒤 마이그레이션 생성
```

```
app/                 페이지와 API Route Handler
components/kiosk     키오스크 화면 (단계별 컴포넌트)
components/staff     주문 처리 화면
components/admin     관리자 화면
components/ui        shadcn/ui + Magic UI (CLI로 생성)
lib/                 도메인 로직 (orders, pricing, store-hours, miraepass, db …)
store/               Jotai atoms
packages/miraepass-api-client  MIRAEPASS SDK (원본 그대로, src/gen은 수정 금지)
server.ts            Next + Socket.IO 커스텀 서버
```
