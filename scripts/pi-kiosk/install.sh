#!/usr/bin/env bash
# MIRAEPASS 키오스크 설치 — systemd + NetworkManager 기반 리눅스
#
# 지원
#   - Raspberry Pi OS Lite (Bookworm 이상)  ← 기본 대상, 검증됨
#   - Debian / Ubuntu / Armbian 등 apt 계열
#   - Fedora 등 dnf 계열, Arch 등 pacman 계열
#   - 그 밖의 배포판: 필요한 패키지를 직접 설치한 뒤 SKIP_PACKAGES=1 로 실행
#
# SSH로 접속해 실행하는 것을 기준으로 한다. 다시 실행해도 안전하며(idempotent),
# 값을 생략하면 이전 설치 값(키오스크 URL, 관리자 PIN)을 그대로 쓴다.
#
#   sudo CLOUD_URL=https://cafe.example.com/kiosk ADMIN_PIN=2580 ./install.sh
#
# 선택 환경 변수
#   KIOSK_USER      키오스크를 실행할 사용자 (기본: sudo를 실행한 사용자)
#   WIFI_COUNTRY    Wi‑Fi 국가 코드 (기본: KR)
#   DISPLAY_ROTATE  화면 회전: normal | left | right | inverted (기본: normal). 터치 좌표도 같이 돌린다.
#   HIDE_CURSOR     1이면 마우스 커서를 숨긴다 (기본: 1, 터치 전용 기기)
#   SKIP_PACKAGES   1이면 패키지 설치를 건너뛴다 (지원하지 않는 배포판용)
#   NM_TAKEOVER     1이면 NetworkManager가 아닌 네트워크 관리자(dhcpcd·netplan·ifupdown 등)를
#                   다음 부팅부터 NetworkManager로 바꾼다. 지금 연결된 SSH는 끊지 않는다.
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

die() {
  echo "오류: $*" >&2
  exit 1
}
warn() { echo "    (경고) $*" >&2; }

command -v systemctl >/dev/null 2>&1 || die "systemd가 필요합니다."
command -v python3 >/dev/null 2>&1 || [[ "${SKIP_PACKAGES:-0}" != "1" ]] || die "python3가 필요합니다."

# ───────────────────────── 기기 / 배포판 감지 ─────────────────────────

OS_NAME="linux"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  OS_NAME="$(. /etc/os-release && echo "${PRETTY_NAME:-${ID:-linux}}")"
fi
DEVICE_MODEL="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || cat /sys/class/dmi/id/product_name 2>/dev/null || echo "알 수 없음")"
IS_RPI=0
[[ "${DEVICE_MODEL}" == *"Raspberry Pi"* ]] && IS_RPI=1

PKG="none"
if [[ "${SKIP_PACKAGES:-0}" != "1" ]]; then
  if command -v apt-get >/dev/null 2>&1; then
    PKG="apt"
  elif command -v dnf >/dev/null 2>&1; then
    PKG="dnf"
  elif command -v pacman >/dev/null 2>&1; then
    PKG="pacman"
  else
    die "지원하지 않는 패키지 관리자입니다. README의 필요 패키지를 직접 설치한 뒤 SKIP_PACKAGES=1 로 다시 실행하세요."
  fi
fi

# ───────────────────────── 설정값 ─────────────────────────

# 이전 설치 값 (재설치할 때 다시 입력하지 않도록)
PREV_URL="$(sed -n 's/^KIOSK_URL=//p' /etc/default/miraepass-kiosk 2>/dev/null || true)"
PREV_PIN="$(sed -n 's/^MIRAEPASS_KIOSK_ADMIN_PIN=//p' /etc/default/miraepass-pi-control 2>/dev/null || true)"

KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-pi}}"
WIFI_COUNTRY="${WIFI_COUNTRY:-KR}"
DISPLAY_ROTATE="${DISPLAY_ROTATE:-normal}"
HIDE_CURSOR="${HIDE_CURSOR:-1}"
NM_TAKEOVER="${NM_TAKEOVER:-0}"

CLOUD_URL="${CLOUD_URL:-${PREV_URL}}"
if [[ -z "${CLOUD_URL}" && -t 0 ]]; then
  read -rp "클라우드 키오스크 URL (예: https://cafe.example.com/kiosk): " CLOUD_URL
fi
[[ "${CLOUD_URL}" =~ ^https?://[^[:space:]]+$ ]] || die "CLOUD_URL이 올바르지 않습니다 (http:// 또는 https:// 로 시작): '${CLOUD_URL}'"

ADMIN_PIN="${ADMIN_PIN:-${PREV_PIN}}"
if [[ -z "${ADMIN_PIN}" && -t 0 ]]; then
  read -rp "관리자 모드 PIN (숫자 4~8자리, 기본 2580): " ADMIN_PIN
fi
ADMIN_PIN="${ADMIN_PIN:-2580}"
[[ "${ADMIN_PIN}" =~ ^[0-9]{4,8}$ ]] || die "ADMIN_PIN은 숫자 4~8자리여야 합니다."

case "${DISPLAY_ROTATE}" in
  normal | left | right | inverted) ;;
  *) die "DISPLAY_ROTATE는 normal | left | right | inverted 중 하나여야 합니다." ;;
esac
[[ "${WIFI_COUNTRY}" =~ ^[A-Z]{2}$ ]] || die "WIFI_COUNTRY는 대문자 두 글자 국가 코드여야 합니다 (예: KR)."

id "${KIOSK_USER}" >/dev/null 2>&1 || die "사용자 ${KIOSK_USER}를 찾을 수 없습니다. KIOSK_USER=... 로 지정하세요."
KIOSK_HOME="$(getent passwd "${KIOSK_USER}" | cut -d: -f6)"

# ───────────────────────── 네트워크 관리자 확인 ─────────────────────────
#
# 관리자 모드의 네트워크 설정은 NetworkManager(nmcli)를 쓴다.
# 다른 네트워크 관리자가 쓰이는 중에 NetworkManager를 바로 켜면 SSH가 끊길 수 있으므로,
# NM_TAKEOVER=1 일 때만 "다음 부팅부터" 바뀌도록 예약한다.

detect_network_manager() {
  if systemctl is-active --quiet NetworkManager 2>/dev/null; then
    echo "networkmanager"
  elif systemctl is-active --quiet dhcpcd 2>/dev/null; then
    echo "dhcpcd"
  elif systemctl is-active --quiet systemd-networkd 2>/dev/null; then
    if compgen -G "/etc/netplan/*.yaml" >/dev/null; then echo "netplan"; else echo "networkd"; fi
  elif cat /etc/network/interfaces /etc/network/interfaces.d/* 2>/dev/null | awk '$1=="iface" && $2!="lo"{f=1} END{exit !f}'; then
    echo "ifupdown"
  else
    echo "unknown"
  fi
}

NET_MANAGER="$(detect_network_manager)"
NEED_REBOOT=0

if [[ "${NET_MANAGER}" != "networkmanager" && "${NM_TAKEOVER}" != "1" ]]; then
  echo "NetworkManager가 실행 중이 아닙니다. (현재 네트워크 관리: ${NET_MANAGER})" >&2
  echo >&2
  echo "관리자 모드에서 유선/Wi‑Fi를 설정하려면 NetworkManager가 필요합니다." >&2
  echo "다음 부팅부터 NetworkManager로 바꾸려면 NM_TAKEOVER=1 을 붙여 다시 실행하세요:" >&2
  echo "  sudo NM_TAKEOVER=1 CLOUD_URL=${CLOUD_URL} $0" >&2
  echo >&2
  echo "주의: 전환 후에는 유선 LAN이 DHCP로 연결됩니다. 기존 고정 IP·Wi‑Fi 설정은 (netplan을 제외하고)" >&2
  echo "옮겨지지 않으니, 재부팅 뒤 관리자 모드나 'sudo nmtui'로 다시 설정해야 할 수 있습니다." >&2
  exit 1
fi

echo "==> 설치 설정"
echo "    기기: ${DEVICE_MODEL} · ${OS_NAME}"
echo "    패키지 관리자: ${PKG} · 네트워크: ${NET_MANAGER}"
echo "    사용자: ${KIOSK_USER} (${KIOSK_HOME})"
echo "    키오스크 URL: ${CLOUD_URL}"
echo "    Wi‑Fi 국가: ${WIFI_COUNTRY} · 화면 회전: ${DISPLAY_ROTATE} · 커서 숨김: ${HIDE_CURSOR}"

# ───────────────────────── 패키지 ─────────────────────────

find_browser() {
  local c
  for c in chromium chromium-browser google-chrome-stable google-chrome; do
    if command -v "${c}" >/dev/null 2>&1; then
      command -v "${c}"
      return 0
    fi
  done
  [[ -x /snap/bin/chromium ]] && echo /snap/bin/chromium && return 0
  return 1
}

install_apt() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update

  local browser_pkg=""
  if ! find_browser >/dev/null; then
    # Debian/Raspberry Pi OS: chromium (Bookworm 초기 RPi 이미지는 chromium-browser)
    # Ubuntu: chromium-browser (snap으로 설치됨)
    has_candidate() { apt-cache policy "$1" 2>/dev/null | grep -q 'Candidate: [^(]'; }
    if has_candidate chromium; then
      browser_pkg="chromium"
    elif has_candidate chromium-browser; then
      browser_pkg="chromium-browser"
    else
      die "설치할 수 있는 Chromium 패키지가 없습니다. Chromium 또는 Google Chrome을 직접 설치한 뒤 다시 실행하세요."
    fi
  fi

  # NetworkManager로 전환할 때는 패키지 설치 중 서비스가 바로 켜져 SSH가 끊기지 않도록 막아 둔다.
  local block_start=0
  if [[ "${NET_MANAGER}" != "networkmanager" && ! -e /usr/sbin/policy-rc.d ]]; then
    printf '#!/bin/sh\nexit 101\n' >/usr/sbin/policy-rc.d
    chmod 0755 /usr/sbin/policy-rc.d
    block_start=1
  fi

  local xwrapper_pkg=""
  apt-cache show xserver-xorg-legacy >/dev/null 2>&1 && xwrapper_pkg="xserver-xorg-legacy"

  set +e
  apt-get install -y --no-install-recommends \
    xserver-xorg ${xwrapper_pkg} xserver-xorg-input-libinput xinit openbox dbus-x11 \
    x11-xserver-utils xinput \
    network-manager rfkill iw python3 ca-certificates fonts-noto-cjk \
    ${browser_pkg}
  local rc=$?
  set -e
  [[ "${block_start}" == "1" ]] && rm -f /usr/sbin/policy-rc.d
  [[ "${rc}" == "0" ]] || die "패키지 설치에 실패했습니다."
}

install_dnf() {
  dnf install -y xorg-x11-server-Xorg xorg-x11-xinit xorg-x11-drv-libinput \
    NetworkManager NetworkManager-wifi util-linux iw python3 ca-certificates
  # 배포판/버전마다 이름이 다른 패키지는 하나씩 시도한다
  dnf install -y xrandr xset xinput || dnf install -y xorg-x11-server-utils xinput || warn "xrandr/xset/xinput 설치 실패"
  dnf install -y openbox dbus-x11 || warn "openbox 설치 실패 (창 관리자 없이 실행합니다)"
  dnf install -y google-noto-sans-cjk-fonts || dnf install -y google-noto-sans-cjk-ttc-fonts || warn "한글 글꼴 설치 실패"
  if ! find_browser >/dev/null; then
    dnf install -y chromium || die "Chromium 설치에 실패했습니다. (RHEL 계열은 EPEL이 필요합니다)"
  fi
}

install_pacman() {
  local browser_pkg=""
  find_browser >/dev/null || browser_pkg="chromium"
  pacman -Syu --needed --noconfirm \
    xorg-server xorg-xinit xf86-input-libinput xorg-xrandr xorg-xset xorg-xinput openbox \
    networkmanager util-linux iw python ca-certificates noto-fonts-cjk \
    ${browser_pkg}
}

echo "==> 패키지 설치 (${PKG})"
case "${PKG}" in
  apt) install_apt ;;
  dnf) install_dnf ;;
  pacman) install_pacman ;;
  none) echo "    건너뜀 (SKIP_PACKAGES=1)" ;;
esac

# 필수 명령 확인 (SKIP_PACKAGES로 직접 설치한 경우 포함)
for cmd in xinit Xorg nmcli python3; do
  command -v "${cmd}" >/dev/null 2>&1 || die "${cmd} 명령을 찾을 수 없습니다. 필요한 패키지를 설치해 주세요."
done
BROWSER_BIN="$(find_browser)" || die "Chromium 또는 Google Chrome을 찾을 수 없습니다."
echo "    브라우저: ${BROWSER_BIN}"

# ───────────────────────── NetworkManager 전환 (NM_TAKEOVER) ─────────────────────────

if [[ "${NET_MANAGER}" == "networkmanager" ]]; then
  systemctl enable NetworkManager >/dev/null 2>&1 || true
else
  echo "==> 다음 부팅부터 NetworkManager 사용 (${NET_MANAGER} → NetworkManager)"
  STAMP="$(date +%Y%m%d%H%M%S)"
  case "${NET_MANAGER}" in
    dhcpcd)
      systemctl disable dhcpcd >/dev/null 2>&1 || true
      ;;
    netplan)
      # netplan 설정은 그대로 두고 렌더러만 NetworkManager로 바꾼다 (기존 IP 설정이 옮겨진다)
      cat >/etc/netplan/99-miraepass-networkmanager.yaml <<'NETPLAN'
network:
  version: 2
  renderer: NetworkManager
NETPLAN
      chmod 0600 /etc/netplan/99-miraepass-networkmanager.yaml
      ;;
    networkd)
      systemctl disable systemd-networkd.service systemd-networkd.socket systemd-networkd-wait-online.service >/dev/null 2>&1 || true
      ;;
    ifupdown)
      BACKUP="/etc/network/miraepass-backup-${STAMP}"
      mkdir -p "${BACKUP}"
      cp -a /etc/network/interfaces "${BACKUP}/" 2>/dev/null || true
      if compgen -G "/etc/network/interfaces.d/*" >/dev/null; then
        mv /etc/network/interfaces.d/* "${BACKUP}/"
      fi
      cat >/etc/network/interfaces <<IFACES
# MIRAEPASS 키오스크: 네트워크는 NetworkManager가 관리합니다.
# 이전 설정: ${BACKUP}
auto lo
iface lo inet loopback
IFACES
      ;;
    unknown)
      warn "현재 네트워크 관리자를 알 수 없어 NetworkManager만 켭니다. 충돌하는 서비스가 있으면 직접 꺼 주세요."
      ;;
  esac
  # Ubuntu 등은 서버 설치 시 유선 장치를 NetworkManager가 관리하지 않도록 막아 둔다. 같은 이름의 빈 파일로 덮어 해제한다.
  mkdir -p /etc/NetworkManager/conf.d
  : >/etc/NetworkManager/conf.d/10-globally-managed-devices.conf
  systemctl enable NetworkManager
  NEED_REBOOT=1
fi

# ───────────────────────── 시스템 설정 ─────────────────────────

echo "==> 사용자 권한 / Xorg 설정"
for group in video input render tty; do
  if getent group "${group}" >/dev/null; then
    usermod -aG "${group}" "${KIOSK_USER}"
  fi
done
# systemd 서비스에서 일반 사용자가 Xorg를 띄울 수 있게 한다 (Debian xserver-xorg-legacy / Xorg.wrap 공통)
mkdir -p /etc/X11
cat >/etc/X11/Xwrapper.config <<'XWRAPPER'
allowed_users=anybody
needs_root_rights=yes
XWRAPPER

echo "==> Wi‑Fi 국가 설정 (${WIFI_COUNTRY})"
if [[ "${IS_RPI}" == "1" ]] && command -v raspi-config >/dev/null 2>&1; then
  raspi-config nonint do_wifi_country "${WIFI_COUNTRY}" || warn "Wi‑Fi 국가 설정에 실패했습니다"
else
  # 일반 리눅스: 부팅할 때마다 적용되도록 cfg80211 모듈 옵션으로 지정
  echo "options cfg80211 ieee80211_regdom=${WIFI_COUNTRY}" >/etc/modprobe.d/miraepass-wifi-country.conf
  command -v iw >/dev/null 2>&1 && iw reg set "${WIFI_COUNTRY}" 2>/dev/null || true
fi
rfkill unblock wifi 2>/dev/null || true
if [[ "${NET_MANAGER}" == "networkmanager" ]]; then
  nmcli radio wifi on 2>/dev/null || true
fi

# 클라우드 페이지 → 127.0.0.1 로컬 서비스 호출을 Chromium 정책으로 허용할 origin
CLOUD_ORIGIN="$(python3 -c 'import sys,urllib.parse as u; p=u.urlsplit(sys.argv[1]); print(f"{p.scheme}://{p.netloc}")' "${CLOUD_URL}")"

echo "==> 브라우저 정책 설치"
# 키오스크에 방해되는 말풍선(비밀번호 저장·번역·자동완성)을 끄고,
# 클라우드 페이지가 127.0.0.1 로컬 서비스를 부를 때 '로컬 네트워크 접근' 권한 팝업이 뜨지 않게 허용한다.
# chromium(Debian/Fedora/Arch), chromium-browser(Raspberry Pi 구버전·Ubuntu snap), Google Chrome 경로에 모두 둔다.
for dir in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed /etc/opt/chrome/policies/managed; do
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
mkdir -p /etc/default
cat >/etc/default/miraepass-pi-control <<DEFAULT
MIRAEPASS_KIOSK_ADMIN_PIN=${ADMIN_PIN}
MIRAEPASS_PI_ALLOW_POWER=1
MIRAEPASS_KIOSK_URL=${CLOUD_URL}
DEFAULT
chmod 0600 /etc/default/miraepass-pi-control

PYTHON_BIN="$(command -v python3)"
cat >/etc/systemd/system/miraepass-pi-control.service <<SERVICE
[Unit]
Description=MIRAEPASS kiosk local control API
After=NetworkManager.service
Wants=NetworkManager.service

[Service]
Type=simple
EnvironmentFile=/etc/default/miraepass-pi-control
Environment=PYTHONUNBUFFERED=1
ExecStart=${PYTHON_BIN} /usr/local/bin/miraepass-pi-control.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

# ───────────────────────── 키오스크 세션 ─────────────────────────

echo "==> 키오스크 실행 스크립트 설치"
cat >/usr/local/bin/miraepass-kiosk-session <<'SESSION'
#!/usr/bin/env bash
# xinit이 실행하는 X 세션: 화면 설정 → 창 관리자 → Chromium 키오스크
set -uo pipefail

export DISPLAY="${DISPLAY:-:0}"
export PATH="${PATH}:/snap/bin"
ROTATE="${DISPLAY_ROTATE:-normal}"
START_URL="http://127.0.0.1:8765/launch"

# 화면 꺼짐/절전 끄기
xset -dpms 2>/dev/null || true
xset s off 2>/dev/null || true
xset s noblank 2>/dev/null || true

# 화면 회전 + 터치 좌표 보정
if [[ "${ROTATE}" != "normal" ]] && command -v xrandr >/dev/null 2>&1; then
  OUTPUT="$(xrandr --query | awk '/ connected/{print $1; exit}')"
  [[ -n "${OUTPUT}" ]] && xrandr --output "${OUTPUT}" --rotate "${ROTATE}" || true
fi
case "${ROTATE}" in
  left) MATRIX="0 -1 1 1 0 0 0 0 1" ;;
  right) MATRIX="0 1 0 -1 0 1 0 0 1" ;;
  inverted) MATRIX="-1 0 1 0 -1 1 0 0 1" ;;
  *) MATRIX="1 0 0 0 1 0 0 0 1" ;;
esac
if command -v xinput >/dev/null 2>&1; then
  while IFS= read -r dev; do
    # shellcheck disable=SC2086
    xinput set-prop "pointer:${dev}" "Coordinate Transformation Matrix" ${MATRIX} 2>/dev/null || true
  done < <(xinput list --name-only 2>/dev/null | grep -i -E 'touch|ft5x06|goodix|ilitek|egalax|eeti|wacom|elan' || true)
fi

# 창 관리자 (없어도 Chromium --kiosk는 동작한다)
if command -v openbox-session >/dev/null 2>&1; then
  openbox-session &
elif command -v openbox >/dev/null 2>&1; then
  openbox &
fi

# 정전 등으로 꺼졌을 때 뜨는 "페이지 복원" 말풍선 방지
for PREFS in \
  "${HOME}/.config/chromium/Default/Preferences" \
  "${HOME}/.config/google-chrome/Default/Preferences" \
  "${HOME}/snap/chromium/common/chromium/Default/Preferences"; do
  [[ -f "${PREFS}" ]] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "${PREFS}" || true
done

# 로컬 제어 서비스(시작 화면 제공)가 뜰 때까지 최대 20초 대기
for _ in $(seq 1 40); do
  (exec 3<>/dev/tcp/127.0.0.1/8765) 2>/dev/null && break
  sleep 0.5
done

CHROME=""
for c in chromium chromium-browser google-chrome-stable google-chrome; do
  CHROME="$(command -v "${c}" 2>/dev/null)" && break
done
if [[ -z "${CHROME}" ]]; then
  echo "chromium / google-chrome을 찾을 수 없습니다." >&2
  exit 1
fi

# CHROMIUM_EXTRA_FLAGS: 기기별 추가 플래그 (/etc/default/miraepass-kiosk)
# shellcheck disable=SC2086
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
  --disable-features=Translate,TouchpadOverscrollHistoryNavigation,LocalNetworkAccessChecks \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  ${CHROMIUM_EXTRA_FLAGS:-} \
  "${START_URL}"
SESSION
chmod 0755 /usr/local/bin/miraepass-kiosk-session

# 라즈베리파이 GPU(VideoCore)는 블록리스트를 풀어야 GPU 래스터화가 켜진다. 다른 기기는 Chromium 기본값을 쓴다.
CHROMIUM_EXTRA_FLAGS="$(sed -n 's/^CHROMIUM_EXTRA_FLAGS=//p' /etc/default/miraepass-kiosk 2>/dev/null | tr -d '"' || true)"
if [[ -z "${CHROMIUM_EXTRA_FLAGS}" && "${IS_RPI}" == "1" ]]; then
  CHROMIUM_EXTRA_FLAGS="--ignore-gpu-blocklist --enable-gpu-rasterization"
fi

cat >/etc/default/miraepass-kiosk <<DEFAULT
KIOSK_URL=${CLOUD_URL}
DISPLAY_ROTATE=${DISPLAY_ROTATE}
CHROMIUM_EXTRA_FLAGS="${CHROMIUM_EXTRA_FLAGS}"
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
ExecStart=$(command -v xinit) /usr/local/bin/miraepass-kiosk-session -- ${XORG_ARGS}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

# ───────────────────────── 활성화 ─────────────────────────

echo "==> systemd 활성화"
systemctl daemon-reload
# 데스크톱 배포판이면 로그인 화면(디스플레이 매니저) 대신 키오스크가 tty1을 쓴다
if [[ -e /etc/systemd/system/display-manager.service ]]; then
  warn "데스크톱 로그인 화면이 설치돼 있습니다. 부팅 기본값을 콘솔(multi-user)로 바꿔 키오스크만 실행합니다."
fi
systemctl set-default multi-user.target >/dev/null
# tty1은 키오스크 화면이 쓴다 (SSH 접속에는 영향 없음)
systemctl disable getty@tty1.service >/dev/null 2>&1 || true
systemctl enable miraepass-pi-control.service miraepass-kiosk.service
systemctl restart miraepass-pi-control.service

sleep 1
if systemctl is-active --quiet miraepass-pi-control.service; then
  echo "    로컬 제어 서비스 실행 중 (127.0.0.1:8765)"
else
  warn "로컬 제어 서비스가 실행되지 않았습니다: journalctl -u miraepass-pi-control -n 50"
fi

echo
echo "설치 완료"
echo "- 기기: ${DEVICE_MODEL} · ${OS_NAME}"
echo "- 키오스크 URL: ${CLOUD_URL}"
echo "- 관리자 모드 PIN: ${ADMIN_PIN}"
echo "- 재부팅하면 Chromium 키오스크가 자동 실행됩니다: sudo reboot"
if [[ "${NEED_REBOOT}" == "1" ]]; then
  echo "- NetworkManager 전환은 재부팅 후 적용됩니다. 재부팅 뒤 유선 LAN은 DHCP로 연결되며,"
  echo "  IP가 바뀌어 SSH 주소가 달라질 수 있습니다. (관리자 모드 › 상태에서 IP 확인)"
else
  echo "- 지금 바로 시작: sudo systemctl start miraepass-kiosk"
fi
echo "- 로그 확인: journalctl -u miraepass-kiosk -f"

if [[ "${REBOOT:-0}" == "1" ]]; then
  echo "==> 재부팅"
  systemctl reboot
fi
