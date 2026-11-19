#!/usr/bin/env bash
# 미래카페 키오스크 라즈베리파이 설치 (Xorg + xinit + openbox 환경)
#
#   sudo ./install.sh                # 처음 설치 (키오스크 주소·점검 PIN을 물어봄)
#   sudo ./install.sh --reset-pin    # 점검 PIN만 다시 설정
#
# 비대화형 설치: sudo KIOSK_URL=http://192.168.0.10:3000/kiosk MAINT_PIN=2468 ./install.sh
# 키오스크를 실행하는 사용자는 sudo를 실행한 사용자(SUDO_USER)다. 다른 사용자면 KIOSK_USER=이름 으로 지정.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PREFIX:-/opt/miraepass-kiosk}"
RESET_PIN=0
[ "${1:-}" = "--reset-pin" ] && RESET_PIN=1

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo로 실행해 주세요: sudo ./install.sh" >&2
  exit 1
fi
KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-}}"
if [ -z "$KIOSK_USER" ] || [ "$KIOSK_USER" = root ]; then
  echo "키오스크를 실행할 사용자를 알 수 없어요. KIOSK_USER=pi sudo -E ./install.sh 처럼 지정해 주세요." >&2
  exit 1
fi
USER_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
CONF_DIR="$USER_HOME/.config/miraepass-kiosk"
CONF="$CONF_DIR/kiosk.conf"
as_user() { sudo -u "$KIOSK_USER" -H "$@"; }

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }

ask_pin() {  # 해시만 stdout으로 내보내므로 안내 문구는 모두 stderr로
  local pin="${MAINT_PIN:-}" again
  while ! [[ "$pin" =~ ^[0-9]{4,12}$ ]]; do
    [ -n "$pin" ] && echo "숫자 4~12자리로 입력해 주세요." >&2
    read -r -s -p "점검 패널 PIN (숫자 4~12자리): " pin </dev/tty; echo >&2
    read -r -s -p "한 번 더 입력: " again </dev/tty; echo >&2
    [ "$pin" = "$again" ] || { echo "두 PIN이 달라요." >&2; pin=""; }
  done
  printf '%s' "$pin" | sha256sum | cut -d' ' -f1
}

set_conf() {  # set_conf KEY VALUE : 설정 파일의 한 줄을 바꾸거나 추가
  as_user env MIRAEPASS_KIOSK_CONF="$CONF" python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); from common import set_config_value; set_config_value(sys.argv[2], sys.argv[3])' "$PREFIX/maint" "$1" "$2"
}

if [ "$RESET_PIN" -eq 0 ]; then
  if [ "${SKIP_APT:-0}" != 1 ]; then
    step "패키지 설치"
    apt-get update
    # python3-tk: 점검 패널, python3-evdev: 터치 제스처, onboard: 화상 키보드, xterm: 터미널,
    # network-manager-gnome: 고급 네트워크 설정(nm-connection-editor), fonts-nanum: 한글 글꼴
    apt-get install -y --no-install-recommends python3 python3-tk python3-evdev onboard xterm \
      network-manager-gnome fonts-nanum x11-xserver-utils
    if ! command -v chromium-browser >/dev/null && ! command -v chromium >/dev/null; then
      apt-get install -y chromium-browser || apt-get install -y chromium
    fi
  fi

  if ! systemctl is-active --quiet NetworkManager 2>/dev/null; then
    echo "⚠ NetworkManager가 실행 중이 아니에요. Wi-Fi 설정은 NetworkManager가 필요해요 (sudo raspi-config → Advanced Options → Network Config)."
  fi

  step "파일 복사: $PREFIX"
  install -d "$PREFIX/bin" "$PREFIX/maint"
  install -m 755 "$HERE/bin/kiosk-session" "$PREFIX/bin/kiosk-session"
  install -m 644 "$HERE/maint/common.py" "$PREFIX/maint/common.py"
  install -m 755 "$HERE/maint/touch_gesture.py" "$HERE/maint/maint_panel.py" "$PREFIX/maint/"

  step "터치 장치 읽기 권한 (input 그룹)"
  getent group input >/dev/null || groupadd --system input
  usermod -aG input "$KIOSK_USER"

  step "점검 패널의 Wi-Fi·재부팅 권한 (sudoers)"
  NMCLI="$(command -v nmcli || echo /usr/bin/nmcli)"
  SYSTEMCTL="$(command -v systemctl || echo /usr/bin/systemctl)"
  SUDOERS=/etc/sudoers.d/miraepass-kiosk
  cat >"$SUDOERS.tmp" <<EOF
# 미래카페 키오스크 점검 패널 (install.sh가 생성)
$KIOSK_USER ALL=(root) NOPASSWD: $NMCLI, $SYSTEMCTL reboot, $SYSTEMCTL poweroff
EOF
  chmod 440 "$SUDOERS.tmp"
  if visudo -cf "$SUDOERS.tmp" >/dev/null; then
    mv "$SUDOERS.tmp" "$SUDOERS"
  else
    rm -f "$SUDOERS.tmp"
    echo "sudoers 검사에 실패해서 적용하지 않았어요" >&2
    exit 1
  fi
fi

step "설정 파일: $CONF"
as_user mkdir -p "$CONF_DIR"
if [ ! -f "$CONF" ]; then
  as_user cp "$HERE/kiosk.conf.example" "$CONF"
  url="${KIOSK_URL:-}"
  while ! [[ "$url" =~ ^https?:// ]]; do
    read -r -p "키오스크 주소 (예: http://192.168.0.10:3000/kiosk): " url </dev/tty
  done
  set_conf KIOSK_URL "$url"
  RESET_PIN=1
fi
if [ "$RESET_PIN" -eq 1 ]; then
  set_conf MAINT_PIN_SHA256 "$(ask_pin)"
  echo "점검 PIN을 저장했어요."
fi
chmod 600 "$CONF"

if [ "${1:-}" != "--reset-pin" ]; then
  step "openbox 자동 실행 등록"
  AUTOSTART="$USER_HOME/.config/openbox/autostart"
  as_user mkdir -p "$(dirname "$AUTOSTART")"
  if [ -f "$AUTOSTART" ] && ! grep -q "miraepass-kiosk/bin/kiosk-session" "$AUTOSTART"; then
    BACKUP="$AUTOSTART.bak.$(date +%Y%m%d%H%M%S)"
    as_user cp "$AUTOSTART" "$BACKUP"
    echo "기존 autostart를 $BACKUP 에 백업했어요. 거기서 Chromium을 띄우던 줄은 이제 kiosk-session이 대신해요."
  fi
  as_user tee "$AUTOSTART" >/dev/null <<EOF
# 미래카페 키오스크 (install.sh가 생성). Chromium 키오스크 + 터치 점검 패널
$PREFIX/bin/kiosk-session &
EOF
fi

cat <<EOF

✅ 설치 완료
- 다시 로그인(또는 재부팅)하면 적용돼요: sudo reboot
- 점검 패널: 화면 $(grep -E '^MAINT_CORNER=' "$CONF" | cut -d= -f2 || echo top-right) 모서리를 한 손가락으로 5초 동안 누르기 → PIN 입력
- 모서리 방향이 다르면: python3 $PREFIX/maint/touch_gesture.py --debug 로 누른 위치를 확인해 $CONF 의 MAINT_CORNER를 바꾸세요
- PIN 변경: sudo ./install.sh --reset-pin
EOF
