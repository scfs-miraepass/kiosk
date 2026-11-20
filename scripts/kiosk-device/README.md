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

```bash
# 개발 PC에서: 설치 폴더를 기기로 복사
scp -r scripts/kiosk-device <사용자>@<기기 IP>:~/

# 기기에 접속해서 설치
ssh <사용자>@<기기 IP>
cd ~/kiosk-device
sudo CLOUD_URL=https://YOUR_DOMAIN/kiosk ADMIN_PIN=2580 ./install.sh
sudo reboot
```

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CLOUD_URL` | (필수) | 클라우드 Next 서버의 `/kiosk` 주소. 재설치할 때 생략하면 이전 값을 씁니다. |
| `ADMIN_PIN` | `2580` | 관리자 모드를 열 때 쓰는 숫자 4~8자리 PIN. 재설치할 때 생략하면 이전 값을 씁니다. |
| `KIOSK_USER` | sudo를 실행한 사용자 | 키오스크(Chromium)를 실행할 계정 |
| `WIFI_COUNTRY` | `KR` | Wi‑Fi 국가 코드. Raspberry Pi OS Lite는 이 값이 없으면 무선이 막혀 있습니다. |
| `DISPLAY_ROTATE` | `normal` | 처음 화면 방향 `normal`·`left`·`right`·`inverted`. 이후에는 관리자 모드 › 화면에서 바꿀 수 있고, 재설치해도 그 값이 유지됩니다. |
| `HIDE_CURSOR` | `1` | `1`이면 마우스 커서를 숨깁니다 (터치 전용). |
| `FIREWALL` | `1` | `1`이면 들어오는 연결을 모두 차단하는 방화벽을 켭니다. SSH가 켜져 있으면 SSH 포트만 허용합니다. 재설치할 때 생략하면 이전 상태(관리자 모드에서 바꾼 값)를 따릅니다. |
| `NM_TAKEOVER` | `0` | `1`이면 다음 부팅부터 NetworkManager로 전환합니다 (위 설명 참고). |
| `SKIP_PACKAGES` | `0` | `1`이면 패키지 설치를 건너뜁니다. |
| `REBOOT` | `0` | `1`이면 설치가 끝나고 바로 재부팅합니다. |

스크립트는 여러 번 실행해도 안전합니다. 설정을 바꾸려면 바꿀 값만 넣고 다시 실행한 뒤 재부팅하세요.

```bash
sudo DISPLAY_ROTATE=right ./install.sh && sudo reboot
```

Chromium 플래그는 `/etc/default/miraepass-kiosk`의 `CHROMIUM_EXTRA_FLAGS`로 기기마다 조정할 수 있습니다. 라즈베리파이는 GPU 래스터화를 켜는 `--ignore-gpu-blocklist --enable-gpu-rasterization`이 기본으로 들어갑니다.

### 필요 패키지 (`SKIP_PACKAGES=1`로 직접 설치할 때)

- Xorg 서버 + libinput 입력 드라이버, `xinit`
- `xrandr`, `xset`, `xinput` (회전·절전 끄기·터치 보정)
- NetworkManager (Wi‑Fi 지원 포함), `rfkill`, `iw`
- `python3`, CJK(한글) 글꼴
- Chromium 또는 Google Chrome
- (선택) `openbox`

## 설치되는 것

- `miraepass-kiosk.service`: tty1에서 Xorg → openbox → Chromium 키오스크를 자동 실행
- `miraepass-kiosk-control.service`: 관리자 모드가 호출하는 로컬 설정 API (`127.0.0.1:8765`에만 바인딩)
- `miraepass-firewall.service` + `/etc/miraepass/firewall.nft`: nftables 전용 테이블(`inet miraepass_kiosk`)로 들어오는 연결 차단. 나가는 연결과 그 응답, loopback, IPv6 필수 ICMPv6/DHCPv6만 허용하고, SSH가 켜져 있으면 SSH 포트를 허용 (ufw·firewalld와 함께 써도 서로 덮어쓰지 않음)
- `/usr/local/bin/miraepass-kiosk-rotate`: 화면·터치 회전 스크립트 (부팅 시와 관리자 모드에서 공통 사용)

> 이전 이름(`scripts/pi-kiosk`, `miraepass-pi-control`)으로 설치한 기기는 새 스크립트로 다시 설치하면 서비스가 자동으로 교체되고 관리자 PIN도 이어집니다.
- Chromium·Chrome 정책(`/etc/chromium/policies/managed`, `/etc/chromium-browser/policies/managed`, `/etc/opt/chrome/policies/managed`): 비밀번호 저장·번역 말풍선을 끄고, 클라우드 페이지가 `127.0.0.1` 로컬 서비스를 부를 때 권한 팝업이 뜨지 않게 허용

Chromium은 먼저 로컬 시작 화면(`http://127.0.0.1:8765/launch`)을 열고, 클라우드 키오스크 주소에 연결되면 그 페이지로 이동합니다. 부팅 시 네트워크가 없으면 "네트워크에 연결되지 않았어요" 화면에서 5초마다 다시 시도합니다.

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
| Wi‑Fi | 주변 네트워크 검색, WPA-Personal / WPA-Enterprise(PEAP·MSCHAPv2) 연결, 숨겨진 네트워크 직접 입력 |
| 화면 | 화면 방향(기본·오른쪽 90°·왼쪽 90°·180°) 변경. 터치 좌표도 함께 돌리며, 15초 안에 ‘유지’를 누르지 않으면 자동으로 되돌아감 |
| 보안 | 방화벽 켜기/끄기, SSH 원격 접속 켜기/끄기. 방화벽이 켜진 상태에서 SSH를 켜면 SSH 포트만 자동으로 열림 |
| 기기 토큰 | 키오스크 기기 토큰 재등록 (서버에서 확인된 토큰만 저장) |
| 전원 | 키오스크 화면 새로고침, 재부팅, 종료 (확인 후 실행) |

입력칸을 누르면 플로팅 터치 키보드가 열리고, 상단 바를 잡아 원하는 위치로 옮길 수 있습니다.

> 관리자 모드 자체는 클라우드 키오스크 페이지 안에 있으므로, 처음 설치한 장소와 다른 네트워크로 옮길 때는 유선 LAN(DHCP)으로 먼저 연결하거나 SSH에서 `sudo nmtui`로 설정하세요.

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

