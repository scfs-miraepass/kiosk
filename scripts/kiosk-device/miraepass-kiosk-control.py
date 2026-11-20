#!/usr/bin/env python3
"""Local-only control API for the MIRAEPASS kiosk touchscreen.

Runs on any systemd + NetworkManager Linux (Raspberry Pi OS, Debian, Ubuntu,
Fedora, Arch ...).

The cloud-hosted Next.js kiosk page calls this service through
http://127.0.0.1:8765 from Chromium. Keep it bound to loopback only.

Chromium also starts at http://127.0.0.1:8765/launch, a small local page that
waits until the cloud kiosk URL is reachable and then moves there. Without it a
kiosk that boots without network would be stuck on Chromium's error page.
"""

from __future__ import annotations

import ipaddress
import json
import os
import platform
import re
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = "127.0.0.1"
PORT = int(os.environ.get("MIRAEPASS_KIOSK_CONTROL_PORT", "8765"))
VERSION = "1.3.0"
ADMIN_PIN = os.environ.get("MIRAEPASS_KIOSK_ADMIN_PIN", "2580")
ALLOW_POWER = os.environ.get("MIRAEPASS_KIOSK_ALLOW_POWER") == "1"
KIOSK_URL = os.environ.get("MIRAEPASS_KIOSK_URL", "")
# 화면 방향: 키오스크 X 세션을 실행하는 사용자, 방향을 저장하는 설정 파일, 실제 회전 스크립트
KIOSK_USER = os.environ.get("MIRAEPASS_KIOSK_USER", "")
KIOSK_ENV_FILE = os.environ.get("MIRAEPASS_KIOSK_ENV_FILE", "/etc/default/miraepass-kiosk")
ROTATE_BIN = os.environ.get("MIRAEPASS_KIOSK_ROTATE_BIN", "/usr/local/bin/miraepass-kiosk-rotate")
X_DISPLAY = os.environ.get("MIRAEPASS_KIOSK_DISPLAY", ":0")
# 방향을 바꾼 뒤 이 시간 안에 '유지'를 누르지 않으면 되돌린다 (터치 좌표가 틀어져도 복구되도록)
ROTATION_CONFIRM_SECONDS = 15


def run(args: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, f"시간 초과({timeout}초)")
    except FileNotFoundError:
        return subprocess.CompletedProcess(args, 127, f"{args[0]} 명령을 찾을 수 없어요")


def shell(command: str, timeout: int = 20) -> subprocess.CompletedProcess[str]:
    return run(["/bin/bash", "-lc", command], timeout=timeout)


def split_terse(line: str) -> list[str]:
    """nmcli -t 출력 한 줄을 필드로 나눈다. 값 안의 ':'와 '\\'는 백슬래시로 이스케이프돼 있다."""
    fields: list[str] = []
    buf: list[str] = []
    escaped = False
    for ch in line:
        if escaped:
            buf.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == ":":
            fields.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    fields.append("".join(buf))
    return fields


def nmcli_checked(args: list[str], timeout: int = 20, error: str = "명령 실행에 실패했어요") -> str:
    """nmcli를 실행하고 실패하면 nmcli 메시지를 담아 예외를 던진다 (화면에 그대로 보여준다)."""
    proc = run(["nmcli", *args], timeout=timeout)
    if proc.returncode != 0:
        lines = [line for line in proc.stdout.strip().splitlines() if line.strip()]
        detail = lines[-1] if lines else ""
        raise RuntimeError(f"{error}: {detail}" if detail else error)
    return proc.stdout


def nmcli_value(args: list[str], timeout: int = 10) -> str:
    """nmcli -g 로 값 하나를 읽는다. 없으면 빈 문자열."""
    proc = run(["nmcli", "-g", *args], timeout=timeout)
    value = proc.stdout.strip() if proc.returncode == 0 else ""
    return "" if value == "--" else value


def split_multi(value: str) -> list[str]:
    """nmcli -g 의 다중 값('a | b' 또는 'a,b')을 목록으로."""
    return [v.strip() for v in re.split(r"\s*\|\s*|,", value) if v.strip()]


class Handler(BaseHTTPRequestHandler):
    server_version = "MiraepassKioskControl/1.3"

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[kiosk-control]", self.address_string(), fmt % args, flush=True)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        try:
            path = self.path.split("?", 1)[0]
            if path in ("/", "/launch"):
                return self.launch_page()
            if path == "/health":
                return self.ok({"ok": True, "hostname": socket.gethostname(), "model": device_model(), "version": VERSION, "powerControl": ALLOW_POWER})
            if path == "/network/status":
                return self.ok(network_status())
            if path == "/wifi/scan":
                return self.ok(scan_wifi())
            if path == "/display/status":
                return self.ok(display_status())
            if path == "/ethernet/status":
                return self.ok(ethernet_status())
            self.fail("NOT_FOUND", "unknown endpoint", 404)
        except PermissionError as exc:
            self.fail("UNAUTHORIZED", str(exc), 401)
        except Exception as exc:  # pragma: no cover - defensive for field devices
            self.fail("INTERNAL", str(exc), 500)

    def do_POST(self) -> None:  # noqa: N802
        try:
            body = self.read_json()
            path = self.path.split("?", 1)[0]
            if path == "/wifi/connect":
                return self.ok(
                    connect_wifi(
                        ssid=str(body.get("ssid", "")),
                        password=str(body.get("password", "")),
                        security_mode=str(body.get("securityMode", "personal")),
                        identity=str(body.get("identity", "")),
                        hidden=bool(body.get("hidden", False)),
                    )
                )
            if path == "/display/rotation":
                return self.ok(set_rotation(str(body.get("rotation", ""))))
            if path == "/display/confirm":
                return self.ok(confirm_rotation())
            if path == "/display/revert":
                return self.ok(revert_rotation())
            if path == "/ethernet/config":
                return self.ok(configure_ethernet(body))
            if path == "/admin/verify":
                return self.ok(verify_admin(str(body.get("pin", ""))))
            if path == "/terminal/run":
                return self.ok(run_terminal(str(body.get("command", ""))))
            if path == "/system/reboot":
                return self.ok(power_action("reboot"))
            if path == "/system/shutdown":
                return self.ok(power_action("shutdown"))
            self.fail("NOT_FOUND", "unknown endpoint", 404)
        except PermissionError as exc:
            self.fail("UNAUTHORIZED", str(exc), 401)
        except ValueError as exc:
            self.fail("BAD_REQUEST", str(exc), 400)
        except Exception as exc:  # pragma: no cover
            self.fail("INTERNAL", str(exc), 500)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        data = json.loads(self.rfile.read(length).decode("utf-8"))
        return data if isinstance(data, dict) else {}

    def ok(self, data: Any) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps({"success": True, "data": data}, ensure_ascii=False).encode("utf-8"))

    def fail(self, code: str, message: str, status: int) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps({"success": False, "code": code, "message": message}, ensure_ascii=False).encode("utf-8"))

    def launch_page(self) -> None:
        body = LAUNCH_PAGE.replace("__KIOSK_URL__", json.dumps(KIOSK_URL).replace("<", "\\u003c")).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# 클라우드 키오스크 주소에 닿을 때까지 기다렸다가 이동하는 로컬 시작 화면.
# 외부 리소스·애니메이션 없이 단색으로만 그린다 (Pi GPU 부담 최소화).
LAUNCH_PAGE = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MIRAEPASS 키오스크</title>
<style>
html,body{margin:0;height:100%;background:#f1f5f9;color:#0f172a;font-family:"Noto Sans CJK KR","Noto Sans KR",sans-serif}
main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px;box-sizing:border-box}
h1{margin:0;font-size:28px}p{margin:0;color:#475569;font-size:18px;line-height:1.5}
small{color:#94a3b8;font-size:14px}
</style></head>
<body><main>
<h1>키오스크를 시작하고 있어요</h1>
<p id="msg">서버에 연결하는 중…</p>
<small id="detail"></small>
</main>
<script>
const url = __KIOSK_URL__;
const msg = document.getElementById("msg");
const detail = document.getElementById("detail");
let tries = 0;
async function check() {
  if (!url) { msg.textContent = "키오스크 주소가 설정되지 않았어요. 설치 스크립트를 다시 실행해 주세요."; return; }
  tries += 1;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
    clearTimeout(timer);
    location.replace(url);
    return;
  } catch (e) {
    msg.textContent = tries < 3 ? "서버에 연결하는 중…" : "네트워크에 연결되지 않았어요. 케이블 또는 Wi‑Fi를 확인해 주세요.";
    detail.textContent = "자동으로 다시 시도합니다 (" + tries + "회)";
  }
  setTimeout(check, 5000);
}
check();
</script>
</body></html>
"""


# ───────────────────────── 네트워크 상태 ─────────────────────────


def devices() -> list[dict[str, str]]:
    proc = run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status"], timeout=10)
    result: list[dict[str, str]] = []
    for line in proc.stdout.splitlines():
        parts = split_terse(line)
        if len(parts) >= 4:
            result.append({"device": parts[0], "type": parts[1], "state": parts[2], "connection": "" if parts[3] == "--" else parts[3]})
    return result


# 컨테이너·가상머신용 가상 NIC는 키오스크 유선 LAN으로 보지 않는다 (x86 미니PC에서 흔함)
VIRTUAL_IFACE = re.compile(r"^(veth|docker|br-|virbr|vnet|tap|tun|wg|zt|tailscale|lxc|podman|cni|flannel|vmnet)")


def first_device(kind: str) -> dict[str, str] | None:
    """해당 종류의 실제 장치 하나. 연결된 것 → NetworkManager가 관리하는 것 → 아무거나 순으로 고른다."""
    candidates = [d for d in devices() if d["type"] == kind and not VIRTUAL_IFACE.match(d["device"])]
    if not candidates:
        return None
    rank = lambda d: (d["state"] != "connected", d["state"] == "unmanaged")  # noqa: E731
    return sorted(candidates, key=rank)[0]


def device_model() -> str:
    """기기 모델명: 라즈베리파이 등 ARM 보드는 device-tree, x86 PC는 DMI에서 읽는다."""
    for path in ("/proc/device-tree/model", "/sys/firmware/devicetree/base/model"):
        try:
            with open(path, "rb") as f:
                value = f.read().replace(b"\0", b"").decode("utf-8", "replace").strip()
            if value:
                return value
        except OSError:
            pass
    parts: list[str] = []
    for path in ("/sys/class/dmi/id/sys_vendor", "/sys/class/dmi/id/product_name"):
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                value = f.read().strip()
            if value and value.lower() not in ("to be filled by o.e.m.", "default string", "system product name"):
                parts.append(value)
        except OSError:
            pass
    return " ".join(parts) or platform.machine() or "알 수 없음"


def device_ip(device: str) -> dict[str, Any]:
    return {
        "addresses": split_multi(nmcli_value(["IP4.ADDRESS", "device", "show", device])),
        "gateway": nmcli_value(["IP4.GATEWAY", "device", "show", device]),
        "dns": split_multi(nmcli_value(["IP4.DNS", "device", "show", device])),
    }


def ethernet_status() -> dict[str, Any]:
    dev = first_device("ethernet")
    if not dev:
        return {"device": None, "connected": False, "state": "not_found", "connection": None, "method": "auto", "config": None, "addresses": [], "gateway": "", "dns": []}
    con = dev["connection"] or None
    method = "auto"
    config = None
    if con:
        method = nmcli_value(["ipv4.method", "connection", "show", con]) or "auto"
        config = {
            "addresses": split_multi(nmcli_value(["ipv4.addresses", "connection", "show", con])),
            "gateway": nmcli_value(["ipv4.gateway", "connection", "show", con]),
            "dns": split_multi(nmcli_value(["ipv4.dns", "connection", "show", con])),
        }
    return {
        "device": dev["device"],
        "connected": dev["state"] == "connected",
        "state": dev["state"],
        "connection": con,
        "method": "manual" if method == "manual" else "auto",
        "config": config,
        **device_ip(dev["device"]),
    }


def wifi_status() -> dict[str, Any]:
    dev = first_device("wifi")
    radio = run(["nmcli", "radio", "wifi"], timeout=10).stdout.strip()
    if not dev:
        return {"device": None, "connected": False, "state": "not_found", "radio": radio, "ssid": None, "signal": None, "addresses": [], "gateway": "", "dns": []}
    ssid = None
    signal = None
    if dev["state"] == "connected":
        proc = run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "device", "wifi", "list", "--rescan", "no"], timeout=10)
        for line in proc.stdout.splitlines():
            parts = split_terse(line)
            if len(parts) >= 3 and parts[0] == "yes":
                ssid = parts[1] or None
                signal = int(parts[2]) if parts[2].isdigit() else None
                break
    return {
        "device": dev["device"],
        "connected": dev["state"] == "connected",
        "state": dev["state"],
        "radio": radio,
        "ssid": ssid or dev["connection"] or None,
        "signal": signal,
        **device_ip(dev["device"]),
    }


def network_status() -> dict[str, Any]:
    connectivity = run(["nmcli", "networking", "connectivity", "check"], timeout=15).stdout.strip() or "unknown"
    return {"hostname": socket.gethostname(), "connectivity": connectivity, "ethernet": ethernet_status(), "wifi": wifi_status()}


# ───────────────────────── Wi‑Fi ─────────────────────────


def ensure_wifi_radio() -> None:
    # 라즈베리파이 OS Lite 등은 WLAN 국가 설정 전이나 절전 후 rfkill로 무선이 막혀 있을 수 있다.
    run(["rfkill", "unblock", "wifi"], timeout=5)
    run(["nmcli", "radio", "wifi", "on"], timeout=10)


def scan_wifi() -> list[dict[str, Any]]:
    ensure_wifi_radio()
    if not first_device("wifi"):
        raise RuntimeError("무선 네트워크 장치를 찾을 수 없어요")
    out = nmcli_checked(["-t", "-f", "ACTIVE,SSID,SECURITY,SIGNAL", "device", "wifi", "list", "--rescan", "yes"], timeout=30, error="Wi‑Fi 검색에 실패했어요")
    best: dict[str, dict[str, Any]] = {}
    for line in out.splitlines():
        parts = split_terse(line)
        if len(parts) < 4:
            continue
        ssid = parts[1].strip()
        if not ssid:
            continue  # 숨김 네트워크
        security = parts[2].strip()
        if security == "--":
            security = ""
        item = {
            "ssid": ssid,
            "security": security,
            "signal": int(parts[3]) if parts[3].isdigit() else 0,
            "active": parts[0] == "yes",
            "enterprise": "802.1X" in security or "EAP" in security,
        }
        prev = best.get(ssid)
        if prev is None or item["active"] or (not prev["active"] and item["signal"] > prev["signal"]):
            best[ssid] = item
    return sorted(best.values(), key=lambda n: (not n["active"], -n["signal"]))[:30]


def delete_connections_named(name: str) -> None:
    proc = run(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"], timeout=10)
    for line in proc.stdout.splitlines():
        parts = split_terse(line)
        if len(parts) >= 2 and parts[0] == name and "wireless" in parts[1]:
            run(["nmcli", "connection", "delete", "id", name], timeout=10)


def connect_wifi(ssid: str, password: str, security_mode: str = "personal", identity: str = "", hidden: bool = False) -> dict[str, Any]:
    ssid = ssid.strip()
    if not ssid:
        raise ValueError("Wi‑Fi 이름(SSID)을 입력해 주세요")
    ensure_wifi_radio()
    if security_mode == "enterprise":
        return connect_enterprise_wifi(ssid, identity.strip(), password, hidden)
    if password and not 8 <= len(password) <= 63:
        raise ValueError("WPA 비밀번호는 8~63자여야 해요")
    # 같은 이름의 저장된 프로필이 있으면 nmcli가 예전 비밀번호/보안 설정을 재사용하다 실패한다.
    delete_connections_named(ssid)
    args = ["device", "wifi", "connect", ssid]
    if password:
        args.extend(["password", password])
    if hidden:
        args.extend(["hidden", "yes"])
    nmcli_checked(args, timeout=45, error="Wi‑Fi에 연결하지 못했어요")
    return {"ok": True, "status": wifi_status()}


def connect_enterprise_wifi(ssid: str, identity: str, password: str, hidden: bool) -> dict[str, Any]:
    if not identity:
        raise ValueError("Enterprise ID를 입력해 주세요")
    if not password:
        raise ValueError("Enterprise 비밀번호를 입력해 주세요")
    con_name = f"miraepass-{ssid}"
    run(["nmcli", "connection", "delete", "id", con_name], timeout=10)
    nmcli_checked(
        [
            "connection", "add", "type", "wifi", "ifname", "*", "con-name", con_name, "ssid", ssid,
            "wifi.hidden", "yes" if hidden else "no",
            "wifi-sec.key-mgmt", "wpa-eap",
            "802-1x.eap", "peap",
            "802-1x.phase2-auth", "mschapv2",
            "802-1x.identity", identity,
            "802-1x.password", password,
            "connection.autoconnect", "yes",
        ],
        timeout=20,
        error="Wi‑Fi 프로필을 만들지 못했어요",
    )
    try:
        nmcli_checked(["connection", "up", "id", con_name], timeout=45, error="Wi‑Fi에 연결하지 못했어요")
    except RuntimeError:
        run(["nmcli", "connection", "delete", "id", con_name], timeout=10)
        raise
    return {"ok": True, "status": wifi_status()}


# ───────────────────────── 유선 LAN ─────────────────────────


def ethernet_connection(device: str) -> str:
    con = nmcli_value(["GENERAL.CONNECTION", "device", "show", device])
    if con:
        return con
    # 케이블이 빠져 있으면 활성 연결이 없다. 이 장치용 저장 프로필을 찾고, 없으면 만든다.
    proc = run(["nmcli", "-t", "-f", "NAME,TYPE,DEVICE", "connection", "show"], timeout=10)
    for line in proc.stdout.splitlines():
        parts = split_terse(line)
        if len(parts) >= 2 and parts[1] == "802-3-ethernet":
            iface = nmcli_value(["connection.interface-name", "connection", "show", parts[0]])
            if iface in ("", device):
                return parts[0]
    con = f"miraepass-wired-{device}"
    nmcli_checked(["connection", "add", "type", "ethernet", "ifname", device, "con-name", con], timeout=15, error="유선 프로필을 만들지 못했어요")
    return con


def parse_static(body: dict[str, Any]) -> tuple[str, str, str]:
    address = str(body.get("address", "")).strip()
    netmask = str(body.get("netmask", "")).strip() or "24"
    gateway = str(body.get("gateway", "")).strip()
    dns_raw = str(body.get("dns", "")).strip()
    if not address:
        raise ValueError("IP 주소를 입력해 주세요")
    try:
        iface = ipaddress.IPv4Interface(address if "/" in address else f"{address}/{netmask.lstrip('/')}")
    except ValueError:
        raise ValueError("IP 주소 또는 서브넷 마스크 형식이 올바르지 않아요") from None
    if gateway:
        try:
            gw = ipaddress.IPv4Address(gateway)
        except ValueError:
            raise ValueError("게이트웨이 형식이 올바르지 않아요") from None
        if gw not in iface.network:
            raise ValueError(f"게이트웨이가 {iface.network} 대역 밖에 있어요")
    dns: list[str] = []
    for item in re.split(r"[\s,]+", dns_raw):
        if not item:
            continue
        try:
            dns.append(str(ipaddress.IPv4Address(item)))
        except ValueError:
            raise ValueError(f"DNS 주소 형식이 올바르지 않아요: {item}") from None
    return iface.with_prefixlen, gateway, ",".join(dns)


def configure_ethernet(body: dict[str, Any]) -> dict[str, Any]:
    dev = first_device("ethernet")
    if not dev:
        raise RuntimeError("유선 네트워크 장치를 찾을 수 없어요")
    device = dev["device"]
    con = ethernet_connection(device)
    if str(body.get("mode", "dhcp")) == "static":
        address, gateway, dns = parse_static(body)
        args = ["connection", "modify", con, "ipv4.method", "manual", "ipv4.addresses", address, "ipv4.gateway", gateway, "ipv4.dns", dns]
    else:
        args = ["connection", "modify", con, "ipv4.method", "auto", "ipv4.addresses", "", "ipv4.gateway", "", "ipv4.dns", ""]
    nmcli_checked([*args, "connection.autoconnect", "yes"], timeout=15, error="유선 설정을 저장하지 못했어요")

    if dev["state"] == "unavailable":
        # 케이블이 빠져 있으면 활성화는 실패하지만 설정은 저장돼 다음에 연결할 때 적용된다.
        return {"ok": True, "activated": False, "message": "설정을 저장했어요. 케이블이 연결되면 적용돼요.", "status": ethernet_status()}
    up = run(["nmcli", "connection", "up", "id", con, "ifname", device], timeout=40)
    if up.returncode != 0:
        lines = [line for line in up.stdout.strip().splitlines() if line.strip()]
        return {"ok": True, "activated": False, "message": f"설정은 저장했지만 연결하지 못했어요: {lines[-1] if lines else '알 수 없는 오류'}", "status": ethernet_status()}
    return {"ok": True, "activated": True, "message": "유선 네트워크 설정을 적용했어요.", "status": ethernet_status()}


# ───────────────────────── 화면 방향 ─────────────────────────

ROTATIONS = ("normal", "left", "right", "inverted")
_display_lock = threading.RLock()
_pending: dict[str, Any] = {}  # {"rotation", "previous", "deadline", "timer"}


def saved_rotation() -> str:
    try:
        with open(KIOSK_ENV_FILE, encoding="utf-8") as f:
            for line in f:
                key, _, value = line.strip().partition("=")
                if key == "DISPLAY_ROTATE":
                    value = value.strip().strip('"')
                    return value if value in ROTATIONS else "normal"
    except OSError:
        pass
    return "normal"


def save_rotation(rotation: str) -> None:
    """설정 파일의 DISPLAY_ROTATE만 바꾼다. 키오스크가 다시 시작돼도 이 방향으로 켜진다."""
    try:
        with open(KIOSK_ENV_FILE, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        lines = []
    out = [line for line in lines if not line.startswith("DISPLAY_ROTATE=")]
    out.append(f"DISPLAY_ROTATE={rotation}")
    directory = os.path.dirname(KIOSK_ENV_FILE) or "."
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".miraepass-kiosk.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, KIOSK_ENV_FILE)


def apply_rotation(rotation: str) -> None:
    """키오스크 X 화면(:0)에 회전과 터치 좌표 보정을 바로 적용한다."""
    if not os.path.exists(ROTATE_BIN):
        raise RuntimeError("화면 회전 스크립트가 없어요. 설치 스크립트를 다시 실행해 주세요")
    args = ["env", f"DISPLAY={X_DISPLAY}", ROTATE_BIN, rotation]
    if KIOSK_USER and os.geteuid() == 0:
        args = ["runuser", "-u", KIOSK_USER, "--", *args]
    proc = run(args, timeout=15)
    if proc.returncode != 0:
        lines = [line for line in proc.stdout.strip().splitlines() if line.strip()]
        raise RuntimeError(f"화면을 회전하지 못했어요: {lines[-1]}" if lines else "화면을 회전하지 못했어요")


def _clear_pending() -> None:
    timer = _pending.get("timer")
    if timer:
        timer.cancel()
    _pending.clear()


def _auto_revert(token: object) -> None:
    with _display_lock:
        if _pending.get("timer") is not token:
            return  # 이미 유지/되돌림/다른 방향으로 바뀜
        previous = _pending["previous"]
        _pending.clear()
        try:
            apply_rotation(previous)
            print(f"[kiosk-control] 화면 방향 확인이 없어 {previous}(으)로 되돌렸어요", flush=True)
        except Exception as exc:  # pragma: no cover
            print(f"[kiosk-control] 화면 방향 되돌리기 실패: {exc}", flush=True)


def display_status() -> dict[str, Any]:
    with _display_lock:
        saved = saved_rotation()
        pending = None
        if _pending:
            pending = {
                "rotation": _pending["rotation"],
                "previous": _pending["previous"],
                "secondsLeft": max(0, round(_pending["deadline"] - time.monotonic())),
            }
        return {
            "rotation": pending["rotation"] if pending else saved,
            "saved": saved,
            "pending": pending,
            "available": os.path.exists(ROTATE_BIN),
        }


def set_rotation(rotation: str) -> dict[str, Any]:
    if rotation not in ROTATIONS:
        raise ValueError("화면 방향은 normal, left, right, inverted 중 하나여야 해요")
    with _display_lock:
        # 확인 대기 중에 또 바꾸면, 되돌릴 곳은 처음 저장돼 있던 방향 그대로
        previous = _pending.get("previous") or saved_rotation()
        _clear_pending()
        apply_rotation(rotation)
        if rotation != previous:
            timer = threading.Timer(ROTATION_CONFIRM_SECONDS, lambda: _auto_revert(timer))
            timer.daemon = True
            _pending.update(rotation=rotation, previous=previous, deadline=time.monotonic() + ROTATION_CONFIRM_SECONDS, timer=timer)
            timer.start()
        return display_status()


def confirm_rotation() -> dict[str, Any]:
    with _display_lock:
        if _pending:
            rotation = _pending["rotation"]
            _clear_pending()
            save_rotation(rotation)
        return display_status()


def revert_rotation() -> dict[str, Any]:
    with _display_lock:
        if _pending:
            previous = _pending["previous"]
            _clear_pending()
            apply_rotation(previous)
        return display_status()


# ───────────────────────── 관리자 / 시스템 ─────────────────────────


def verify_admin(pin: str) -> dict[str, Any]:
    if pin != ADMIN_PIN:
        raise PermissionError("관리자 PIN이 맞지 않아요")
    return {"ok": True}


def run_terminal(command: str) -> dict[str, Any]:
    command = command.strip()
    if not command:
        raise ValueError("command is required")
    proc = shell(command, timeout=30)
    return {"code": proc.returncode, "output": proc.stdout[-12000:]}


def power_action(action: str) -> dict[str, Any]:
    if not ALLOW_POWER:
        raise PermissionError("전원 제어는 설치된 키오스크 서비스에서만 사용할 수 있어요")
    if action not in ("reboot", "shutdown"):
        raise ValueError("unknown power action")
    # 응답을 먼저 보낼 수 있도록 systemd에 예약만 하고 바로 돌아온다.
    proc = run(["systemctl", "--no-block", "reboot" if action == "reboot" else "poweroff"], timeout=10)
    if proc.returncode != 0:
        raise RuntimeError(proc.stdout.strip() or "전원 명령에 실패했어요")
    return {"ok": True}


def main() -> None:
    ThreadingHTTPServer.daemon_threads = True
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"MIRAEPASS Pi control API listening on http://{HOST}:{PORT}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
