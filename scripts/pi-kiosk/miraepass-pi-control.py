#!/usr/bin/env python3
"""Local-only Raspberry Pi control API for the MIRAEPASS kiosk touchscreen.

The cloud-hosted Next.js kiosk page calls this service through
http://127.0.0.1:8765 from Chromium. Keep it bound to loopback only.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = "127.0.0.1"
PORT = int(os.environ.get("MIRAEPASS_PI_CONTROL_PORT", "8765"))
VERSION = "1.0.0"
ADMIN_PIN = os.environ.get("MIRAEPASS_KIOSK_ADMIN_PIN", "2580")
ALLOW_POWER = os.environ.get("MIRAEPASS_PI_ALLOW_POWER") == "1"


def run(args: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, check=False)


def shell(command: str, timeout: int = 20) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["/bin/bash", "-lc", command], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, check=False)


def unescape_nmcli(value: str) -> str:
    return value.replace(r"\:", ":").replace(r"\\", "\\")


class Handler(BaseHTTPRequestHandler):
    server_version = "MiraepassPiControl/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[pi-control]", self.address_string(), fmt % args)

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
            if self.path == "/health":
                return self.ok({"ok": True, "hostname": socket.gethostname(), "user": os.environ.get("USER"), "version": VERSION})
            if self.path == "/wifi/scan":
                return self.ok(scan_wifi())
            if self.path == "/network/status":
                return self.ok(network_status())
            self.fail("NOT_FOUND", "unknown endpoint", 404)
        except PermissionError as exc:
            self.fail("UNAUTHORIZED", str(exc), 401)
        except Exception as exc:  # pragma: no cover - defensive for field devices
            self.fail("INTERNAL", str(exc), 500)

    def do_POST(self) -> None:  # noqa: N802
        try:
            body = self.read_json()
            if self.path == "/wifi/connect":
                return self.ok(connect_wifi(str(body.get("ssid", "")), str(body.get("password", ""))))
            if self.path == "/admin/verify":
                return self.ok(verify_admin(str(body.get("pin", ""))))
            if self.path == "/terminal/run":
                return self.ok(run_terminal(str(body.get("command", ""))))
            if self.path == "/system/reboot":
                return self.ok(power_action("reboot"))
            if self.path == "/system/shutdown":
                return self.ok(power_action("shutdown"))
            self.fail("NOT_FOUND", "unknown endpoint", 404)
        except PermissionError as exc:
            self.fail("UNAUTHORIZED", str(exc), 401)
        except Exception as exc:  # pragma: no cover
            self.fail("INTERNAL", str(exc), 500)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

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


def scan_wifi() -> list[dict[str, Any]]:
    proc = run(["nmcli", "-t", "-f", "SSID,SECURITY,SIGNAL", "device", "wifi", "list", "--rescan", "yes"], timeout=25)
    if proc.returncode != 0:
        raise RuntimeError(proc.stdout.strip() or "nmcli wifi scan failed")
    seen: set[str] = set()
    networks: list[dict[str, Any]] = []
    for line in proc.stdout.splitlines():
        parts = line.split(":")
        if len(parts) < 3:
            continue
        ssid = unescape_nmcli(parts[0]).strip()
        if not ssid or ssid in seen:
            continue
        seen.add(ssid)
        networks.append({"ssid": ssid, "security": unescape_nmcli(parts[1]).strip(), "signal": int(parts[2] or "0")})
    networks.sort(key=lambda item: item["signal"], reverse=True)
    return networks[:30]


def connect_wifi(ssid: str, password: str) -> dict[str, Any]:
    ssid = ssid.strip()
    if not ssid:
        raise RuntimeError("SSID is required")
    args = ["nmcli", "device", "wifi", "connect", ssid]
    if password:
        args.extend(["password", password])
    proc = run(args, timeout=40)
    return {"code": proc.returncode, "output": proc.stdout[-8000:]}


def verify_admin(pin: str) -> dict[str, Any]:
    if pin != ADMIN_PIN:
        raise PermissionError("관리자 PIN이 맞지 않아요")
    return {"ok": True}


def network_status() -> dict[str, Any]:
    return {
        "devices": run(["nmcli", "-t", "device", "status"]).stdout,
        "addresses": shell("ip -br addr").stdout,
        "routes": shell("ip route").stdout,
    }


def run_terminal(command: str) -> dict[str, Any]:
    command = command.strip()
    if not command:
        raise RuntimeError("command is required")
    proc = shell(command, timeout=30)
    return {"code": proc.returncode, "output": proc.stdout[-12000:]}


def power_action(action: str) -> dict[str, Any]:
    if not ALLOW_POWER:
        raise PermissionError("전원 제어는 설치된 키오스크 서비스에서만 사용할 수 있어요")
    if action == "reboot":
        proc = run(["systemctl", "reboot"], timeout=5)
    elif action == "shutdown":
        proc = run(["systemctl", "poweroff"], timeout=5)
    else:
        raise RuntimeError("unknown power action")
    return {"code": proc.returncode, "output": proc.stdout[-2000:]}


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"MIRAEPASS Pi control API listening on http://{HOST}:{PORT}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
