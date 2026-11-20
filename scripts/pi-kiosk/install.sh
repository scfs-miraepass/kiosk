#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "sudo로 실행하세요: sudo CLOUD_URL=https://example.com/kiosk $0" >&2
  exit 1
fi

KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-pi}}"
CLOUD_URL="${CLOUD_URL:-}"
if [[ -z "${CLOUD_URL}" ]]; then
  read -rp "클라우드 키오스크 URL (예: https://cafe.example.com/kiosk): " CLOUD_URL
fi
if [[ -z "${CLOUD_URL}" ]]; then
  echo "CLOUD_URL이 필요합니다." >&2
  exit 1
fi
ADMIN_PIN="${ADMIN_PIN:-}"
if [[ -z "${ADMIN_PIN}" && -t 0 ]]; then
  read -rp "관리자 모드 PIN (기본 2580): " ADMIN_PIN
fi
ADMIN_PIN="${ADMIN_PIN:-2580}"
if [[ ! "${ADMIN_PIN}" =~ ^[0-9]{4,8}$ ]]; then
  echo "ADMIN_PIN은 숫자 4~8자리여야 합니다." >&2
  exit 1
fi

if ! id "${KIOSK_USER}" >/dev/null 2>&1; then
  echo "사용자 ${KIOSK_USER}를 찾을 수 없습니다. KIOSK_USER=... 로 지정하세요." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 패키지 설치"
apt-get update
CHROMIUM_PACKAGE="chromium-browser"
if ! apt-cache show chromium-browser >/dev/null 2>&1; then
  CHROMIUM_PACKAGE="chromium"
fi
apt-get install -y --no-install-recommends \
  xserver-xorg xinit openbox dbus-x11 x11-xserver-utils \
  "${CHROMIUM_PACKAGE}" unclutter network-manager python3 ca-certificates fonts-noto-cjk

echo "==> 사용자 권한 설정"
usermod -aG video,input,render,netdev "${KIOSK_USER}" || true
systemctl enable NetworkManager

echo "==> 로컬 제어 서비스 설치"
install -m 0755 "${SCRIPT_DIR}/miraepass-pi-control.py" /usr/local/bin/miraepass-pi-control.py
cat >/etc/default/miraepass-pi-control <<DEFAULT
MIRAEPASS_KIOSK_ADMIN_PIN=${ADMIN_PIN}
DEFAULT
chmod 0600 /etc/default/miraepass-pi-control
cat >/etc/systemd/system/miraepass-pi-control.service <<'SERVICE'
[Unit]
Description=MIRAEPASS kiosk local control API
After=network.target NetworkManager.service
Wants=NetworkManager.service

[Service]
Type=simple
EnvironmentFile=/etc/default/miraepass-pi-control
ExecStart=/usr/bin/python3 /usr/local/bin/miraepass-pi-control.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

echo "==> 키오스크 실행 스크립트 설치"
cat >/usr/local/bin/miraepass-kiosk-session <<'SESSION'
#!/usr/bin/env bash
set -euo pipefail

URL="${KIOSK_URL:?KIOSK_URL is required}"
export DISPLAY="${DISPLAY:-:0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/miraepass-kiosk-runtime}"
mkdir -p "${XDG_RUNTIME_DIR}"
chmod 700 "${XDG_RUNTIME_DIR}"

xset -dpms || true
xset s off || true
xset s noblank || true
unclutter -idle 0.5 -root &
openbox-session &

CHROME="$(command -v chromium-browser || command -v chromium || true)"
if [[ -z "${CHROME}" ]]; then
  echo "chromium-browser/chromium을 찾을 수 없습니다." >&2
  exit 1
fi

exec "${CHROME}" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --ignore-gpu-blocklist \
  --enable-gpu-rasterization \
  --enable-zero-copy \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --disable-features=Translate \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  "${URL}"
SESSION
chmod 0755 /usr/local/bin/miraepass-kiosk-session

cat >/etc/default/miraepass-kiosk <<DEFAULT
KIOSK_URL=${CLOUD_URL}
DEFAULT

cat >/etc/systemd/system/miraepass-kiosk.service <<SERVICE
[Unit]
Description=MIRAEPASS Chromium kiosk
After=systemd-user-sessions.service network-online.target miraepass-pi-control.service
Wants=network-online.target miraepass-pi-control.service

[Service]
User=${KIOSK_USER}
EnvironmentFile=/etc/default/miraepass-kiosk
Environment=XDG_RUNTIME_DIR=/tmp/miraepass-kiosk-runtime
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
StandardError=journal
ExecStart=/usr/bin/xinit /usr/local/bin/miraepass-kiosk-session -- :0 vt1 -nolisten tcp -s 0 -dpms
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

echo "==> systemd 활성화"
systemctl daemon-reload
systemctl enable miraepass-pi-control.service miraepass-kiosk.service
systemctl restart miraepass-pi-control.service

echo
echo "설치 완료"
echo "- 키오스크 URL: ${CLOUD_URL}"
echo "- 관리자 모드 PIN: ${ADMIN_PIN}"
echo "- 재부팅 후 Chromium 키오스크가 자동 실행됩니다."
echo "- 즉시 시작: sudo systemctl start miraepass-kiosk"
echo "- 로그 확인: journalctl -u miraepass-kiosk -f"
