#!/usr/bin/env bash
# MIRAEPASS 키오스크 설치 — systemd + NetworkManager 기반 리눅스
#
# 지원
#   - Raspberry Pi OS Lite (Bookworm 이상)  ← 기본 대상, 검증됨
#   - Debian / Ubuntu / Armbian 등 apt 계열
#   - Fedora 등 dnf 계열, Arch 등 pacman 계열
#   - 그 밖의 배포판: 필요한 패키지를 직접 설치한 뒤 SKIP_PACKAGES=1 로 실행
#
# 사용법
#   sudo CLOUD_URL=https://cafe.example.com/kiosk ADMIN_PIN=2580 ./install.sh   # 처음 설치
#   sudo ./install.sh --update                                                  # 설치된 기기 업데이트
#
# 처음 설치: SSH로 접속해 실행하는 것을 기준으로 한다. 이미 설치된 기기에서는 실행되지 않는다.
#   다시 설치하려면 먼저 삭제(uninstall.sh)한 뒤 실행한다. 설치는 항상 아래 기본값(또는 실행할 때 준 값)으로 시작한다.
# 업데이트(--update): 설정(URL·PIN·화면 방향·방화벽·네트워크 등)은 그대로 두고 프로그램 파일만 새 버전으로 바꾼다.
#   보통은 자동 업데이트나 관리자 모드 › 업데이트가 실행한다.
#
# 선택 환경 변수 (처음 설치)
#   KIOSK_USER      키오스크를 실행할 사용자 (기본: sudo를 실행한 사용자)
#   WIFI_COUNTRY    Wi‑Fi 국가 코드 (기본: KR)
#   DISPLAY_ROTATE  화면 회전: normal | left | right | inverted (기본: normal). 터치 좌표도 같이 돌린다.
#   HIDE_CURSOR     1이면 마우스 커서를 숨긴다 (기본: 1, 터치 전용 기기)
#   FIREWALL        1이면 들어오는 연결을 모두 차단하는 방화벽을 켠다 (기본: 1).
#                   SSH가 켜져 있으면 SSH 포트는 허용된다. 관리자 모드 › 보안에서 켜고 끌 수 있다.
#   AUTO_UPDATE     1이면 매일 새벽 자동 업데이트 (기본: 1). 관리자 모드 › 업데이트에서 켜고 끌 수 있다.
#   CHROMIUM_EXTRA_FLAGS  Chromium 추가 플래그 (기본: 라즈베리파이는 GPU 래스터화 플래그, 그 외 없음)
#   KIOSK_VERSION   관리자 모드에 표시할 버전 (기본: 저장소 package.json 버전 + git 커밋, 없으면 이 폴더의 VERSION 파일)
#   UPDATE_REPO     업데이트를 받을 GitHub 저장소 owner/repo (기본: 저장소 git remote, 없으면 scfs-miraepass/kiosk)
#   SKIP_PACKAGES   1이면 패키지 설치를 건너뛴다 (지원하지 않는 배포판용)
#   NM_TAKEOVER     1이면 NetworkManager가 아닌 네트워크 관리자(dhcpcd·netplan·ifupdown 등)를
#                   다음 부팅부터 NetworkManager로 바꾼다. 지금 연결된 SSH는 끊지 않는다.
#   REBOOT          1이면 설치 후 바로 재부팅
set -euo pipefail

MODE="install"
case "${1:-}" in
  "") ;;
  --update) MODE="update" ;;
  *) echo "사용법: $0 [--update]" >&2; exit 2 ;;
esac

if [[ "${EUID}" -ne 0 ]]; then
  echo "sudo로 실행하세요: sudo CLOUD_URL=https://example.com/kiosk $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for f in miraepass-kiosk-control.py launch.html uninstall.sh; do
  if [[ ! -f "${SCRIPT_DIR}/${f}" ]]; then
    echo "${SCRIPT_DIR}/${f} 가 없습니다. scripts/kiosk-device 폴더를 통째로 복사해 주세요." >&2
    exit 1
  fi
done

die() {
  echo "오류: $*" >&2
  exit 1
}
warn() { echo "    (경고) $*" >&2; }

command -v systemctl >/dev/null 2>&1 || die "systemd가 필요합니다."

STATE_DIR=/etc/miraepass
STATE_FILE="${STATE_DIR}/install-state"

if [[ "${MODE}" == "install" ]]; then
  # 이미 설치된 기기에서는 실행하지 않는다 (설정이 섞이지 않도록 삭제 후 기본값으로 새로 설치)
  for installed in "${STATE_FILE}" \
    /etc/systemd/system/miraepass-kiosk.service \
    /etc/systemd/system/miraepass-kiosk-control.service \
    /etc/systemd/system/miraepass-firewall.service; do
    if [[ -e "${installed}" ]]; then
      echo "이미 MIRAEPASS 키오스크가 설치돼 있습니다. (${installed})" >&2
      echo "새 버전으로 바꾸려면:   sudo ${SCRIPT_DIR}/install.sh --update" >&2
      echo "처음부터 다시 설치하려면 먼저 삭제한 뒤 실행하세요:" >&2
      echo "  sudo miraepass-kiosk-uninstall   # 또는 sudo ${SCRIPT_DIR}/uninstall.sh" >&2
      echo "  sudo CLOUD_URL=... ${SCRIPT_DIR}/install.sh" >&2
      exit 1
    fi
  done
  command -v python3 >/dev/null 2>&1 || [[ "${SKIP_PACKAGES:-0}" != "1" ]] || die "python3가 필요합니다."
else
  [[ -f "${STATE_FILE}" && -f /etc/default/miraepass-kiosk && -f /etc/default/miraepass-kiosk-control ]] \
    || die "설치된 키오스크를 찾을 수 없습니다. 처음 설치는 --update 없이 실행하세요."
fi

# ───────────────────────── 기기 / 배포판 감지 ─────────────────────────

OS_NAME="linux"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  OS_NAME="$(. /etc/os-release && echo "${PRETTY_NAME:-${ID:-linux}}")"
fi
DEVICE_MODEL="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || cat /sys/class/dmi/id/product_name 2>/dev/null || echo "알 수 없음")"
IS_RPI=0
[[ "${DEVICE_MODEL}" == *"Raspberry Pi"* ]] && IS_RPI=1

if [[ "${MODE}" == "install" ]]; then

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

KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-pi}}"
WIFI_COUNTRY="${WIFI_COUNTRY:-KR}"
DISPLAY_ROTATE="${DISPLAY_ROTATE:-normal}"
HIDE_CURSOR="${HIDE_CURSOR:-1}"
FIREWALL="${FIREWALL:-1}"
NM_TAKEOVER="${NM_TAKEOVER:-0}"

CLOUD_URL="${CLOUD_URL:-}"
if [[ -z "${CLOUD_URL}" && -t 0 ]]; then
  read -rp "클라우드 키오스크 URL (예: https://cafe.example.com/kiosk): " CLOUD_URL
fi
[[ "${CLOUD_URL}" =~ ^https?://[^[:space:]]+$ ]] || die "CLOUD_URL이 올바르지 않습니다 (http:// 또는 https:// 로 시작): '${CLOUD_URL}'"

ADMIN_PIN="${ADMIN_PIN:-}"
if [[ -z "${ADMIN_PIN}" && -t 0 ]]; then
  read -rp "관리자 모드 PIN (숫자 4~8자리, 기본 2580): " ADMIN_PIN
fi
ADMIN_PIN="${ADMIN_PIN:-2580}"
[[ "${ADMIN_PIN}" =~ ^[0-9]{4,8}$ ]] || die "ADMIN_PIN은 숫자 4~8자리여야 합니다."

case "${DISPLAY_ROTATE}" in
  normal | left | right | inverted) ;;
  *) die "DISPLAY_ROTATE는 normal | left | right | inverted 중 하나여야 합니다." ;;
esac
[[ "${FIREWALL}" =~ ^[01]$ ]] || die "FIREWALL은 0 또는 1이어야 합니다."
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
echo "    Wi‑Fi 국가: ${WIFI_COUNTRY} · 화면 회전: ${DISPLAY_ROTATE} · 커서 숨김: ${HIDE_CURSOR} · 방화벽: ${FIREWALL}"

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
    network-manager rfkill iw nftables python3 ca-certificates fonts-noto-cjk \
    ${browser_pkg}
  local rc=$?
  set -e
  [[ "${block_start}" == "1" ]] && rm -f /usr/sbin/policy-rc.d
  [[ "${rc}" == "0" ]] || die "패키지 설치에 실패했습니다."
}

install_dnf() {
  dnf install -y xorg-x11-server-Xorg xorg-x11-xinit xorg-x11-drv-libinput \
    NetworkManager NetworkManager-wifi util-linux iw nftables python3 ca-certificates
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
    networkmanager util-linux iw nftables python ca-certificates noto-fonts-cjk \
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
for cmd in xinit Xorg nmcli nft python3; do
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
  mkdir -p /etc/miraepass
  grep -q "^NM_TAKEOVER_FROM=" /etc/miraepass/install-state 2>/dev/null \
    || echo "NM_TAKEOVER_FROM=${NET_MANAGER}${BACKUP:+ (백업: ${BACKUP})}" >>/etc/miraepass/install-state
fi

# ───────────────────────── 설치 전 상태 기록 (삭제 스크립트용) ─────────────────────────
# uninstall.sh가 이 기록으로 설치 전 시스템 설정을 되돌린다. 이 파일이 있으면 "설치됨"으로 본다.
STATE_DIR=/etc/miraepass
STATE_FILE="${STATE_DIR}/install-state"
mkdir -p "${STATE_DIR}/backup"
record_state() {
  grep -q "^$1=" "${STATE_FILE}" 2>/dev/null || echo "$1=$2" >>"${STATE_FILE}"
}
record_state PREV_DEFAULT_TARGET "$(systemctl get-default 2>/dev/null || echo multi-user.target)"
record_state GETTY_TTY1_ENABLED "$(systemctl is-enabled getty@tty1.service 2>/dev/null || echo enabled)"
if ! grep -q "^XWRAPPER_BACKUP=" "${STATE_FILE}" 2>/dev/null; then
  if [[ -f /etc/X11/Xwrapper.config ]]; then
    cp -a /etc/X11/Xwrapper.config "${STATE_DIR}/backup/Xwrapper.config"
    record_state XWRAPPER_BACKUP 1
  else
    record_state XWRAPPER_BACKUP 0
  fi
fi
record_state KIOSK_USER "${KIOSK_USER}"

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

# 라즈베리파이는 RTC가 없어 시간 동기화가 꺼져 있으면 시간이 틀어지고, HTTPS(클라우드 화면·GitHub 업데이트)가 인증서 오류로 실패한다
if command -v timedatectl >/dev/null 2>&1; then
  timedatectl set-ntp true 2>/dev/null || warn "시간 자동 동기화(NTP)를 켜지 못했습니다. 시간 동기화 서비스(systemd-timesyncd·chrony 등)를 설치해 주세요."
fi

else

# ───────────────────────── 기존 설정 읽기 (--update) ─────────────────────────

conf() { sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n1 | sed 's/^"//; s/"$//'; }
CLOUD_URL="$(conf /etc/default/miraepass-kiosk KIOSK_URL)"
DISPLAY_ROTATE="$(conf /etc/default/miraepass-kiosk DISPLAY_ROTATE)"
CHROMIUM_EXTRA_FLAGS="$(conf /etc/default/miraepass-kiosk CHROMIUM_EXTRA_FLAGS)"
ADMIN_PIN="$(conf /etc/default/miraepass-kiosk-control MIRAEPASS_KIOSK_ADMIN_PIN)"
KIOSK_USER="$(conf "${STATE_FILE}" KIOSK_USER)"
HIDE_CURSOR=0
grep -q -- "-nocursor" /etc/systemd/system/miraepass-kiosk.service 2>/dev/null && HIDE_CURSOR=1
DISPLAY_ROTATE="${DISPLAY_ROTATE:-normal}"
NEED_REBOOT=0

[[ -n "${CLOUD_URL}" && -n "${ADMIN_PIN}" && -n "${KIOSK_USER}" ]] || die "기존 설정을 읽지 못했습니다. 삭제 후 다시 설치해 주세요."
id "${KIOSK_USER}" >/dev/null 2>&1 || die "키오스크 사용자 ${KIOSK_USER}를 찾을 수 없습니다."
KIOSK_HOME="$(getent passwd "${KIOSK_USER}" | cut -d: -f6)"
for cmd in xinit Xorg nmcli nft python3; do
  command -v "${cmd}" >/dev/null 2>&1 || die "${cmd} 명령이 없습니다. 이 업데이트는 새 패키지가 필요하니 삭제 후 다시 설치해 주세요."
done

echo "==> 업데이트 (설정 유지)"
echo "    기기: ${DEVICE_MODEL} · ${OS_NAME}"
echo "    사용자: ${KIOSK_USER} · 키오스크 URL: ${CLOUD_URL}"

# 바뀌었을 때만 키오스크 화면을 다시 시작하려고, 화면에 영향을 주는 파일의 지금 상태를 기억해 둔다
SCREEN_FILES=(
  /usr/local/bin/miraepass-kiosk-session
  /usr/local/bin/miraepass-kiosk-rotate
  /etc/systemd/system/miraepass-kiosk.service
  /etc/chromium/policies/managed/miraepass-kiosk.json
)
# 설정 파일은 줄 순서와 무관하게 내용만 비교한다 (관리자 모드에서 화면 방향을 바꾸면 줄 위치가 바뀔 수 있음)
screen_digest() {
  { cat "${SCREEN_FILES[@]}" 2>/dev/null; grep -v -E '^\s*(#|$)' /etc/default/miraepass-kiosk 2>/dev/null | sort; } | sha256sum | cut -d' ' -f1
}
# 이 기능이 생기기 전에 설치된 기기는 업데이트 타이머가 없다. 새로 생기면 켜 준다.
UPDATE_TIMER_EXISTED=0
[[ -e /etc/systemd/system/miraepass-kiosk-update.timer ]] && UPDATE_TIMER_EXISTED=1
SCREEN_BEFORE="$(screen_digest)"

fi

# 설치하는 키오스크 버전 (관리자 모드에 표시)
#   KIOSK_VERSION → 저장소 package.json 버전 + git 커밋 → 이 폴더의 VERSION 파일 (릴리스할 때 자동으로 맞춰짐)
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
if [[ -z "${KIOSK_VERSION:-}" && -f "${REPO_DIR}/package.json" ]]; then
  # 다른 프로젝트의 package.json을 읽지 않도록 이름을 확인한다
  KIOSK_VERSION="$(python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); print(p["version"] if p.get("name")=="miraepass-kiosk" else "")' "${REPO_DIR}/package.json" 2>/dev/null || true)"
  if [[ -n "${KIOSK_VERSION}" ]] && command -v git >/dev/null 2>&1; then
    # sudo(root)로 사용자 소유 저장소를 읽으므로 safe.directory를 지정한다
    COMMIT="$(git -c safe.directory='*' -C "${REPO_DIR}" rev-parse --short HEAD 2>/dev/null || true)"
    if [[ -n "${COMMIT}" ]]; then
      DIRTY="$(git -c safe.directory='*' -C "${REPO_DIR}" status --porcelain -- scripts/kiosk-device 2>/dev/null | head -n1 || true)"
      KIOSK_VERSION="${KIOSK_VERSION}+${COMMIT}${DIRTY:+.dirty}"
    fi
  fi
fi
# scripts/kiosk-device 폴더만 복사했거나 저장소 압축 파일로 받은 경우
if [[ -z "${KIOSK_VERSION:-}" && -f "${SCRIPT_DIR}/VERSION" ]]; then
  KIOSK_VERSION="$(tr -d '[:space:]' <"${SCRIPT_DIR}/VERSION")"
fi
[[ -z "${KIOSK_VERSION:-}" || "${KIOSK_VERSION}" =~ ^[0-9A-Za-z.+-]+$ ]] || die "버전 형식이 올바르지 않습니다: ${KIOSK_VERSION}"
KIOSK_VERSION="${KIOSK_VERSION:-unknown}"
# 업데이트를 받을 GitHub 저장소 (owner/repo). 업데이트 때는 기존 값을 유지하고,
# 처음 설치 때는 UPDATE_REPO → 저장소 git remote → 기본값 순으로 정한다.
if [[ "${MODE}" == "update" ]]; then
  UPDATE_REPO="${UPDATE_REPO:-$(sed -n 's/^MIRAEPASS_KIOSK_UPDATE_REPO=//p' /etc/default/miraepass-kiosk-control 2>/dev/null | head -n1)}"
fi
if [[ -z "${UPDATE_REPO:-}" ]] && command -v git >/dev/null 2>&1; then
  REMOTE="$(git -c safe.directory='*' -C "${REPO_DIR}" remote get-url origin 2>/dev/null || true)"
  if [[ "${REMOTE}" =~ github\.com[:/]([^/]+/[^/]+)$ ]]; then
    UPDATE_REPO="${BASH_REMATCH[1]%.git}"
  fi
fi
UPDATE_REPO="${UPDATE_REPO:-scfs-miraepass/kiosk}"
[[ "${UPDATE_REPO}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "UPDATE_REPO는 owner/repo 형식이어야 합니다: ${UPDATE_REPO}"

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
install -m 0755 "${SCRIPT_DIR}/miraepass-kiosk-control.py" /usr/local/bin/miraepass-kiosk-control.py
# 로컬 시작 화면: 인터넷이 없어도 이 화면에서 유선/Wi‑Fi를 설정할 수 있다
install -d /usr/local/share/miraepass-kiosk
install -m 0644 "${SCRIPT_DIR}/launch.html" /usr/local/share/miraepass-kiosk/launch.html
# 저장소 폴더 없이도 지울 수 있도록 삭제 스크립트를 함께 둔다
install -m 0755 "${SCRIPT_DIR}/uninstall.sh" /usr/local/sbin/miraepass-kiosk-uninstall
mkdir -p /etc/default
# 사용자가 직접 추가한 줄(예: MIRAEPASS_KIOSK_ALLOWED_ORIGINS)은 업데이트해도 남긴다
keep_extra() { grep -v -E "^($2)=" "$1" 2>/dev/null | grep -v -E '^\s*(#|$)' || true; }
EXTRA_CONTROL_ENV="$(keep_extra /etc/default/miraepass-kiosk-control 'MIRAEPASS_KIOSK_(ADMIN_PIN|ALLOW_POWER|URL|VERSION|UPDATE_REPO|USER|ENV_FILE|ROTATE_BIN)')"
EXTRA_KIOSK_ENV="$(keep_extra /etc/default/miraepass-kiosk 'KIOSK_URL|DISPLAY_ROTATE|CHROMIUM_EXTRA_FLAGS')"
cat >/etc/default/miraepass-kiosk-control <<DEFAULT
MIRAEPASS_KIOSK_ADMIN_PIN=${ADMIN_PIN}
MIRAEPASS_KIOSK_ALLOW_POWER=1
MIRAEPASS_KIOSK_URL=${CLOUD_URL}
MIRAEPASS_KIOSK_VERSION=${KIOSK_VERSION}
MIRAEPASS_KIOSK_UPDATE_REPO=${UPDATE_REPO}
MIRAEPASS_KIOSK_USER=${KIOSK_USER}
MIRAEPASS_KIOSK_ENV_FILE=/etc/default/miraepass-kiosk
MIRAEPASS_KIOSK_ROTATE_BIN=/usr/local/bin/miraepass-kiosk-rotate
DEFAULT
[[ -n "${EXTRA_CONTROL_ENV}" ]] && echo "${EXTRA_CONTROL_ENV}" >>/etc/default/miraepass-kiosk-control
chmod 0600 /etc/default/miraepass-kiosk-control

PYTHON_BIN="$(command -v python3)"
cat >/etc/systemd/system/miraepass-kiosk-control.service <<SERVICE
[Unit]
Description=MIRAEPASS kiosk local control API
After=NetworkManager.service
Wants=NetworkManager.service

[Service]
Type=simple
EnvironmentFile=/etc/default/miraepass-kiosk-control
Environment=PYTHONUNBUFFERED=1
ExecStart=${PYTHON_BIN} /usr/local/bin/miraepass-kiosk-control.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

# 업데이트: 관리자 모드 요청이나 매일 새벽 타이머로 실행. 로컬 서비스와 다른 프로세스라 적용 중 서비스가 재시작돼도 끊기지 않는다.
cat >/etc/systemd/system/miraepass-kiosk-update.service <<SERVICE
[Unit]
Description=MIRAEPASS kiosk device script update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/default/miraepass-kiosk-control
Environment=PYTHONUNBUFFERED=1
ExecStart=${PYTHON_BIN} /usr/local/bin/miraepass-kiosk-control.py update
TimeoutStartSec=20min
SERVICE

cat >/etc/systemd/system/miraepass-kiosk-update.timer <<'TIMER'
[Unit]
Description=MIRAEPASS kiosk daily update check

[Timer]
# 매일 새벽 3:30 전후 (기기마다 최대 30분 분산). 그 시간에 꺼져 있었으면 다음 부팅 때 실행한다.
OnCalendar=*-*-* 03:30
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
TIMER

# ───────────────────────── 키오스크 세션 ─────────────────────────

echo "==> 키오스크 실행 스크립트 설치"
cat >/usr/local/bin/miraepass-kiosk-rotate <<'ROTATE'
#!/usr/bin/env bash
# 사용법: miraepass-kiosk-rotate normal|left|right|inverted
# 키오스크 X 화면을 회전하고, 터치스크린 좌표도 같은 방향으로 맞춘다.
set -uo pipefail
ROTATE="${1:-normal}"
export DISPLAY="${DISPLAY:-:0}"

case "${ROTATE}" in
  normal) MATRIX="1 0 0 0 1 0 0 0 1" ;;
  left) MATRIX="0 -1 1 1 0 0 0 0 1" ;;
  right) MATRIX="0 1 0 -1 0 1 0 0 1" ;;
  inverted) MATRIX="-1 0 1 0 -1 1 0 0 1" ;;
  *) echo "알 수 없는 방향: ${ROTATE}" >&2; exit 2 ;;
esac

command -v xrandr >/dev/null 2>&1 || { echo "xrandr가 없습니다" >&2; exit 1; }
OUTPUT="$(xrandr --query 2>/dev/null | awk '/ connected/{print $1; exit}')"
[[ -n "${OUTPUT}" ]] || { echo "연결된 화면을 찾지 못했습니다 (DISPLAY=${DISPLAY})" >&2; exit 1; }
xrandr --output "${OUTPUT}" --rotate "${ROTATE}" || exit 1

# 터치 좌표 보정: 절대 좌표 포인터(터치스크린·펜)만 고른다. 마우스·터치패드는 건드리지 않는다.
# 이름이 제각각인 USB 터치패널도 잡히도록 이름이 아니라 장치 속성으로 판단한다.
# (다시 연결된 장치는 /etc/X11/xorg.conf.d/99-miraepass-touch-rotation.conf 가 같은 방향을 적용한다)
if command -v xinput >/dev/null 2>&1; then
  for id in $(xinput list --id-only 2>/dev/null); do
    props="$(xinput list-props "${id}" 2>/dev/null)" || continue
    grep -q "Coordinate Transformation Matrix" <<<"${props}" || continue
    name="$(xinput list --name-only "${id}" 2>/dev/null)"
    [[ "${name}" == *XTEST* ]] && continue
    if grep -q "^\s*libinput " <<<"${props}"; then
      # libinput: 보정 행렬을 지원하는 장치 = 터치스크린·펜 (터치패드·마우스는 지원 안 함)
      grep -q "libinput Calibration Matrix" <<<"${props}" || continue
    elif ! grep -q "Evdev Axis Calibration" <<<"${props}"; then
      # 그 밖의 드라이버: 이름으로 판단 (터치패드 제외)
      grep -q -i -E 'touch|ft5x06|goodix|ilitek|egalax|eeti|wacom' <<<"${name}" || continue
      grep -q -i 'touchpad' <<<"${name}" && continue
    fi
    # shellcheck disable=SC2086
    xinput set-prop "${id}" "Coordinate Transformation Matrix" ${MATRIX} && echo "터치 보정: ${name}"
  done
fi
ROTATE
chmod 0755 /usr/local/bin/miraepass-kiosk-rotate

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

# 화면 회전 + 터치 좌표 보정 (관리자 모드에서 바꾸면 로컬 서비스도 같은 스크립트를 쓴다)
/usr/local/bin/miraepass-kiosk-rotate "${ROTATE}" || true

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
CHROMIUM_EXTRA_FLAGS="${CHROMIUM_EXTRA_FLAGS:-}"
if [[ "${MODE}" == "install" && -z "${CHROMIUM_EXTRA_FLAGS}" && "${IS_RPI}" == "1" ]]; then
  CHROMIUM_EXTRA_FLAGS="--ignore-gpu-blocklist --enable-gpu-rasterization"
fi

cat >/etc/default/miraepass-kiosk <<DEFAULT
KIOSK_URL=${CLOUD_URL}
DISPLAY_ROTATE=${DISPLAY_ROTATE}
CHROMIUM_EXTRA_FLAGS="${CHROMIUM_EXTRA_FLAGS}"
DEFAULT
[[ -n "${EXTRA_KIOSK_ENV}" ]] && echo "${EXTRA_KIOSK_ENV}" >>/etc/default/miraepass-kiosk

XORG_ARGS=":0 vt1 -keeptty -nolisten tcp -s 0 -dpms"
if [[ "${HIDE_CURSOR}" == "1" ]]; then
  XORG_ARGS="${XORG_ARGS} -nocursor"
fi

cat >/etc/systemd/system/miraepass-kiosk.service <<SERVICE
[Unit]
Description=MIRAEPASS Chromium kiosk
After=systemd-user-sessions.service miraepass-kiosk-control.service getty@tty1.service
Wants=miraepass-kiosk-control.service
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

if [[ "${MODE}" == "install" ]]; then
echo "==> systemd 활성화"
systemctl daemon-reload
# 데스크톱 배포판이면 로그인 화면(디스플레이 매니저) 대신 키오스크가 tty1을 쓴다
if [[ -e /etc/systemd/system/display-manager.service ]]; then
  warn "데스크톱 로그인 화면이 설치돼 있습니다. 부팅 기본값을 콘솔(multi-user)로 바꿔 키오스크만 실행합니다."
fi
systemctl set-default multi-user.target >/dev/null
# tty1은 키오스크 화면이 쓴다 (SSH 접속에는 영향 없음)
systemctl disable getty@tty1.service >/dev/null 2>&1 || true
systemctl enable miraepass-kiosk-control.service miraepass-kiosk.service
systemctl restart miraepass-kiosk-control.service

# 다시 연결된 터치 장치에도 저장된 화면 방향이 적용되도록 Xorg 설정을 맞춘다
"${PYTHON_BIN}" /usr/local/bin/miraepass-kiosk-control.py touch-conf "${DISPLAY_ROTATE}" >/dev/null || warn "터치 회전 설정 파일을 쓰지 못했습니다"

echo "==> 방화벽 $([[ "${FIREWALL}" == "1" ]] && echo "켜기 (들어오는 연결 차단, SSH가 켜져 있으면 SSH만 허용)" || echo "끄기")"
# 규칙 생성은 로컬 서비스와 같은 코드를 쓴다. 이미 연결된 SSH 세션은 established 규칙으로 유지된다.
if [[ "${FIREWALL}" == "1" ]]; then
  "${PYTHON_BIN}" /usr/local/bin/miraepass-kiosk-control.py firewall on >/dev/null || warn "방화벽을 켜지 못했습니다"
else
  "${PYTHON_BIN}" /usr/local/bin/miraepass-kiosk-control.py firewall off >/dev/null || true
fi

AUTO_UPDATE="${AUTO_UPDATE:-1}"
if [[ "${AUTO_UPDATE}" == "1" ]]; then
  systemctl enable --now miraepass-kiosk-update.timer >/dev/null && echo "==> 자동 업데이트 켬 (매일 새벽 3:30 전후)"
else
  systemctl disable --now miraepass-kiosk-update.timer >/dev/null 2>&1 || true
fi
else
  echo "==> 서비스 다시 시작"
  systemctl daemon-reload
  systemctl restart miraepass-kiosk-control.service
  "${PYTHON_BIN}" /usr/local/bin/miraepass-kiosk-control.py touch-conf "${DISPLAY_ROTATE}" >/dev/null || warn "터치 회전 설정 파일을 쓰지 못했습니다"
  # 방화벽이 켜져 있으면 새 코드로 규칙을 다시 만든다 (꺼져 있으면 그대로)
  if systemctl is-enabled --quiet miraepass-firewall.service 2>/dev/null; then
    "${PYTHON_BIN}" /usr/local/bin/miraepass-kiosk-control.py firewall on >/dev/null || warn "방화벽 규칙을 다시 만들지 못했습니다"
  fi
  # 자동 업데이트 켜짐/꺼짐은 사용자가 정한 대로 둔다. 타이머가 이번에 처음 생긴 기기만 기본값(켜짐)으로.
  if [[ "${UPDATE_TIMER_EXISTED}" == "0" && "${AUTO_UPDATE:-1}" == "1" ]]; then
    systemctl enable --now miraepass-kiosk-update.timer >/dev/null && echo "==> 자동 업데이트 켬 (매일 새벽 3:30 전후)"
  fi
  if [[ "$(screen_digest)" != "${SCREEN_BEFORE}" ]] && systemctl is-active --quiet miraepass-kiosk.service; then
    echo "==> 화면 관련 파일이 바뀌어 키오스크 화면을 다시 시작합니다"
    systemctl restart miraepass-kiosk.service || warn "키오스크 화면을 다시 시작하지 못했습니다"
  fi
fi

sleep 1
if systemctl is-active --quiet miraepass-kiosk-control.service; then
  echo "    로컬 제어 서비스 실행 중 (127.0.0.1:8765)"
else
  warn "로컬 제어 서비스가 실행되지 않았습니다: journalctl -u miraepass-kiosk-control -n 50"
fi

if [[ "${MODE}" == "update" ]]; then
  echo
  echo "업데이트 완료: ${KIOSK_VERSION}"
  exit 0
fi

echo
echo "설치 완료"
echo "- 기기: ${DEVICE_MODEL} · ${OS_NAME}"
echo "- 키오스크 스크립트 버전: ${KIOSK_VERSION}"
echo "- 키오스크 URL: ${CLOUD_URL}"
echo "- 관리자 모드 PIN: ${ADMIN_PIN}"
echo "- 재부팅하면 Chromium 키오스크가 자동 실행됩니다: sudo reboot"
if [[ "${NEED_REBOOT}" == "1" ]]; then
  echo "- NetworkManager 전환은 재부팅 후 적용됩니다. 재부팅 뒤 유선 LAN은 DHCP로 연결되며,"
  echo "  IP가 바뀌어 SSH 주소가 달라질 수 있습니다. (관리자 모드 › 상태에서 IP 확인)"
else
  echo "- 지금 바로 시작: sudo systemctl start miraepass-kiosk"
fi
echo "- 삭제: sudo miraepass-kiosk-uninstall"
echo "- 로그 확인: journalctl -u miraepass-kiosk -f"

if [[ "${REBOOT:-0}" == "1" ]]; then
  echo "==> 재부팅"
  systemctl reboot
fi
