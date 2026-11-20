# Raspberry Pi 키오스크 설치

라즈베리파이 OS Lite에서 Xorg + openbox + Chromium 키오스크 모드와 터치 설정 도구를 한 번에 구성합니다.

## 설치

```bash
sudo CLOUD_URL=https://YOUR_DOMAIN/kiosk ADMIN_PIN=2580 ./scripts/pi-kiosk/install.sh
sudo reboot
```

- `CLOUD_URL`은 클라우드에서 실행 중인 Next 서버의 `/kiosk` 주소입니다.
- `ADMIN_PIN`은 키오스크 화면에서 관리자 모드를 열 때 쓰는 숫자 4~8자리 PIN입니다. 생략하면 설치 중 입력받고, 비대화형 실행에서는 `2580`을 사용합니다.
- 다른 사용자로 실행하려면 `KIOSK_USER=pi`처럼 지정하세요.

## 설치되는 서비스

- `miraepass-kiosk.service`: Xorg/openbox/Chromium 키오스크 자동 실행
- `miraepass-pi-control.service`: 키오스크 화면에서 호출하는 로컬 설정 API

로컬 설정 API는 `127.0.0.1:8765`에만 바인딩됩니다. 클라우드 페이지가 Pi의 Chromium 안에서 실행될 때만 `localhost`로 호출해 Wi‑Fi 검색/연결과 간단한 터미널 명령 실행을 제공합니다.

## 운영 명령

```bash
sudo systemctl restart miraepass-kiosk
sudo systemctl restart miraepass-pi-control
journalctl -u miraepass-kiosk -f
journalctl -u miraepass-pi-control -f
```

## 키보드·마우스 없이 설정하기

키오스크 최초 등록 화면에서 기기 아이콘을 5초 이상 길게 누른 뒤 관리자 PIN을 입력하면 관리자 모드가 열립니다. 관리자 모드에서는 다음을 터치로 사용할 수 있습니다.

- 키오스크 토큰 입력
- Wi‑Fi 검색/SSID/비밀번호 입력 및 연결
- `ip addr`, `nmcli device status`, 서비스 재시작 등 터미널 명령 실행

모든 입력은 화면 하단의 터치 키보드로 할 수 있습니다.
