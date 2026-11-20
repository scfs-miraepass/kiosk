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

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import platform
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit

HOST = "127.0.0.1"
PORT = int(os.environ.get("MIRAEPASS_KIOSK_CONTROL_PORT", "8765"))
# 설치한 키오스크 저장소 버전 (install.sh가 package.json·git 커밋에서 읽어 기록. 예: "1.1.1+a1b2c3d")
VERSION = os.environ.get("MIRAEPASS_KIOSK_VERSION", "").strip() or "unknown"
ADMIN_PIN = os.environ.get("MIRAEPASS_KIOSK_ADMIN_PIN", "2580")
ALLOW_POWER = os.environ.get("MIRAEPASS_KIOSK_ALLOW_POWER") == "1"
KIOSK_URL = os.environ.get("MIRAEPASS_KIOSK_URL", "")
# 화면 방향: 키오스크 X 세션을 실행하는 사용자, 방향을 저장하는 설정 파일, 실제 회전 스크립트
KIOSK_USER = os.environ.get("MIRAEPASS_KIOSK_USER", "")
KIOSK_ENV_FILE = os.environ.get("MIRAEPASS_KIOSK_ENV_FILE", "/etc/default/miraepass-kiosk")
ROTATE_BIN = os.environ.get("MIRAEPASS_KIOSK_ROTATE_BIN", "/usr/local/bin/miraepass-kiosk-rotate")
X_DISPLAY = os.environ.get("MIRAEPASS_KIOSK_DISPLAY", ":0")
# 관리자 토큰: PIN 확인 후 발급, 마지막 사용 후 이 시간이 지나면 만료
ADMIN_TOKEN_TTL = 30 * 60
# PIN을 연속으로 틀리면 잠시 잠근다
PIN_MAX_FAILURES = 5
PIN_LOCK_SECONDS = 30
# 방화벽 (nftables 전용 테이블)
FIREWALL_TABLE = "miraepass_kiosk"
FIREWALL_FILE = os.environ.get("MIRAEPASS_KIOSK_FIREWALL_FILE", "/etc/miraepass/firewall.nft")
FIREWALL_UNIT = "miraepass-firewall.service"
FIREWALL_UNIT_FILE = f"/etc/systemd/system/{FIREWALL_UNIT}"
# 방향을 바꾼 뒤 이 시간 안에 '유지'를 누르지 않으면 되돌린다 (터치 좌표가 틀어져도 복구되도록)
ROTATION_CONFIRM_SECONDS = 15


def run(args: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, f"시간 초과({timeout}초)")
    except FileNotFoundError:
        return subprocess.CompletedProcess(args, 127, f"{args[0]} 명령을 찾을 수 없어요")


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
    server_version = "MiraepassKioskControl"

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[kiosk-control]", self.address_string(), fmt % args, flush=True)

    def end_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Kiosk-Admin-Token")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def token(self) -> str:
        return self.headers.get("X-Kiosk-Admin-Token", "")

    def do_GET(self) -> None:  # noqa: N802
        self.dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self.dispatch("POST")

    def dispatch(self, method: str) -> None:
        try:
            path = self.path.split("?", 1)[0]
            body = self.read_json() if method == "POST" else {}
            # 인증 없이 쓸 수 있는 것: 시작 화면, 상태 확인, PIN 확인
            if method == "GET" and path in ("/", "/launch"):
                return self.launch_page()
            if method == "GET" and path == "/health":
                return self.ok({"ok": True, "hostname": socket.gethostname(), "model": device_model(), "version": VERSION, "powerControl": ALLOW_POWER})
            if method == "POST" and path == "/admin/verify":
                return self.ok(verify_admin(str(body.get("pin", ""))))

            route = ROUTES.get((method, path))
            if route is None:
                return self.fail("NOT_FOUND", "unknown endpoint", 404)
            require_admin(self.token())
            if path == "/admin/logout":
                return self.ok(logout_admin(self.token()))
            return self.ok(route(body))
        except AuthError as exc:
            self.fail("UNAUTHORIZED", str(exc), 401)
        except PermissionError as exc:
            self.fail("FORBIDDEN", str(exc), 403)
        except ValueError as exc:
            self.fail("BAD_REQUEST", str(exc), 400)
        except Exception as exc:  # pragma: no cover - defensive for field devices
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
        body = launch_html().replace("__KIOSK_URL__", json.dumps(KIOSK_URL).replace("<", "\\u003c")).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# 로컬 시작 화면 (launch.html): 서버 연결을 기다렸다가 이동하고, 인터넷이 없어도 네트워크를 설정할 수 있다.
LAUNCH_FILES = (
    os.environ.get("MIRAEPASS_KIOSK_LAUNCH_FILE", "/usr/local/share/miraepass-kiosk/launch.html"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "launch.html"),  # 저장소에서 바로 실행할 때
)
# launch.html이 없을 때만 쓰는 최소 화면
LAUNCH_FALLBACK = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>MIRAEPASS 키오스크</title></head>
<body style="font-family:sans-serif;text-align:center;padding-top:20vh"><h1>키오스크를 시작하고 있어요</h1>
<p id="m">서버에 연결하는 중…</p><script>const url=__KIOSK_URL__;
(async function c(){try{await fetch(url,{mode:"no-cors",cache:"no-store"});location.replace(url)}catch(e){
document.getElementById("m").textContent="네트워크에 연결되지 않았어요";setTimeout(c,5000)}})()</script></body></html>
"""


def launch_html() -> str:
    for path in LAUNCH_FILES:
        try:
            with open(path, encoding="utf-8") as f:
                return f.read()
        except OSError:
            continue
    return LAUNCH_FALLBACK


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


def wifi_band(freq: str) -> str | None:
    """nmcli FREQ(예: 5180 MHz)를 대역 이름(2.4GHz / 5GHz / 6GHz)으로 바꾼다."""
    m = re.match(r"(\d+)", freq.strip())
    if not m:
        return None
    mhz = int(m.group(1))
    if mhz < 3000:
        return "2.4GHz"
    if mhz < 5925:
        return "5GHz"
    return "6GHz"


def wifi_dbm(device: str) -> int | None:
    """실제 수신 세기(dBm). iw가 없거나 연결이 없으면 None."""
    proc = run(["iw", "dev", device, "link"], timeout=5)
    m = re.search(r"signal:\s*(-?\d+)\s*dBm", proc.stdout) if proc.returncode == 0 else None
    return int(m.group(1)) if m else None


def wifi_status() -> dict[str, Any]:
    dev = first_device("wifi")
    radio = run(["nmcli", "radio", "wifi"], timeout=10).stdout.strip()
    empty = {"ssid": None, "signal": None, "dbm": None, "band": None, "rate": None}
    if not dev:
        return {"device": None, "connected": False, "state": "not_found", "radio": radio, **empty, "addresses": [], "gateway": "", "dns": []}
    info = dict(empty)
    if dev["state"] == "connected":
        # 캐시된 검색 결과만 읽는다 (--rescan no): 자주 불러도 무선 연결에 부담이 없다
        proc = run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL,FREQ,RATE", "device", "wifi", "list", "ifname", dev["device"], "--rescan", "no"], timeout=10)
        for line in proc.stdout.splitlines():
            parts = split_terse(line)
            if len(parts) >= 5 and parts[0] == "yes":
                info.update(
                    ssid=parts[1] or None,
                    signal=int(parts[2]) if parts[2].isdigit() else None,
                    band=wifi_band(parts[3]),
                    rate=parts[4].strip() or None,
                )
                break
        info["dbm"] = wifi_dbm(dev["device"])
    return {
        "device": dev["device"],
        "connected": dev["state"] == "connected",
        "state": dev["state"],
        "radio": radio,
        **info,
        "ssid": info["ssid"] or dev["connection"] or None,
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
    out = nmcli_checked(["-t", "-f", "ACTIVE,SSID,SECURITY,SIGNAL,FREQ", "device", "wifi", "list", "--rescan", "yes"], timeout=30, error="Wi‑Fi 검색에 실패했어요")
    best: dict[str, dict[str, Any]] = {}
    bands: dict[str, set[str]] = {}
    for line in out.splitlines():
        parts = split_terse(line)
        if len(parts) < 5:
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
            "band": wifi_band(parts[4]),
        }
        if item["band"]:
            bands.setdefault(ssid, set()).add(item["band"])
        prev = best.get(ssid)
        if prev is None or item["active"] or (not prev["active"] and item["signal"] > prev["signal"]):
            best[ssid] = item
    for ssid, item in best.items():
        # 같은 이름이 2.4/5GHz 모두 있으면 둘 다 표시 (신호·대역은 가장 센 AP 기준)
        item["bands"] = sorted(bands.get(ssid, set()))
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
    # 줄 위치는 그대로 두고 값만 바꾼다 (없으면 끝에 추가)
    out = [f"DISPLAY_ROTATE={rotation}" if line.startswith("DISPLAY_ROTATE=") else line for line in lines]
    if not any(line.startswith("DISPLAY_ROTATE=") for line in lines):
        out.append(f"DISPLAY_ROTATE={rotation}")
    directory = os.path.dirname(KIOSK_ENV_FILE) or "."
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".miraepass-kiosk.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, KIOSK_ENV_FILE)


TOUCH_CONF = os.environ.get("MIRAEPASS_KIOSK_TOUCH_CONF", "/etc/X11/xorg.conf.d/99-miraepass-touch-rotation.conf")
TOUCH_MATRIX = {
    "normal": "1 0 0 0 1 0 0 0 1",
    "left": "0 -1 1 1 0 0 0 0 1",
    "right": "0 1 0 -1 0 1 0 0 1",
    "inverted": "-1 0 1 0 -1 1 0 0 1",
}


def write_touch_conf(rotation: str) -> None:
    """저장된 방향을 Xorg 입력 설정으로도 남긴다.
    터치 장치가 다시 연결되면(USB 재인식·화면 전원 재투입) xinput으로 준 값이 사라지는데,
    이 설정이 있으면 새로 잡힌 터치스크린에도 같은 변환 행렬이 자동으로 적용된다.
    회전 스크립트의 xinput 값과 같은 속성(TransformationMatrix)이라 이중으로 돌지 않는다."""
    if rotation == "normal":
        try:
            os.unlink(TOUCH_CONF)
        except FileNotFoundError:
            pass
        return
    os.makedirs(os.path.dirname(TOUCH_CONF), exist_ok=True)
    with open(TOUCH_CONF, "w", encoding="utf-8") as f:
        f.write(
            "# MIRAEPASS 키오스크 화면 방향에 맞춘 터치 좌표 변환 (관리자 모드가 자동 생성)\n"
            'Section "InputClass"\n'
            '    Identifier "miraepass touchscreen rotation"\n'
            '    MatchIsTouchscreen "on"\n'
            f'    Option "TransformationMatrix" "{TOUCH_MATRIX[rotation]}"\n'
            "EndSection\n"
        )


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
            write_touch_conf(rotation)
        return display_status()


def revert_rotation() -> dict[str, Any]:
    with _display_lock:
        if _pending:
            previous = _pending["previous"]
            _clear_pending()
            apply_rotation(previous)
        return display_status()


# ───────────────────────── 관리자 / 시스템 ─────────────────────────


class AuthError(PermissionError):
    """관리자 인증 실패 (401)."""


_auth_lock = threading.Lock()
# 관리자 토큰은 /run(재부팅하면 지워지는 메모리 파일시스템)에도 저장한다.
# 업데이트로 이 서비스가 다시 시작돼도 관리자 모드가 인증을 잃지 않게 하기 위해서다.
TOKEN_FILE = os.environ.get("MIRAEPASS_KIOSK_TOKEN_FILE", "/run/miraepass/admin-tokens.json")


def _load_tokens() -> dict[str, float]:
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            data = json.load(f)
        # time.monotonic()은 부팅 기준 시계라 프로세스가 바뀌어도 이어진다
        now = time.monotonic()
        return {str(t): float(exp) for t, exp in data.items() if float(exp) > now}
    except (OSError, ValueError, AttributeError):
        return {}


def _save_tokens() -> None:
    try:
        os.makedirs(os.path.dirname(TOKEN_FILE), mode=0o700, exist_ok=True)
        tmp = TOKEN_FILE + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(_tokens, f)
        os.replace(tmp, TOKEN_FILE)
    except OSError:
        pass  # 저장하지 못해도 메모리 토큰으로 동작한다


_tokens: dict[str, float] = _load_tokens()
_pin_failures = {"count": 0, "until": 0.0}


def _allowed_origins() -> set[str]:
    extra = {o.strip().rstrip("/") for o in os.environ.get("MIRAEPASS_KIOSK_ALLOWED_ORIGINS", "").split(",") if o.strip()}
    if KIOSK_URL:
        parts = urlsplit(KIOSK_URL)
        extra.add(f"{parts.scheme}://{parts.netloc}")
    return extra


ALLOWED_ORIGINS = _allowed_origins()


def origin_allowed(origin: str) -> bool:
    """클라우드 키오스크 주소와 이 기기(loopback)에서 연 페이지만 허용한다. 주소가 설정되지 않은 개발 환경은 모두 허용."""
    if not KIOSK_URL:
        return True
    if origin.rstrip("/") in ALLOWED_ORIGINS:
        return True
    host = urlsplit(origin).hostname or ""
    return host in ("127.0.0.1", "localhost", "::1")


def verify_admin(pin: str) -> dict[str, Any]:
    with _auth_lock:
        now = time.monotonic()
        if now < _pin_failures["until"]:
            raise AuthError(f"PIN을 여러 번 틀렸어요. {int(_pin_failures['until'] - now) + 1}초 뒤 다시 시도해 주세요")
        if not hmac.compare_digest(pin.encode(), ADMIN_PIN.encode()):
            _pin_failures["count"] += 1
            if _pin_failures["count"] >= PIN_MAX_FAILURES:
                _pin_failures.update(count=0, until=now + PIN_LOCK_SECONDS)
            raise AuthError("관리자 PIN이 맞지 않아요")
        _pin_failures.update(count=0, until=0.0)
        token = secrets.token_urlsafe(24)
        _tokens[token] = now + ADMIN_TOKEN_TTL
        _save_tokens()
        return {"ok": True, "token": token}


def require_admin(token: str) -> None:
    with _auth_lock:
        now = time.monotonic()
        for t, exp in list(_tokens.items()):
            if exp < now:
                del _tokens[t]
        if not token or token not in _tokens:
            raise AuthError("관리자 인증이 만료됐어요. 관리자 모드를 다시 열어 주세요")
        _tokens[token] = now + ADMIN_TOKEN_TTL
        _save_tokens()


def logout_admin(token: str) -> dict[str, Any]:
    with _auth_lock:
        _tokens.pop(token, None)
        _save_tokens()
    return {"ok": True}


# ───────────────────────── SSH ─────────────────────────


def unit_exists(unit: str) -> bool:
    proc = run(["systemctl", "list-unit-files", "--no-legend", "--no-pager", unit], timeout=10)
    return proc.returncode == 0 and any(line.split()[0] == unit for line in proc.stdout.splitlines() if line.strip())


def unit_state(unit: str) -> tuple[bool, bool]:
    """(active, enabled)"""
    active = run(["systemctl", "is-active", unit], timeout=10).stdout.strip() == "active"
    enabled = run(["systemctl", "is-enabled", unit], timeout=10).stdout.strip() in ("enabled", "alias")
    return active, enabled


# Debian/Ubuntu/Raspberry Pi OS: ssh.service (Ubuntu 22.10+는 ssh.socket), Fedora/Arch: sshd.service
SSH_SERVICES = ("ssh.service", "sshd.service")
SSH_SOCKETS = ("ssh.socket", "sshd.socket")


def ssh_ports() -> list[int]:
    sshd = shutil.which("sshd") or ("/usr/sbin/sshd" if os.path.exists("/usr/sbin/sshd") else None)
    ports: list[int] = []
    if sshd:
        proc = run([sshd, "-T"], timeout=10)
        for line in proc.stdout.splitlines():
            key, _, value = line.partition(" ")
            if key == "port" and value.strip().isdigit():
                ports.append(int(value.strip()))
    return sorted(set(ports)) or [22]


def ssh_status() -> dict[str, Any]:
    units = [u for u in (*SSH_SERVICES, *SSH_SOCKETS) if unit_exists(u)]
    on = False
    for unit in units:
        active, enabled = unit_state(unit)
        on = on or active or enabled
    return {"installed": bool(units), "enabled": on, "ports": ssh_ports() if units else []}


def set_ssh(enabled: bool) -> dict[str, Any]:
    services = [u for u in SSH_SERVICES if unit_exists(u)]
    sockets = [u for u in SSH_SOCKETS if unit_exists(u)]
    if not services and not sockets:
        raise RuntimeError("SSH 서버(openssh-server)가 설치돼 있지 않아요")
    if enabled:
        if services:
            # 소켓 활성화와 서비스가 같은 포트를 두고 다투지 않도록 서비스 방식으로 통일한다
            for sock in sockets:
                run(["systemctl", "disable", "--now", sock], timeout=20)
            proc = run(["systemctl", "enable", "--now", services[0]], timeout=30)
        else:
            proc = run(["systemctl", "enable", "--now", sockets[0]], timeout=30)
        if proc.returncode != 0:
            raise RuntimeError(f"SSH를 켜지 못했어요: {proc.stdout.strip()[-300:]}")
    else:
        # 이미 접속 중인 세션은 끊지 않는다 (sshd KillMode=process)
        for unit in (*sockets, *services):
            run(["systemctl", "disable", "--now", unit], timeout=30)
    refresh_firewall()
    return {"ssh": ssh_status(), "firewall": firewall_status()}


# ───────────────────────── 방화벽 ─────────────────────────


def firewall_rules(ssh_ports_allowed: list[int]) -> str:
    """들어오는 연결은 모두 막고, 나가는 연결의 응답과 꼭 필요한 것만 허용한다."""
    ssh_rule = ""
    if ssh_ports_allowed:
        ports = ", ".join(str(p) for p in ssh_ports_allowed)
        ssh_rule = f'        tcp dport {{ {ports} }} accept comment "ssh"\n'
    return f"""#!/usr/sbin/nft -f
# MIRAEPASS 키오스크 방화벽 — 관리자 모드/설치 스크립트가 자동 생성합니다. 직접 고치지 마세요.
# 들어오는 연결 차단, 나가는 연결 허용. SSH가 켜져 있으면 SSH 포트만 허용.
table inet {FIREWALL_TABLE}
delete table inet {FIREWALL_TABLE}

table inet {FIREWALL_TABLE} {{
    chain input {{
        type filter hook input priority 0; policy drop;

        ct state established,related accept
        ct state invalid drop
        iif "lo" accept

        # IPv6 동작에 필요한 ICMPv6(이웃 탐색·라우터 광고 등)과 DHCPv6 응답
        meta l4proto ipv6-icmp icmpv6 type {{ destination-unreachable, packet-too-big, time-exceeded, parameter-problem, nd-router-advert, nd-neighbor-solicit, nd-neighbor-advert }} accept
        ip6 saddr fe80::/10 udp dport 546 accept

{ssh_rule}    }}
}}
"""


def nft_bin() -> str:
    path = shutil.which("nft") or ("/usr/sbin/nft" if os.path.exists("/usr/sbin/nft") else None)
    if not path:
        raise RuntimeError("nftables(nft)가 설치돼 있지 않아요. 설치 스크립트를 다시 실행해 주세요")
    return path


def other_firewalls() -> list[str]:
    found = []
    for unit, name in (("ufw.service", "ufw"), ("firewalld.service", "firewalld")):
        if run(["systemctl", "is-active", unit], timeout=10).stdout.strip() == "active":
            found.append(name)
    return found


def firewall_status() -> dict[str, Any]:
    nft = shutil.which("nft") or ("/usr/sbin/nft" if os.path.exists("/usr/sbin/nft") else None)
    active = bool(nft) and run([nft, "list", "table", "inet", FIREWALL_TABLE], timeout=10).returncode == 0
    enabled = run(["systemctl", "is-enabled", FIREWALL_UNIT], timeout=10).stdout.strip() == "enabled"
    ssh_allowed: list[int] = []
    try:
        with open(FIREWALL_FILE, encoding="utf-8") as f:
            m = re.search(r"tcp dport \{ ([\d, ]+) \} accept", f.read())
            if m:
                ssh_allowed = [int(p) for p in m.group(1).replace(" ", "").split(",") if p]
    except OSError:
        pass
    return {"available": bool(nft), "enabled": enabled or active, "active": active, "sshPorts": ssh_allowed if active else [], "others": other_firewalls()}


def write_firewall() -> str:
    ssh = ssh_status()
    content = firewall_rules(ssh["ports"] if ssh["enabled"] else [])
    nft = nft_bin()
    os.makedirs(os.path.dirname(FIREWALL_FILE), exist_ok=True)
    tmp = f"{FIREWALL_FILE}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    check = run([nft, "-c", "-f", tmp], timeout=15)
    if check.returncode != 0:
        os.unlink(tmp)
        raise RuntimeError(f"방화벽 규칙 검사에 실패했어요: {check.stdout.strip()[-300:]}")
    os.replace(tmp, FIREWALL_FILE)
    unit = f"""[Unit]
Description=MIRAEPASS kiosk firewall (block inbound)
After=nftables.service firewalld.service
Before=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart={nft} -f {FIREWALL_FILE}
ExecStop=-{nft} delete table inet {FIREWALL_TABLE}

[Install]
WantedBy=multi-user.target
"""
    try:
        with open(FIREWALL_UNIT_FILE, encoding="utf-8") as f:
            changed = f.read() != unit
    except OSError:
        changed = True
    if changed:
        with open(FIREWALL_UNIT_FILE, "w", encoding="utf-8") as f:
            f.write(unit)
        run(["systemctl", "daemon-reload"], timeout=20)
    return nft


def set_firewall(enabled: bool) -> dict[str, Any]:
    if enabled:
        write_firewall()
        proc = run(["systemctl", "enable", FIREWALL_UNIT], timeout=20)
        if proc.returncode == 0:
            proc = run(["systemctl", "restart", FIREWALL_UNIT], timeout=20)
        if proc.returncode != 0:
            raise RuntimeError(f"방화벽을 켜지 못했어요: {proc.stdout.strip()[-300:]}")
    else:
        run(["systemctl", "disable", "--now", FIREWALL_UNIT], timeout=20)
        nft = shutil.which("nft")
        if nft:
            run([nft, "delete", "table", "inet", FIREWALL_TABLE], timeout=10)
    return {"ssh": ssh_status(), "firewall": firewall_status()}


def refresh_firewall() -> None:
    """SSH 상태가 바뀌면 방화벽이 켜져 있을 때만 규칙을 다시 만든다."""
    if firewall_status()["enabled"]:
        write_firewall()
        proc = run(["systemctl", "restart", FIREWALL_UNIT], timeout=20)
        if proc.returncode != 0:
            raise RuntimeError(f"방화벽 규칙을 다시 적용하지 못했어요: {proc.stdout.strip()[-300:]}")


def security_status() -> dict[str, Any]:
    return {"ssh": ssh_status(), "firewall": firewall_status()}


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


# ───────────────────────── 업데이트 ─────────────────────────
#
# 기기 스크립트는 GitHub 저장소의 최신 정식 릴리스(태그)에서 받는다. (dev 프리릴리스는 받지 않는다)
#   1) releases/latest 로 최신 버전만 확인 (작은 요청 하나) → 기기보다 높을 때만
#   2) 그 태그의 scripts/kiosk-device 파일을 받아 git blob 해시로 검증
#   3) 받은 install.sh --update 로 적용. 실패하면 백업으로 되돌린다.
# 적용은 miraepass-kiosk-update.service(별도 프로세스)가 한다. 적용 중 로컬 서비스가 재시작돼도 끊기지 않게 하기 위해서다.

UPDATE_REPO = os.environ.get("MIRAEPASS_KIOSK_UPDATE_REPO", "").strip() or "scfs-miraepass/kiosk"
GITHUB_API = os.environ.get("MIRAEPASS_KIOSK_GITHUB_API", "https://api.github.com").rstrip("/")
BUNDLE_PATH = "scripts/kiosk-device"
UPDATE_UNIT = "miraepass-kiosk-update.service"
UPDATE_TIMER = "miraepass-kiosk-update.timer"
UPDATE_DIR = os.environ.get("MIRAEPASS_KIOSK_UPDATE_DIR", "/var/lib/miraepass/update")
UPDATE_STATUS_FILE = os.path.join(UPDATE_DIR, "status.json")
UPDATE_REQUEST_FILE = os.path.join(UPDATE_DIR, "request.json")
UPDATE_LOG_FILE = os.path.join(UPDATE_DIR, "update.log")
UPDATE_LOG_KEEP_LINES = 400  # 지난 실행 기록도 남기되 너무 길어지지 않게
TERMINAL_STATES = ("done", "uptodate", "failed")
# 업데이트가 덮어쓰거나 새로 만드는 파일. 실패하면 이 목록 그대로 되돌린다 (없던 파일은 지운다).
DEPLOYED_FILES = (
    "/usr/local/bin/miraepass-kiosk-control.py",
    "/usr/local/bin/miraepass-kiosk-session",
    "/usr/local/bin/miraepass-kiosk-rotate",
    "/usr/local/share/miraepass-kiosk/launch.html",
    "/usr/local/sbin/miraepass-kiosk-uninstall",
    "/etc/default/miraepass-kiosk",
    "/etc/default/miraepass-kiosk-control",
    "/etc/systemd/system/miraepass-kiosk.service",
    "/etc/systemd/system/miraepass-kiosk-control.service",
    "/etc/systemd/system/miraepass-kiosk-update.service",
    "/etc/systemd/system/miraepass-kiosk-update.timer",
    "/etc/systemd/system/miraepass-firewall.service",
    "/etc/miraepass/firewall.nft",
    "/etc/X11/xorg.conf.d/99-miraepass-touch-rotation.conf",
    "/etc/chromium/policies/managed/miraepass-kiosk.json",
    "/etc/chromium-browser/policies/managed/miraepass-kiosk.json",
    "/etc/opt/chrome/policies/managed/miraepass-kiosk.json",
)
BUNDLE_EXCLUDE = {"README.md"}


def is_bundle_file(name: str) -> bool:
    """기기에 설치하는 파일: 폴더 바로 아래의 일반 파일 (README·숨김·캐시 제외)."""
    return bool(name) and not name.startswith(".") and name not in BUNDLE_EXCLUDE and not name.endswith(".pyc") and "/" not in name and "\\" not in name


def parse_version(version: str) -> tuple[tuple[int, int, int], tuple[Any, ...]] | None:
    """'v1.2.3-dev.4+abc' → ((1,2,3), ('dev', 4)). 정식 릴리스는 프리릴리스보다 높다. 해석할 수 없으면 None."""
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$", version.strip())
    if not m:
        return None
    core = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    pre = tuple(int(p) if p.isdigit() else p for p in m.group(4).split(".")) if m.group(4) else ()
    return core, pre


def _compare_pre(a: tuple[Any, ...], b: tuple[Any, ...]) -> int:
    """semver 프리릴리스 비교: 없음(정식) > 있음, 숫자 < 문자, 앞부분이 같으면 짧은 쪽이 낮다."""
    if a == b:
        return 0
    if not a:
        return 1
    if not b:
        return -1
    for x, y in zip(a, b):
        if x == y:
            continue
        if isinstance(x, int) and isinstance(y, int):
            return 1 if x > y else -1
        if isinstance(x, int) != isinstance(y, int):
            return -1 if isinstance(x, int) else 1
        return 1 if str(x) > str(y) else -1
    return 1 if len(a) > len(b) else -1


def version_newer(latest: str, current: str) -> bool:
    """latest가 current보다 높은지. 설치 버전을 알 수 없으면(unknown 등) 업데이트한다."""
    lv, cv = parse_version(latest), parse_version(current)
    if lv is None:
        return False
    if cv is None:
        return True
    if lv[0] != cv[0]:
        return lv[0] > cv[0]
    return _compare_pre(lv[1], cv[1]) > 0


def _http_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": f"miraepass-kiosk-device/{VERSION}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise FileNotFoundError(url) from None
        if exc.code == 403:
            raise RuntimeError("GitHub 요청 한도를 넘었어요. 잠시 뒤 다시 시도해 주세요") from None
        raise RuntimeError(f"GitHub 요청에 실패했어요 (HTTP {exc.code})") from None
    except Exception as exc:
        raise RuntimeError(f"GitHub에 연결하지 못했어요: {exc}") from None


def latest_release() -> dict[str, str]:
    try:
        data = _http_json(f"{GITHUB_API}/repos/{UPDATE_REPO}/releases/latest")
    except FileNotFoundError:
        raise RuntimeError(f"{UPDATE_REPO} 저장소에서 릴리스를 찾지 못했어요") from None
    tag = str(data.get("tag_name", "")) if isinstance(data, dict) else ""
    if not parse_version(tag):
        raise RuntimeError(f"최신 릴리스 태그를 해석하지 못했어요: {tag!r}")
    return {"tag": tag, "version": tag.lstrip("v")}


def git_blob_sha(content: bytes) -> str:
    """GitHub contents API가 주는 파일 sha와 같은 값 (git blob 해시)."""
    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


def download_release_files(tag: str, dest: str) -> list[str]:
    try:
        listing = _http_json(f"{GITHUB_API}/repos/{UPDATE_REPO}/contents/{BUNDLE_PATH}?ref={urllib.parse.quote(tag)}")
    except FileNotFoundError:
        raise RuntimeError(f"{tag} 릴리스에는 기기 스크립트({BUNDLE_PATH})가 없어요") from None
    if not isinstance(listing, list):
        raise RuntimeError("기기 스크립트 목록을 받지 못했어요")
    names = []
    for item in listing:
        name = str(item.get("name", ""))
        if item.get("type") != "file" or not is_bundle_file(name):
            continue
        url = str(item.get("download_url") or "")
        if not url.startswith("https://"):
            raise RuntimeError(f"다운로드 주소가 올바르지 않아요: {name}")
        req = urllib.request.Request(url, headers={"User-Agent": f"miraepass-kiosk-device/{VERSION}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                content = res.read()
        except Exception as exc:
            raise RuntimeError(f"{name}을(를) 받지 못했어요: {exc}") from None
        if git_blob_sha(content) != item.get("sha"):
            raise RuntimeError(f"받은 파일이 손상됐어요: {name}")
        path = os.path.join(dest, name)
        with open(path, "wb") as f:
            f.write(content)
        os.chmod(path, 0o755 if name.endswith((".sh", ".py")) else 0o644)
        names.append(name)
    if "install.sh" not in names:
        raise RuntimeError(f"{tag} 릴리스에 install.sh가 없어요")
    return names


def _read_json(path: str) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_status(**fields: Any) -> None:
    os.makedirs(UPDATE_DIR, exist_ok=True)
    status = _read_json(UPDATE_STATUS_FILE)
    status.update(fields, updatedAt=int(time.time()))
    tmp = UPDATE_STATUS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False)
    os.replace(tmp, UPDATE_STATUS_FILE)


def _log_tail(lines: int = 60) -> str:
    try:
        with open(UPDATE_LOG_FILE, encoding="utf-8", errors="replace") as f:
            return "".join(f.readlines()[-lines:])
    except OSError:
        return ""


def _trim_log() -> None:
    try:
        with open(UPDATE_LOG_FILE, encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        if len(lines) > UPDATE_LOG_KEEP_LINES:
            with open(UPDATE_LOG_FILE, "w", encoding="utf-8") as f:
                f.writelines(lines[-UPDATE_LOG_KEEP_LINES:])
    except OSError:
        pass


def _unit_running(unit: str) -> bool:
    return run(["systemctl", "is-active", unit], timeout=10).stdout.strip() in ("active", "activating")


def update_status() -> dict[str, Any]:
    status = _read_json(UPDATE_STATUS_FILE)
    auto = run(["systemctl", "is-enabled", UPDATE_TIMER], timeout=10).stdout.strip() == "enabled"
    next_run = run(["systemctl", "show", UPDATE_TIMER, "-p", "NextElapseUSecRealtime", "--value"], timeout=10).stdout.strip() if auto else ""
    return {
        "version": VERSION,
        "repo": UPDATE_REPO,
        "running": _unit_running(UPDATE_UNIT),
        "auto": auto,
        "nextRun": next_run,
        "last": status or None,
        "log": _log_tail(),
    }


def check_update() -> dict[str, Any]:
    release = latest_release()
    return {"current": VERSION, "latest": release["version"], "updateAvailable": version_newer(release["version"], VERSION), "repo": UPDATE_REPO}


def request_update(force: bool) -> dict[str, Any]:
    if _unit_running(UPDATE_UNIT):
        raise RuntimeError("이미 업데이트가 진행 중이에요")
    os.makedirs(UPDATE_DIR, exist_ok=True)
    request_id = secrets.token_hex(8)
    with open(UPDATE_REQUEST_FILE, "w", encoding="utf-8") as f:
        json.dump({"force": force, "requestId": request_id}, f)
    proc = run(["systemctl", "start", "--no-block", UPDATE_UNIT], timeout=10)
    if proc.returncode != 0:
        # 남겨 두면 다음 자동 업데이트가 '수동·강제'로 착각한다
        try:
            os.unlink(UPDATE_REQUEST_FILE)
        except FileNotFoundError:
            pass
        raise RuntimeError(f"업데이트를 시작하지 못했어요: {proc.stdout.strip()[-300:]}")
    # 화면은 이 requestId가 붙은 결과가 나올 때까지 기다린다 (지난 실행 결과와 섞이지 않도록)
    return {**update_status(), "requestId": request_id}


def set_auto_update(enabled: bool) -> dict[str, Any]:
    proc = run(["systemctl", "enable" if enabled else "disable", "--now", UPDATE_TIMER], timeout=20)
    if proc.returncode != 0:
        raise RuntimeError(f"자동 업데이트 설정을 바꾸지 못했어요: {proc.stdout.strip()[-300:]}")
    return update_status()


def _backup_deployed(backup_dir: str) -> None:
    """덮어쓸 파일을 복사해 두고, 지금 없는 파일은 목록에 적어 둔다 (되돌릴 때 지우도록)."""
    shutil.rmtree(backup_dir, ignore_errors=True)
    os.makedirs(backup_dir)
    missing = []
    for path in DEPLOYED_FILES:
        if os.path.exists(path):
            dest = os.path.join(backup_dir, path.lstrip("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(path, dest)
        else:
            missing.append(path)
    with open(os.path.join(backup_dir, "missing.json"), "w", encoding="utf-8") as f:
        json.dump(missing, f)


def _restore_deployed(backup_dir: str, log: Any) -> None:
    missing = set(_read_json_list(os.path.join(backup_dir, "missing.json")))
    for path in DEPLOYED_FILES:
        src = os.path.join(backup_dir, path.lstrip("/"))
        try:
            if os.path.exists(src):
                os.makedirs(os.path.dirname(path), exist_ok=True)
                shutil.copy2(src, path)
            elif path in missing and os.path.exists(path):
                os.unlink(path)  # 업데이트가 새로 만든 파일
        except OSError as exc:
            log.write(f"되돌리기 실패: {path}: {exc}\n")
    run(["systemctl", "daemon-reload"], timeout=30)
    # 이전 프로그램과 이전 방화벽 규칙으로 다시 시작한다
    for unit in ("miraepass-firewall.service", "miraepass-kiosk-control.service", "miraepass-kiosk.service"):
        if run(["systemctl", "is-active", unit], timeout=10).stdout.strip() == "active":
            run(["systemctl", "restart", unit], timeout=60)
    log.write("이전 파일로 되돌렸어요.\n")


def _read_json_list(path: str) -> list[str]:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return [str(x) for x in data] if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _wait_health(expect_version: str, seconds: int = 30) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=3) as res:
                data = json.loads(res.read().decode("utf-8")).get("data", {})
            if data.get("version") == expect_version:
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def run_update() -> int:
    """miraepass-kiosk-update.service가 실행한다. 관리자 모드의 요청이 있으면 수동, 없으면 자동(타이머)."""
    request = _read_json(UPDATE_REQUEST_FILE)
    try:
        os.unlink(UPDATE_REQUEST_FILE)
    except FileNotFoundError:
        pass
    manual = bool(request)
    force = bool(request.get("force"))
    os.makedirs(UPDATE_DIR, exist_ok=True)
    stage = os.path.join(UPDATE_DIR, "stage")
    backup = os.path.join(UPDATE_DIR, "backup")
    _trim_log()

    with open(UPDATE_LOG_FILE, "a", encoding="utf-8") as log:
        log.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} {'수동' if manual else '자동'} 업데이트 (현재 v{VERSION}) =====\n")

        def step(state: str, message: str) -> None:
            log.write(f"[{time.strftime('%H:%M:%S')}] {message}\n")
            log.flush()
            _write_status(state=state, message=message, manual=manual, fromVersion=VERSION, requestId=request.get("requestId"))

        backed_up = False
        try:
            step("checking", f"GitHub({UPDATE_REPO})에서 최신 릴리스를 확인하고 있어요")
            release = latest_release()
            if not force and not version_newer(release["version"], VERSION):
                step("uptodate", f"이미 최신 버전이에요 (기기 v{VERSION}, 최신 릴리스 v{release['version']})")
                return 0

            step("downloading", f"v{release['version']} 파일을 받는 중이에요")
            shutil.rmtree(stage, ignore_errors=True)
            os.makedirs(stage)
            download_release_files(release["tag"], stage)

            step("installing", f"v{release['version']} 적용 중이에요 (화면이 다시 시작될 수 있어요)")
            _backup_deployed(backup)
            backed_up = True
            env = {**os.environ, "KIOSK_VERSION": release["version"]}
            proc = subprocess.run(["bash", os.path.join(stage, "install.sh"), "--update"], stdout=log, stderr=subprocess.STDOUT, env=env, timeout=900, check=False)
            if proc.returncode != 0:
                raise RuntimeError(f"install.sh --update 실패 (종료 코드 {proc.returncode})")
            if not _wait_health(release["version"]):
                raise RuntimeError("업데이트 후 로컬 서비스가 새 버전으로 응답하지 않아요")
            backed_up = False
            _write_status(toVersion=release["version"])
            step("done", f"v{release['version']}(으)로 업데이트했어요")
            return 0
        except BaseException as exc:  # 시간 초과·중단 포함: 적용을 시작했다면 반드시 되돌린다
            detail = "시간이 너무 오래 걸려 중단했어요" if isinstance(exc, subprocess.TimeoutExpired) else str(exc) or exc.__class__.__name__
            log.write(f"오류: {detail}\n")
            if backed_up:
                _restore_deployed(backup, log)
                step("failed", f"업데이트를 적용하지 못해 이전 버전으로 되돌렸어요: {detail}")
            else:
                step("failed", detail)
            if not isinstance(exc, Exception):
                raise
            return 1
        finally:
            shutil.rmtree(stage, ignore_errors=True)


# 관리자 토큰이 필요한 API
ROUTES: dict[tuple[str, str], Any] = {
    ("GET", "/network/status"): lambda b: network_status(),
    ("GET", "/wifi/scan"): lambda b: scan_wifi(),
    ("GET", "/ethernet/status"): lambda b: ethernet_status(),
    ("GET", "/wifi/status"): lambda b: wifi_status(),
    ("GET", "/display/status"): lambda b: display_status(),
    ("GET", "/security/status"): lambda b: security_status(),
    ("POST", "/admin/logout"): lambda b: {"ok": True},
    ("POST", "/wifi/connect"): lambda b: connect_wifi(
        ssid=str(b.get("ssid", "")),
        password=str(b.get("password", "")),
        security_mode=str(b.get("securityMode", "personal")),
        identity=str(b.get("identity", "")),
        hidden=bool(b.get("hidden", False)),
    ),
    ("POST", "/ethernet/config"): configure_ethernet,
    ("POST", "/display/rotation"): lambda b: set_rotation(str(b.get("rotation", ""))),
    ("POST", "/display/confirm"): lambda b: confirm_rotation(),
    ("POST", "/display/revert"): lambda b: revert_rotation(),
    ("POST", "/security/firewall"): lambda b: set_firewall(bool(b.get("enabled"))),
    ("POST", "/security/ssh"): lambda b: set_ssh(bool(b.get("enabled"))),
    ("GET", "/update/status"): lambda b: update_status(),
    ("POST", "/update/check"): lambda b: check_update(),
    ("POST", "/update/apply"): lambda b: request_update(bool(b.get("force"))),
    ("POST", "/update/auto"): lambda b: set_auto_update(bool(b.get("enabled"))),
    ("POST", "/system/reboot"): lambda b: power_action("reboot"),
    ("POST", "/system/shutdown"): lambda b: power_action("shutdown"),
}


def cli(args: list[str]) -> int:
    """설치 스크립트·systemd용:
    firewall on|off|status | touch-conf <방향> | update"""
    if args == ["update"]:
        return run_update()
    if len(args) == 2 and args[0] == "touch-conf" and args[1] in ROTATIONS:
        write_touch_conf(args[1])
        return 0
    if len(args) == 2 and args[0] == "firewall" and args[1] in ("on", "off", "status"):
        result = security_status() if args[1] == "status" else set_firewall(args[1] == "on")
        print(json.dumps(result, ensure_ascii=False))
        return 0
    print("usage: miraepass-kiosk-control.py firewall on|off|status | touch-conf <방향> | update", file=sys.stderr)
    return 2


def main() -> None:
    if len(sys.argv) > 1:
        sys.exit(cli(sys.argv[1:]))
    ThreadingHTTPServer.daemon_threads = True
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"MIRAEPASS kiosk control API listening on http://{HOST}:{PORT}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
