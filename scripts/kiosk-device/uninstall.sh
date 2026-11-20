#!/usr/bin/env bash
# MIRAEPASS 키오스크 삭제
#
#   sudo miraepass-kiosk-uninstall          # 설치 시 함께 복사됨
#   sudo ./scripts/kiosk-device/uninstall.sh
#
# install.sh가 추가한 서비스·파일을 지우고, 설치 전에 기록해 둔 시스템 설정을 되돌린다.
#
# 일부러 그대로 두는 것 (SSH로 작업하는 도중 연결이 끊기지 않도록)
#   - NetworkManager에 저장된 유선/Wi‑Fi 연결과 NM_TAKEOVER 전환
#   - SSH 서버 켜짐/꺼짐 상태
#   - 설치한 패키지 (다른 프로그램이 쓰고 있을 수 있음)
#
# 선택 환경 변수
#   YES=1                  확인 질문 없이 진행
#   REMOVE_BROWSER_DATA=1  키오스크 사용자의 Chromium 프로필(저장된 기기 토큰 포함)도 삭제
#   REBOOT=1               삭제 후 바로 재부팅
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "sudo로 실행하세요: sudo $0" >&2
  exit 1
fi

STATE_DIR=/etc/miraepass
STATE_FILE="${STATE_DIR}/install-state"
state() { sed -n "s/^$1=//p" "${STATE_FILE}" 2>/dev/null | head -n1; }
warn() { echo "    (경고) $*" >&2; }

if [[ ! -e /etc/systemd/system/miraepass-kiosk.service && ! -e /etc/systemd/system/miraepass-kiosk-control.service \
  && ! -e /etc/systemd/system/miraepass-pi-control.service && ! -d "${STATE_DIR}" ]]; then
  echo "MIRAEPASS 키오스크가 설치돼 있지 않습니다."
  exit 0
fi

KIOSK_USER="$(state KIOSK_USER)"
if [[ -z "${KIOSK_USER}" ]]; then
  KIOSK_USER="$(sed -n 's/^User=//p' /etc/systemd/system/miraepass-kiosk.service 2>/dev/null | head -n1 || true)"
fi

echo "MIRAEPASS 키오스크를 삭제합니다."
echo "  - 키오스크 화면, 로컬 제어 서비스, 방화벽(들어오는 연결 차단)이 제거됩니다."
echo "  - 네트워크 설정과 SSH 상태는 그대로 둡니다."
[[ "${REMOVE_BROWSER_DATA:-0}" == "1" ]] && echo "  - ${KIOSK_USER:-키오스크 사용자}의 Chromium 프로필도 삭제합니다."
if [[ "${YES:-0}" != "1" ]]; then
  if [[ ! -t 0 ]]; then
    echo "확인할 수 없는 환경입니다. YES=1 을 붙여 실행하세요." >&2
    exit 1
  fi
  read -rp "계속할까요? [y/N] " answer
  [[ "${answer}" =~ ^[Yy]$ ]] || { echo "취소했습니다."; exit 0; }
fi

# ───────────────────────── 서비스 ─────────────────────────

echo "==> 서비스 중지 / 삭제"
# 방화벽은 ExecStop에서 nftables 테이블을 지운다
for unit in miraepass-kiosk.service miraepass-kiosk-control.service miraepass-firewall.service miraepass-pi-control.service; do
  if [[ -e "/etc/systemd/system/${unit}" ]]; then
    systemctl disable --now "${unit}" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${unit}"
    echo "    ${unit}"
  fi
done
if command -v nft >/dev/null 2>&1; then
  nft delete table inet miraepass_kiosk 2>/dev/null || true
fi
systemctl daemon-reload

# ───────────────────────── 파일 ─────────────────────────

echo "==> 파일 삭제"
rm -f \
  /usr/local/bin/miraepass-kiosk-session \
  /usr/local/bin/miraepass-kiosk-rotate \
  /usr/local/bin/miraepass-kiosk-control.py \
  /usr/local/bin/miraepass-pi-control.py \
  /etc/default/miraepass-kiosk \
  /etc/default/miraepass-kiosk-control \
  /etc/default/miraepass-pi-control \
  /etc/X11/xorg.conf.d/99-miraepass-touch-rotation.conf \
  /etc/modprobe.d/miraepass-wifi-country.conf \
  /etc/chromium/policies/managed/miraepass-kiosk.json \
  /etc/chromium-browser/policies/managed/miraepass-kiosk.json \
  /etc/opt/chrome/policies/managed/miraepass-kiosk.json
rm -rf /usr/local/share/miraepass-kiosk

# ───────────────────────── 시스템 설정 되돌리기 ─────────────────────────

echo "==> 시스템 설정 되돌리기"
case "$(state XWRAPPER_BACKUP)" in
  1)
    cp -a "${STATE_DIR}/backup/Xwrapper.config" /etc/X11/Xwrapper.config
    echo "    Xorg 권한 설정: 설치 전 파일로 복원"
    ;;
  0)
    rm -f /etc/X11/Xwrapper.config
    echo "    Xorg 권한 설정: 삭제 (설치 전에는 없었음)"
    ;;
  *)
    warn "설치 전 Xorg 권한 설정 기록이 없어 /etc/X11/Xwrapper.config 는 그대로 둡니다"
    ;;
esac

PREV_TARGET="$(state PREV_DEFAULT_TARGET)"
if [[ -n "${PREV_TARGET}" && "${PREV_TARGET}" != "$(systemctl get-default 2>/dev/null)" ]]; then
  systemctl set-default "${PREV_TARGET}" >/dev/null && echo "    부팅 기본값: ${PREV_TARGET}"
fi

# tty1 로그인 화면: 설치 전 상태를 모르면 기본값(켜짐)으로
if [[ "$(state GETTY_TTY1_ENABLED)" != "disabled" ]]; then
  systemctl enable getty@tty1.service >/dev/null 2>&1 || true
  echo "    tty1 콘솔 로그인 다시 켬"
fi

NM_NOTE="$(state NM_TAKEOVER_FROM)"

if [[ "${REMOVE_BROWSER_DATA:-0}" == "1" && -n "${KIOSK_USER}" ]]; then
  HOME_DIR="$(getent passwd "${KIOSK_USER}" | cut -d: -f6)"
  if [[ -n "${HOME_DIR}" && -d "${HOME_DIR}" ]]; then
    rm -rf "${HOME_DIR}/.config/chromium" "${HOME_DIR}/.config/google-chrome" "${HOME_DIR}/snap/chromium/common/chromium"
    echo "    ${KIOSK_USER}의 Chromium 프로필 삭제"
  fi
fi

rm -rf "${STATE_DIR}"
# 이 스크립트의 설치된 사본도 지운다 (실행 중인 스크립트는 이미 열려 있어 끝까지 실행된다)
rm -f /usr/local/sbin/miraepass-kiosk-uninstall

echo
echo "삭제 완료"
echo "- 재부팅하면 키오스크 화면 대신 콘솔(또는 원래 로그인 화면)이 나옵니다: sudo reboot"
echo "- 남겨 둔 것: 설치한 패키지, 네트워크 연결 설정, SSH 상태, ${KIOSK_USER:-키오스크 사용자}의 그룹(video·input·render·tty)"
if [[ -n "${NM_NOTE}" ]]; then
  echo "- 설치 때 네트워크 관리를 NetworkManager로 전환했습니다 (이전: ${NM_NOTE})."
  echo "  NetworkManager로 계속 써도 됩니다. 되돌리려면 이전 설정을 직접 복원하세요."
fi
if [[ "${REMOVE_BROWSER_DATA:-0}" != "1" ]]; then
  echo "- Chromium 프로필(저장된 기기 토큰)은 남아 있습니다: ~${KIOSK_USER:-사용자}/.config/chromium"
fi

if [[ "${REBOOT:-0}" == "1" ]]; then
  echo "==> 재부팅"
  systemctl reboot
fi
