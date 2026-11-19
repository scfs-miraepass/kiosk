# 라즈베리파이 키오스크 (Xorg + xinit + openbox)

키오스크 기기(Raspberry Pi 4B)를 **키보드·마우스 없이 터치만으로** 운영·점검하기 위한 설정입니다.

- `bin/kiosk-session`: openbox가 켜질 때 실행됩니다. 화면 보호기를 끄고, Chromium 키오스크를 반복 실행하고(꺼지면 2초 뒤 다시 실행), 터치 점검 제스처를 감시합니다.
- `maint/touch_gesture.py`: 화면 **오른쪽 위 모서리를 한 손가락으로 5초 동안 누르면** 점검 패널을 엽니다. 리눅스 입력 장치를 직접 읽기 때문에 **Wi-Fi가 끊겨 키오스크 화면이 안 뜰 때도 동작**합니다.
- `maint/maint_panel.py`: PIN으로 잠긴 터치 점검 패널입니다.

## 점검 패널 기능

| 메뉴 | 하는 일 |
|---|---|
| Wi-Fi 설정 | 주변 Wi-Fi 목록 → 눌러서 선택 → 화면 키보드로 비밀번호 입력 → 연결. 숨긴 네트워크(SSID 직접 입력)도 지원 |
| 네트워크 상태 | Wi-Fi/유선 연결, IP, 게이트웨이, 인터넷 연결, **키오스크 서버 응답**을 한눈에 확인 |
| 명령 실행 | 화면 키보드로 명령을 입력해 실행하고 결과를 봅니다. 자주 쓰는 명령(IP, ping, 온도, 디스크, 로그 등)은 버튼 한 번 |
| 터미널 열기 | xterm + 화상 키보드(onboard). `nmtui`, `nano`처럼 입력을 주고받는 명령용. `exit`하면 패널로 돌아옵니다 |
| 고급 네트워크 설정 | `nm-connection-editor` + 화상 키보드. 고정 IP, DNS, 학교 계정(802.1X) Wi-Fi |
| 화상 키보드 켜기/끄기 | 키오스크 웹 화면 위에 키보드를 띄웁니다. 기기 토큰 등록처럼 **웹 화면에서 글자를 입력해야 할 때** 사용 |
| 키오스크 주소 변경 | 서버 IP가 바뀌었을 때 주소를 고치고 키오스크를 다시 시작 |
| 키오스크 다시 시작 / 재부팅 / 전원 끄기 | 확인 후 실행 |

- PIN을 5번 틀리면 60초 동안 잠깁니다. PIN이 설정되지 않았으면 패널이 열리지 않습니다.
- 2분 동안 입력이 없으면 패널이 닫히고 키오스크 화면으로 돌아갑니다(명령 실행·터미널 사용 중에는 닫히지 않음).
- 800×480(공식 7인치 터치 디스플레이)부터 1920×1080까지 화면 크기에 맞춰 글자·버튼 크기가 바뀝니다.

## 설치

Raspberry Pi OS(Bookworm)에 Xorg + xinit + openbox로 자동 로그인해서 openbox를 띄우는 환경을 기준으로 합니다. **Wi-Fi 설정은 NetworkManager가 필요**합니다(Bookworm 기본값).

```bash
git clone https://github.com/scfs-miraepass/kiosk.git
cd kiosk/deploy/raspberry-pi
sudo ./install.sh          # 키오스크 주소와 점검 PIN(숫자 4~12자리)을 물어봅니다
sudo reboot
```

설치 스크립트가 하는 일:

1. 패키지 설치: `python3-tk`, `python3-evdev`, `onboard`, `xterm`, `network-manager-gnome`, `fonts-nanum` (Chromium이 없으면 Chromium도)
2. `/opt/miraepass-kiosk`에 파일 복사
3. 키오스크 사용자를 `input` 그룹에 추가 (터치 장치 읽기)
4. `/etc/sudoers.d/miraepass-kiosk`: 키오스크 사용자가 **`nmcli`, `systemctl reboot`, `systemctl poweroff`만** 비밀번호 없이 실행하도록 허용
5. `~/.config/miraepass-kiosk/kiosk.conf` 생성 (권한 600, PIN은 sha256으로만 저장)
6. `~/.config/openbox/autostart`를 `kiosk-session` 실행으로 교체 (기존 파일은 `autostart.bak.날짜`로 백업)

- PIN 바꾸기: `sudo ./install.sh --reset-pin`
- 설정 파일 예시: [`kiosk.conf.example`](kiosk.conf.example)
- 비대화형 설치: `sudo KIOSK_URL=http://192.168.0.10:3000/kiosk MAINT_PIN=2468 ./install.sh`

### 처음 설치 후 확인할 것

- **모서리 방향**: 화면이나 터치를 회전해 두었다면, 누른 모서리와 터치 좌표의 모서리가 다를 수 있습니다. SSH로 접속해 `python3 /opt/miraepass-kiosk/maint/touch_gesture.py --debug`를 실행하고 원하는 모서리를 눌러 보세요. 출력되는 `x`, `y`(0~1)를 보고 `kiosk.conf`의 `MAINT_CORNER`를 맞추면 됩니다.
- **Chromium 프로필**: 키오스크는 전용 프로필(`~/.config/chromium-kiosk`)로 실행되므로, 처음 한 번은 기기 토큰을 다시 등록해야 합니다. 점검 패널의 **화상 키보드 켜기**로 입력할 수 있습니다.
- **원격 점검**: Chromium은 `--remote-debugging-port=9222`(localhost 전용)로 실행됩니다. 노트북에서 `ssh -L 9222:localhost:9222 pi@<Pi IP>`로 연결하고 `chrome://inspect`를 열면, 실제 키오스크 화면의 콘솔·성능·`chrome://gpu`를 볼 수 있습니다.

## 보안 메모

- 점검 패널은 PIN으로 잠겨 있지만, 열리면 키오스크 사용자 권한으로 명령을 실행할 수 있습니다. PIN은 직원만 알도록 관리하세요.
- 키오스크 사용자의 `sudo`는 위 세 명령 외에는 비밀번호를 요구하도록 두세요(Raspberry Pi OS 기본 `010_pi-nopasswd`가 있다면 삭제를 권장).
- SSH는 키 인증만 허용하는 것을 권장합니다.

## 개발 PC에서 확인

```bash
cd deploy/raspberry-pi/maint
python3 -m unittest -v test_logic.py                    # nmcli 출력 해석, 제스처 판정, 설정 파일
python3 maint_panel.py --fake --windowed 800x480        # 패널 UI (가짜 모드: Wi-Fi·재부팅을 실제로 실행하지 않음)
```

> macOS 기본 Python의 Tk 8.5는 불안정합니다. 패널 UI는 Homebrew Python이나 Linux에서 확인하세요.
