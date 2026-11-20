# 키오스크 기기 설치 (Raspberry Pi · 리눅스)

리눅스 기기에 Xorg + xinit + openbox + Chromium 키오스크와 터치 관리자 모드용 로컬 서비스를 한 번에 구성합니다.
기본 대상은 Raspberry Pi 4B + Raspberry Pi OS Lite이고, systemd와 NetworkManager를 쓰는 다른 리눅스에서도 같은 스크립트로 설치할 수 있습니다.

## 지원 환경

| 환경 | 패키지 설치 | 비고 |
| --- | --- | --- |
| Raspberry Pi OS Lite (Bookworm 이상) | 자동 (apt) | 기본 대상. Wi‑Fi 국가는 `raspi-config`로 설정 |
| Debian · Ubuntu · Armbian 등 apt 계열 | 자동 (apt) | Ubuntu는 Chromium이 snap으로 설치됨 |
| Fedora 등 dnf 계열 | 자동 (dnf) | RHEL·Rocky는 Chromium에 EPEL 필요 |
| Arch 등 pacman 계열 | 자동 (pacman) | 설치 중 `pacman -Syu`로 시스템 전체 업데이트 |
| 그 밖의 배포판 | 직접 설치 후 `SKIP_PACKAGES=1` | 아래 "필요 패키지" 참고 |

CPU는 ARM(aarch64·armhf)과 x86_64 모두 지원합니다. Chromium이나 Google Chrome이 이미 설치돼 있으면 그것을 씁니다.

### NetworkManager

관리자 모드의 유선/Wi‑Fi 설정은 NetworkManager(`nmcli`)로 동작합니다.

- Raspberry Pi OS Bookworm 이상, Fedora, 데스크톱 배포판은 이미 NetworkManager를 쓰므로 그대로 설치됩니다.
- Ubuntu Server(netplan), Debian 최소 설치(ifupdown), Raspberry Pi OS Bullseye(dhcpcd)처럼 다른 관리자를 쓰면 설치가 멈추고 안내를 보여 줍니다.
  `NM_TAKEOVER=1`을 붙여 다시 실행하면 **다음 부팅부터** NetworkManager로 바뀝니다. 설치 중에는 바꾸지 않으므로 지금 연결된 SSH는 끊기지 않습니다.
  - 재부팅 뒤 유선 LAN은 DHCP로 연결되므로 IP가 바뀔 수 있습니다. (netplan은 기존 설정이 옮겨집니다)
  - 기존 고정 IP·Wi‑Fi 설정은 옮겨지지 않으니 관리자 모드나 `sudo nmtui`로 다시 설정하세요. ifupdown 설정은 `/etc/network/miraepass-backup-*`에 백업됩니다.

## SSH로 설치

**저장소째 받아서 설치 (권장)** — 설치한 펌웨어 버전과 커밋이 관리자 모드에 표시됩니다.

```bash
# 개발 PC에서: 저장소를 기기로 복사 (또는 기기에서 git clone)
rsync -a --exclude node_modules --exclude .next ./ <사용자>@<기기 IP>:~/miraepass-kiosk/

# 기기에 접속해서 설치
ssh <사용자>@<기기 IP>
cd ~/miraepass-kiosk
sudo CLOUD_URL=https://YOUR_DOMAIN/kiosk ADMIN_PIN=2580 ./scripts/kiosk-device/install.sh
sudo reboot
```

**설치 폴더만 복사** — 폴더의 `VERSION` 파일로 펌웨어 버전을 표시합니다.

```bash
scp -r scripts/kiosk-device <사용자>@<기기 IP>:~/
ssh <사용자>@<기기 IP>
cd ~/kiosk-device
sudo CLOUD_URL=https://YOUR_DOMAIN/kiosk ADMIN_PIN=2580 ./install.sh
```

### 버전 (클라이언트와 펌웨어)

키오스크는 두 부분으로 나뉘고, 버전도 따로 올라갑니다. 관리자 모드 › 상태 › 기기 정보에 둘 다 표시됩니다.

| | 클라이언트 | 펌웨어 |
| --- | --- | --- |
| 무엇 | 클라우드의 웹 앱(SSR 서버). 키오스크 화면 | 기기에 설치하는 이 폴더(`scripts/kiosk-device`): 설치 스크립트, 로컬 제어 서비스, 시작 화면 |
| 버전 위치 | 루트 `package.json` | 이 폴더의 `VERSION` |
| 태그 | `v1.2.3` (+ GitHub 릴리스, Docker 이미지) | `firmware-v1.2.3` (태그만) |
| 언제 올라가나 | 펌웨어 밖의 파일이 바뀐 커밋이 있을 때 | 이 폴더의 파일(README·`VERSION` 제외)이 바뀐 커밋이 있을 때만 |
| 배포 | Docker 이미지를 서버에 배포 | 기기가 GitHub의 펌웨어 태그에서 받아 업데이트 |

- 둘 다 semantic-release가 커밋 메시지(`feat`·`fix`·`BREAKING CHANGE`)로 버전을 정합니다. 설정은 루트 `release.config.mjs`에 있습니다.
- 한 커밋이 양쪽을 다 바꾸면 둘 다 올라갑니다. 펌웨어만 바꾸면 클라이언트 버전과 Docker 이미지는 그대로입니다.
- dev 브랜치에서는 `firmware-v1.2.3-dev.1` 같은 프리릴리스가 생기지만, 기기는 정식 버전만 받습니다.
- 펌웨어 버전 표시: `v1.4.0`(릴리스 그대로), `v1.4.0 (커밋 a1b2c3d)`(저장소에서 설치), `…, 수정본`(커밋하지 않은 수정 포함).

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CLOUD_URL` | (필수) | 클라우드 Next 서버의 `/kiosk` 주소 |
| `ADMIN_PIN` | `2580` | 관리자 모드를 열 때 쓰는 숫자 4~8자리 PIN |
| `KIOSK_USER` | sudo를 실행한 사용자 | 키오스크(Chromium)를 실행할 계정 |
| `WIFI_COUNTRY` | `KR` | Wi‑Fi 국가 코드. Raspberry Pi OS Lite는 이 값이 없으면 무선이 막혀 있습니다. |
| `DISPLAY_ROTATE` | `normal` | 처음 화면 방향 `normal`·`left`·`right`·`inverted`. 설치 후에는 관리자 모드 › 화면에서 바꿀 수 있습니다. |
| `DISPLAY_SCALE` | `1.25` | Chromium 확대·축소 비율 0.5~3 (`--force-device-scale-factor`). 설치 후에는 관리자 모드 › 화면에서 바꿀 수 있습니다. |
| `HIDE_CURSOR` | `1` | `1`이면 마우스 커서를 숨깁니다 (터치 전용). |
| `FIREWALL` | `1` | `1`이면 들어오는 연결을 모두 차단하는 방화벽을 켭니다. SSH가 켜져 있으면 SSH 포트만 허용합니다. 설치 후에는 관리자 모드 › 보안에서 켜고 끌 수 있습니다. |
| `NM_TAKEOVER` | `0` | `1`이면 다음 부팅부터 NetworkManager로 전환합니다 (위 설명 참고). |
| `AUTO_UPDATE` | `1` | `1`이면 매일 새벽 3:30 전후 자동 업데이트. 설치 후에는 관리자 모드 › 업데이트에서 켜고 끌 수 있습니다. |
| `UPDATE_REPO` | 저장소 git remote, 없으면 `scfs-miraepass/kiosk` | 업데이트를 받을 GitHub 저장소 |
| `CHROMIUM_EXTRA_FLAGS` | 라즈베리파이: `--ignore-gpu-blocklist --enable-gpu-rasterization`, 그 외: 없음 | Chromium 추가 플래그 |
| `KIOSK_VERSION` | `VERSION` 파일 + 저장소 git 커밋 | 관리자 모드에 표시할 펌웨어 버전. 보통 지정하지 않습니다. |
| `SKIP_PACKAGES` | `0` | `1`이면 패키지 설치를 건너뜁니다. |
| `REBOOT` | `0` | `1`이면 설치가 끝나고 바로 재부팅합니다. |

이미 설치된 기기에서는 `install.sh`가 실행되지 않습니다. 키오스크 URL·PIN처럼 설치할 때 정한 값을 바꾸려면 아래 "다시 설치"를 따르세요. 화면 방향·비율, 방화벽, SSH, 네트워크는 관리자 모드에서 바꿀 수 있습니다.

### 필요 패키지 (`SKIP_PACKAGES=1`로 직접 설치할 때)

- Xorg 서버 + libinput 입력 드라이버, `xinit`
- `xrandr`, `xset`, `xinput` (회전·절전 끄기·터치 보정)
- NetworkManager (Wi‑Fi 지원 포함), `rfkill`, `iw`
- `python3`, CJK(한글) 글꼴
- Chromium 또는 Google Chrome
- (선택) `openbox`

## 업데이트

펌웨어는 **GitHub 저장소의 최신 정식 펌웨어 태그**(`firmware-vX.Y.Z`)에서 받아 업데이트합니다 (기본 `scfs-miraepass/kiosk`, dev 프리릴리스는 받지 않음). 공개 저장소라 인증은 필요 없습니다. 클라이언트(웹 앱)는 서버에 배포하면 키오스크 화면이 바로 새 버전을 쓰므로 기기에서 따로 업데이트하지 않습니다.

- **자동**: 매일 새벽 3:30 전후(기기마다 최대 30분 분산). 그 시간에 꺼져 있었으면 다음 부팅 때 확인합니다.
- **수동**: 관리자 모드 › 업데이트에서 확인·적용, 자동 업데이트 켜기/끄기, 최근 기록 보기
- **SSH**: 저장소에서 바로 적용하려면 `sudo ./scripts/kiosk-device/install.sh --update`

새 버전 여부는 최신 펌웨어 태그(예: `firmware-v1.4.0`)와 기기 펌웨어 버전을 비교해 **태그가 더 높을 때만** 적용합니다. 확인은 GitHub API 요청 하나라서 변경이 없으면 파일을 받지 않습니다. 업데이트는 설정(키오스크 URL, PIN, 화면 방향·비율, 방화벽, 자동 업데이트, 네트워크, 기기 토큰)을 그대로 두고 프로그램 파일만 바꿉니다.

> 펌웨어 버전이 따로 생기기 전(클라이언트 v1.3.0 이하)의 기기는 클라이언트 릴리스를 받아 업데이트합니다. 그렇게 이 버전으로 올라온 기기는 표시해 두었다가, 다음 업데이트 때 최신 펌웨어 태그를 받아 펌웨어 버전 체계로 넘어갑니다. v1.2.0 이하 기기는 인증서 문제로 받지 못할 수 있으니 SSH로 `install.sh --update`를 한 번 실행해 주세요.

안전장치
- 확인과 파일 받기 모두 `api.github.com`만 씁니다 (파일은 git blob API로 받음). `raw.githubusercontent.com`은 인증서 체인이 달라 일부 기기·망에서 `CERTIFICATE_VERIFY_FAILED`가 나기 때문입니다.
- 받은 파일은 GitHub가 알려 준 git blob 해시로 하나씩 검증하고, `VERSION` 파일이 태그 버전과 같은지 확인합니다.
- 적용 전에 덮어쓸 파일(방화벽 규칙·터치 설정 포함)을 백업하고, 적용 실패·시간 초과·적용 후 로컬 서비스 무응답이면 자동으로 되돌립니다. 업데이트가 새로 만든 파일은 지웁니다.
- 적용은 별도 서비스(`miraepass-kiosk-update.service`)가 하므로 중간에 로컬 서비스가 다시 시작돼도 계속됩니다.
- 화면 관련 파일이 실제로 바뀐 경우에만 키오스크 화면을 다시 시작합니다.
- 새 패키지가 필요한 업데이트는 적용하지 않고 안내합니다 (삭제 후 다시 설치).
- 다른 저장소(포크 등)에서 받으려면 처음 설치할 때 `UPDATE_REPO=owner/repo`를 지정합니다.

기록: `/var/lib/miraepass/update/update.log`, `journalctl -u miraepass-kiosk-update`

인증서 오류(`GitHub 인증서를 확인하지 못했어요`)가 나면 오류에 함께 나오는 원인과 기기 시간을 확인하세요.
- **기기 시간이 틀림** (`certificate is not yet valid` / `has expired`): 라즈베리파이는 RTC가 없어 시간 동기화(NTP)가 안 되면 시간이 틀어집니다. `timedatectl`로 `System clock synchronized: yes`인지 확인하고, 망에서 NTP(UDP 123)가 막혀 있으면 허용해 주세요. 설치 스크립트는 NTP 동기화를 켭니다.
- **그 밖** (`unable to get local issuer certificate` 등): 회사·학교망의 HTTPS 검사 장비가 인증서를 바꾸는 경우가 많습니다. 해당 장비의 루트 인증서를 `/usr/local/share/ca-certificates/`에 넣고 `sudo update-ca-certificates`를 실행하거나, GitHub를 검사 예외로 등록해 주세요. `sudo apt install --reinstall ca-certificates`로 기본 인증서도 확인해 주세요.

## 다시 설치

설정이 섞이지 않도록 **삭제한 뒤 새로 설치**합니다. 이미 설치된 상태에서 `install.sh`를 실행하면 안내만 보여 주고 멈춥니다.

```bash
sudo miraepass-kiosk-uninstall
sudo CLOUD_URL=https://YOUR_DOMAIN/kiosk ADMIN_PIN=2580 ./install.sh
sudo reboot
```

새로 설치하면 모든 키오스크 설정이 기본값으로 시작합니다. 기기 토큰도 지워지므로 처음 등록 화면에서 다시 입력해야 합니다.

## 삭제

```bash
sudo miraepass-kiosk-uninstall            # 설치할 때 함께 복사됨 (저장소 폴더가 없어도 됨)
# 또는
sudo ./uninstall.sh
```

- 키오스크 화면·로컬 제어 서비스·방화벽 서비스와 설치한 설정 파일, 키오스크 설정(기기 토큰, 화면 방향, 관리자 PIN 등)을 모두 지웁니다.
- 설치 전에 기록해 둔 부팅 기본값(콘솔/데스크톱), tty1 로그인, Xorg 권한 설정을 원래대로 되돌립니다.
- **SSH로 작업 중 연결이 끊기지 않도록** 네트워크 연결 설정과 SSH 상태는 그대로 둡니다. 설치한 패키지도 남겨 둡니다.
- `YES=1`: 확인 질문 생략, `REBOOT=1`: 삭제 후 재부팅, `KEEP_BROWSER_DATA=1`: Chromium 프로필(기기 토큰)은 남김

## 설치되는 것

- `miraepass-kiosk.service`: tty1에서 Xorg → openbox → Chromium 키오스크를 자동 실행
- `miraepass-kiosk-control.service`: 관리자 모드가 호출하는 로컬 설정 API (`127.0.0.1:8765`에만 바인딩)
- `miraepass-firewall.service` + `/etc/miraepass/firewall.nft`: nftables 전용 테이블(`inet miraepass_kiosk`)로 들어오는 연결 차단. 나가는 연결과 그 응답, loopback, IPv6 필수 ICMPv6/DHCPv6만 허용하고, SSH가 켜져 있으면 SSH 포트를 허용 (ufw·firewalld와 함께 써도 서로 덮어쓰지 않음)
- `miraepass-kiosk-update.service` / `.timer`: 기기 스크립트 업데이트 (매일 새벽 자동 + 관리자 모드 수동)
- `/usr/local/bin/miraepass-kiosk-rotate`: 화면·터치 회전 스크립트 (부팅 시와 관리자 모드에서 공통 사용)
  - 터치 장치는 이름이 아니라 속성(절대 좌표 입력)으로 찾아서 마우스·터치패드는 건드리지 않습니다.
  - 저장된 방향은 `/etc/X11/xorg.conf.d/99-miraepass-touch-rotation.conf`에도 기록돼, USB 터치가 다시 연결돼도 같은 방향이 적용됩니다.
- Chromium·Chrome 정책(`/etc/chromium/policies/managed`, `/etc/chromium-browser/policies/managed`, `/etc/opt/chrome/policies/managed`): 비밀번호 저장·번역 말풍선을 끄고, 클라우드 페이지가 `127.0.0.1` 로컬 서비스를 부를 때 권한 팝업이 뜨지 않게 허용

Chromium은 먼저 로컬 시작 화면(`http://127.0.0.1:8765/launch`, 파일: `/usr/local/share/miraepass-kiosk/launch.html`)을 열고, 클라우드 키오스크 주소에 연결되면 그 페이지로 이동합니다.

### 인터넷 없이 네트워크 설정

부팅했는데 서버에 연결되지 않으면 시작 화면에 **네트워크 설정** 버튼이 나타납니다. 관리자 PIN을 입력하면 인터넷 없이도 이 화면에서 바로 설정할 수 있습니다.

- 유선 LAN: 현재 상태 확인, DHCP 자동 / 고정 IP(IP, 서브넷 마스크, 게이트웨이, DNS)
- Wi‑Fi: 주변 네트워크 검색, WPA-Personal / WPA-Enterprise 연결, 숨겨진 네트워크 직접 입력
- 화면 터치 키보드 제공 (영문·숫자·기호)

설정 중에 서버 연결이 살아나면 "키오스크 시작" 버튼이 나타나고, 설정 화면을 닫거나 5분 동안 입력이 없으면 자동으로 키오스크로 넘어갑니다.

## 운영 명령

```bash
sudo systemctl restart miraepass-kiosk       # 키오스크 화면 다시 시작
sudo systemctl restart miraepass-kiosk-control  # 로컬 서비스 다시 시작
journalctl -u miraepass-kiosk -f
journalctl -u miraepass-kiosk-control -f
nmcli device status                          # 네트워크 상태 확인
```

## 관리자 모드

키오스크 화면에서 로고(영업 종료 화면은 달 아이콘)를 5초 이상 길게 누른 뒤 관리자 PIN을 입력하면 전체 화면 관리자 모드가 열립니다. 3분 동안 입력이 없으면 자동으로 키오스크로 돌아갑니다.

| 메뉴 | 내용 |
| --- | --- |
| 상태 | 인터넷 연결 여부, 유선/무선 IP, 기기 모델, 호스트 이름, 로컬 서비스 버전 |
| 유선 LAN | 현재 IP·게이트웨이·DNS 확인, DHCP 자동 / 고정 IP(IP, 서브넷 마스크, 게이트웨이, DNS) |
| Wi‑Fi | 신호 세기(막대·%·dBm·대역·속도, 5초마다 갱신, 약하면 경고), 주변 네트워크 검색, WPA-Personal / WPA-Enterprise(PEAP·MSCHAPv2) 연결, 숨겨진 네트워크 직접 입력 |
| 화면 | 화면 방향(기본·오른쪽 90°·왼쪽 90°·180°) 변경. 터치 좌표도 함께 돌리며, 15초 안에 ‘유지’를 누르지 않으면 자동으로 되돌아감. 화면 비율(80~200%, 기본 125%) 변경: 키오스크 화면이 다시 시작되며 적용 |
| 업데이트 | GitHub 최신 릴리스 확인, 업데이트 적용(진행 상황 표시), 자동 업데이트 켜기/끄기, 최근 기록 |
| 보안 | 방화벽 켜기/끄기, SSH 원격 접속 켜기/끄기. 방화벽이 켜진 상태에서 SSH를 켜면 SSH 포트만 자동으로 열림 |
| 기기 토큰 | 키오스크 기기 토큰 재등록 (서버에서 확인된 토큰만 저장) |
| 전원 | 키오스크 화면 새로고침, 재부팅, 종료 (확인 후 실행) |

입력칸을 누르면 플로팅 터치 키보드가 열리고, 상단 바를 잡아 원하는 위치로 옮길 수 있습니다.

> 관리자 모드는 클라우드 키오스크 페이지 안에 있어서 서버에 연결된 뒤에만 열립니다. 인터넷이 없을 때는 위의 시작 화면 **네트워크 설정**을 사용하세요.

## 로컬 서비스 보안

- `127.0.0.1`에만 바인딩되어 기기 밖에서는 접속할 수 없습니다.
- 브라우저 요청은 `CLOUD_URL`의 출처(origin)와 이 기기에서 연 페이지만 허용합니다. 다른 출처를 더 허용하려면 `/etc/default/miraepass-kiosk-control`에 `MIRAEPASS_KIOSK_ALLOWED_ORIGINS=https://a.example,https://b.example`을 추가하세요.
- 네트워크·화면·보안·전원 API는 관리자 PIN 확인 후 발급되는 토큰이 있어야 동작합니다. 토큰은 관리자 모드를 닫거나 30분 동안 쓰지 않으면 폐기됩니다.
- PIN을 5번 연속 틀리면 30초 동안 잠깁니다.

방화벽을 SSH에서 직접 확인/조작하려면:

```bash
sudo nft list table inet miraepass_kiosk
sudo python3 /usr/local/bin/miraepass-kiosk-control.py firewall status   # on | off
```

