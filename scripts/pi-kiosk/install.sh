#!/usr/bin/env bash
# MIRAEPASS 키오스크 설치 (Raspberry Pi 4B · Raspberry Pi OS Lite Bookworm 이상)
#
# SSH로 접속해 실행하는 것을 기준으로 한다. 다시 실행해도 안전하며(idempotent),
# 값을 생략하면 이전 설치 값(키오스크 URL, 관리자 PIN)을 그대로 쓴다.
#
#   sudo CLOUD_URL=https://cafe.example.com/kiosk ADMIN_PIN=2580 ./install.sh
#
# 선택 환경 변수
#   KIOSK_USER      키오스크를 실행할 사용자 (기본: sudo를 실행한 사용자)
#   WIFI_COUNTRY    Wi‑Fi 국가 코드 (기본: KR). 설정하지 않으면 Lite에서 무선이 막혀 있다.
#   DISPLAY_ROTATE  화면 회전: normal | left | right | inverted (기본: normal). 터치 좌표도 같이 돌린다.
#   HIDE_CURSOR     1이면 마우스 커서를 숨긴다 (기본: 1, 터치 전용 기기)
#   REBOOT          1이면 설치 후 바로 재부팅
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "sudo로 실행하세요: sudo CLOUD_URL=https://example.com/kiosk $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "${SCRIPT_DIR}/miraepass-pi-control.py" ]]; then
  echo "${SCRIPT_DIR}/miraepass-pi-control.py 가 없습니다. scripts/pi-kiosk 폴더를 통째로 복사해 주세요." >&2
  exit 1
fi

# ───────────────────────── 설정값 ─────────────────────────

# 이전 설치 값 (재설치할 때 다시 입력하지 않도록)
PREV_URL="$(sed -n 's/^KIOSK_URL=//p' /etc/default/miraepass-kiosk 2>/dev/null || true)"
PREV_PIN="$(sed -n 's/^MIRAEPASS_KIOSK_ADMIN_PIN=//p' /etc/default/miraepass-pi-control 2>/dev/null || true)"

KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-pi}}"
WIFI_COUNTRY="${WIFI_COUNTRY:-KR}"
DISPLAY_ROTATE="${DISPLAY_ROTATE:-normal}"
HIDE_CURSOR="${HIDE_CURSOR:-1}"

CLOUD_URL="${CLOUD_URL:-${PREV_URL}}"
if [[ -z "${CLOUD_URL}" && -t 0 ]]; then
  read -rp "클라우드 키오스크 URL (예: https://cafe.example.com/kiosk): " CLOUD_URL
fi
if [[ ! "${CLOUD_URL}" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "CLOUD_URL이 올바르지 않습니다 (http:// 또는 https:// 로 시작): '${CLOUD_URL}'" >&2
  exit 1
fi

ADMIN_PIN="${ADMIN_PIN:-${PREV_PIN}}"
if [[ -z "${ADMIN_PIN}" && -t 0 ]]; then
  read -rp "관리자 모드 PIN (숫자 4~8자리, 기본 2580): " ADMIN_PIN
fi
ADMIN_PIN="${ADMIN_PIN:-2580}"
if [[ ! "${ADMIN_PIN}" =~ ^[0-9]{4,8}$ ]]; then
  echo "ADMIN_PIN은 숫자 4~8자리여야 합니다." >&2
  exit 1
fi

case "${DISPLAY_ROTATE}" in
  normal | left | right | inverted) ;;
  *) echo "DISPLAY_ROTATE는 normal | left | right | inverted 중 하나여야 합니다." >&2; exit 1 ;;
esac

if ! id "${KIOSK_USER}" >/dev/null 2>&1; then
  echo "사용자 ${KIOSK_USER}를 찾을 수 없습니다. KIOSK_USER=... 로 지정하세요." >&2
  exit 1
fi
KIOSK_HOME="$(getent passwd "${KIOSK_USER}" | cut -d: -f6)"

# 클라우드 페이지 → 127.0.0.1 로컬 서비스 호출을 Chromium 정책으로 허용할 origin
CLOUD_ORIGIN="$(python3 -c 'import sys,urllib.parse as u; p=u.urlsplit(sys.argv[1]); print(f"{p.scheme}://{p.netloc}")' "${CLOUD_URL}")"

# ───────────────────────── 사전 확인 ─────────────────────────

# 관리자 모드의 네트워크 설정은 NetworkManager(nmcli)를 쓴다.
# Bookworm 이전(dhcpcd) 이미지에서 여기서 네트워크 스택을 바꾸면 SSH가 끊길 수 있어 설치를 멈춘다.
if ! systemctl is-active --quiet NetworkManager; then
  echo "NetworkManager가 실행 중이 아닙니다." >&2
  echo "Raspberry Pi OS Lite Bookworm(2023-10) 이후 이미지를 사용해 주세요. (기존 dhcpcd 이미지는 지원하지 않습니다)" >&2
  exit 1
fi

echo "==> 설치 설정"
echo "    사용자: ${KIOSK_USER} (${KIOSK_HOME})"
echo "    키오스크 URL: ${CLOUD_URL}"
echo "    Wi‑Fi 국가: ${WIFI_COUNTRY} · 화면 회전: ${DISPLAY_ROTATE} · 커서 숨김: ${HIDE_CURSOR}"

# ───────────────────────── 패키지 ─────────────────────────

echo "==> 패키지 설치"
export DEBIAN_FRONTEND=noninteractive
apt-get update

# Bookworm 초기 이미지는 chromium-browser, 이후/Trixie는 chromium
has_candidate() { apt-cache policy "$1" 2>/dev/null | grep -q 'Candidate: [^(]'; }
if has_candidate chromium; then
  CHROMIUM_PACKAGE="chromium"
elif has_candidate chromium-browser; then
  CHROMIUM_PACKAGE="chromium-browser"
else
  echo "설치할 수 있는 Chromium 패키지가 없습니다." >&2
  exit 1
fi

apt-get install -y --no-install-recommends \
  xserver-xorg xserver-xorg-legacy xserver-xorg-input-libinput xinit openbox dbus-x11 \
  x11-xserver-utils xinput \
  "${CHROMIUM_PACKAGE}" \
  network-manager rfkill python3 ca-certificates fonts-noto-cjk

# ───────────────────────── 시스템 설정 ─────────────────────────

echo "==> 사용자 권한 / Xorg 설정"
usermod -aG video,input,render,tty "${KIOSK_USER}" || true
# systemd 서비스(로그인 세션 밖)에서 일반 사용자가 Xorg를 띄울 수 있게 한다
cat >/etc/X11/Xwrapper.config <<'XWRAPPER'
allowed_users=anybody
needs_root_rights=yes
XWRAPPER

echo "==> Wi‑Fi 국가 설정 (${WIFI_COUNTRY})"
if command -v raspi-config >/dev/null 2>&1; then
  raspi-config nonint do_wifi_country "${WIFI_COUNTRY}" || echo "    (경고) Wi‑Fi 국가 설정에 실패했습니다"
fi
rfkill unblock wifi || true
nmcli radio wifi on || true

echo "==> Chromium 정책 설치"
# 키오스크에 방해되는 말풍선(비밀번호 저장·번역·자동완성)을 끄고,
# 클라우드 페이지가 127.0.0.1 로컬 서비스를 부를 때 '로컬 네트워크 접근' 권한 팝업이 뜨지 않게 허용한다.
for dir in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed; do
  mkdir -p "${dir}"
  cat >"${dir}/miraepass-kiosk.json" <<POLICY
{
  "PasswordManagerEnabled": false,
  "TranslateEnabled": false,
  "AutofillAddressEnabled": false,
  "AutofillCreditCardEnabled": false,
  "BrowserSignin": 0,
  "SyncDisabled": true,
  "DefaultNotificationsSetting": 2,
  "DefaultGeolocationSetting": 2,
  "MetricsReportingEnabled": false,
  "LocalNetworkAccessAllowedForUrls": ["${CLOUD_ORIGIN}", "http://127.0.0.1:8765"],
  "InsecurePrivateNetworkRequestsAllowedForUrls": ["${CLOUD_ORIGIN}"]
}
POLICY
done

# ───────────────────────── 로컬 제어 서비스 ─────────────────────────

echo "==> 로컬 제어 서비스 설치"
install -m 0755 "${SCRIPT_DIR}/miraepass-pi-control.py" /usr/local/bin/miraepass-pi-control.py
cat >/etc/default/miraepass-pi-control <<DEFAULT
MIRAEPASS_KIOSK_ADMIN_PIN=${ADMIN_PIN}
MIRAEPASS_PI_ALLOW_POWER=1
MIRAEPASS_KIOSK_URL=${CLOUD_URL}
DEFAULT
chmod 0600 /etc/default/miraepass-pi-control

cat >/etc/systemd/system/miraepass-pi-control.service <<'SERVICE'
[Unit]
Description=MIRAEPASS kiosk local control API
After=NetworkManager.service
Wants=NetworkManager.service

[Service]
Type=simple
EnvironmentFile=/etc/default/miraepass-pi-control
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 /usr/local/bin/miraepass-pi-control.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

# ───────────────────────── 키오스크 세션 ─────────────────────────

echo "==> 키오스크 실행 스크립트 설치"
cat >/usr/local/bin/miraepass-kiosk-session <<'SESSION'
#!/usr/bin/env bash
# xinit이 실행하는 X 세션: 화면 설정 → openbox → Chromium 키오스크
set -uo pipefail

export DISPLAY="${DISPLAY:-:0}"
ROTATE="${DISPLAY_ROTATE:-normal}"
START_URL="http://127.0.0.1:8765/launch"

# 화면 꺼짐/절전 끄기
xset -dpms || true
xset s off || true
xset s noblank || true

# 화면 회전 + 터치 좌표 보정
if [[ "${ROTATE}" != "normal" ]]; then
  OUTPUT="$(xrandr --query | awk '/ connected/{print $1; exit}')"
  [[ -n "${OUTPUT}" ]] && xrandr --output "${OUTPUT}" --rotate "${ROTATE}" || true
fi
case "${ROTATE}" in
  left) MATRIX="0 -1 1 1 0 0 0 0 1" ;;
  right) MATRIX="0 1 0 -1 0 1 0 0 1" ;;
  inverted) MATRIX="-1 0 1 0 -1 1 0 0 1" ;;
  *) MATRIX="1 0 0 0 1 0 0 0 1" ;;
esac
while IFS= read -r dev; do
  # shellcheck disable=SC2086
  xinput set-prop "pointer:${dev}" "Coordinate Transformation Matrix" ${MATRIX} 2>/dev/null || true
done < <(xinput list --name-only 2>/dev/null | grep -i -E 'touch|ft5x06|goodix|ilitek|egalax|wacom' || true)

openbox-session &

# 정전 등으로 꺼졌을 때 뜨는 "페이지 복원" 말풍선 방지
PREFS="${HOME}/.config/chromium/Default/Preferences"
if [[ -f "${PREFS}" ]]; then
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "${PREFS}" || true
fi

# 로컬 제어 서비스(시작 화면 제공)가 뜰 때까지 최대 20초 대기
for _ in $(seq 1 40); do
  (exec 3<>/dev/tcp/127.0.0.1/8765) 2>/dev/null && break
  sleep 0.5
done

CHROME="$(command -v chromium || command -v chromium-browser || true)"
if [[ -z "${CHROME}" ]]; then
  echo "chromium/chromium-browser를 찾을 수 없습니다." >&2
  exit 1
fi

exec "${CHROME}" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --password-store=basic \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  --disable-translate \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --touch-events=enabled \
  --ignore-gpu-blocklist \
  --enable-gpu-rasterization \
  --disable-features=Translate,TouchpadOverscrollHistoryNavigation,LocalNetworkAccessChecks \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  "${START_URL}"
SESSION
chmod 0755 /usr/local/bin/miraepass-kiosk-session

cat >/etc/default/miraepass-kiosk <<DEFAULT
KIOSK_URL=${CLOUD_URL}
DISPLAY_ROTATE=${DISPLAY_ROTATE}
DEFAULT

XORG_ARGS=":0 vt1 -keeptty -nolisten tcp -s 0 -dpms"
if [[ "${HIDE_CURSOR}" == "1" ]]; then
  XORG_ARGS="${XORG_ARGS} -nocursor"
fi

cat >/etc/systemd/system/miraepass-kiosk.service <<SERVICE
[Unit]
Description=MIRAEPASS Chromium kiosk
After=systemd-user-sessions.service miraepass-pi-control.service getty@tty1.service
Wants=miraepass-pi-control.service
Conflicts=getty@tty1.service

[Service]
User=${KIOSK_USER}
WorkingDirectory=${KIOSK_HOME}
EnvironmentFile=/etc/default/miraepass-kiosk
PAMName=login
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
UtmpIdentifier=tty1
UtmpMode=user
StandardInput=tty
StandardOutput=journal
StandardError=journal
ExecStart=/usr/bin/xinit /usr/local/bin/miraepass-kiosk-session -- ${XORG_ARGS}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

# ───────────────────────── 활성화 ─────────────────────────

echo "==> systemd 활성화"
systemctl daemon-reload
systemctl set-default multi-user.target >/dev/null
# tty1은 키오스크 화면이 쓴다 (SSH 접속에는 영향 없음)
systemctl disable getty@tty1.service >/dev/null 2>&1 || true
systemctl enable miraepass-pi-control.service miraepass-kiosk.service
systemctl restart miraepass-pi-control.service

sleep 1
if systemctl is-active --quiet miraepass-pi-control.service; then
  echo "    로컬 제어 서비스 실행 중 (127.0.0.1:8765)"
else
  echo "    (경고) 로컬 제어 서비스가 실행되지 않았습니다: journalctl -u miraepass-pi-control -n 50" >&2
fi

echo
echo "설치 완료"
echo "- 키오스크 URL: ${CLOUD_URL}"
echo "- 관리자 모드 PIN: ${ADMIN_PIN}"
echo "- 재부팅하면 Chromium 키오스크가 자동 실행됩니다: sudo reboot"
echo "- 지금 바로 시작: sudo systemctl start miraepass-kiosk"
echo "- 로그 확인: journalctl -u miraepass-kiosk -f"

if [[ "${REBOOT:-0}" == "1" ]]; then
  echo "==> 재부팅"
  systemctl reboot
fi
