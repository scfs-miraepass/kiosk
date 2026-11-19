"""
미래카페 키오스크(라즈베리파이) 점검 도구 공통 코드.

- 설정 파일(kiosk.conf, 셸 KEY=VALUE 형식) 읽기
- nmcli 실행·출력 해석 (Wi-Fi 목록, 연결 상태)
- PIN 확인

Tk·evdev에 의존하지 않아서 개발 PC에서도 단위 테스트할 수 있다 (test_logic.py).
"""

from __future__ import annotations

import hashlib
import os
import shlex
import subprocess
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

DEFAULT_CONF = os.path.expanduser("~/.config/miraepass-kiosk/kiosk.conf")

DEFAULTS: Dict[str, str] = {
    "KIOSK_URL": "http://127.0.0.1:3000/kiosk",
    # 점검 패널을 여는 제스처: 이 모서리를 MAINT_HOLD_SECONDS 동안 한 손가락으로 누르고 있기
    "MAINT_CORNER": "top-right",
    "MAINT_CORNER_SIZE": "0.08",
    "MAINT_HOLD_SECONDS": "5",
    # 점검 패널 PIN의 sha256 (install.sh가 설정). 비어 있으면 패널을 열지 않는다
    "MAINT_PIN_SHA256": "",
    # 아무 입력이 없으면 패널을 닫고 키오스크로 돌아가는 시간(초)
    "MAINT_IDLE_SECONDS": "120",
    # Chromium 프로필 경로 (키오스크 재시작 시 이 경로로 실행 중인 Chromium만 종료)
    "CHROMIUM_PROFILE": os.path.expanduser("~/.config/chromium-kiosk"),
}


def load_config(path: Optional[str] = None) -> Dict[str, str]:
    """셸에서 source할 수 있는 KEY=VALUE 파일을 읽는다 (주석·따옴표 처리)."""
    conf = dict(DEFAULTS)
    path = path or config_path()
    try:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if key.startswith("export "):
                    key = key[len("export ") :].strip()
                try:
                    parts = shlex.split(value, comments=True)
                    # 셸에서 source할 때처럼 $HOME 등을 풀어 준다
                    conf[key] = os.path.expandvars(parts[0]) if parts else ""
                except ValueError:
                    conf[key] = value.strip()
    except FileNotFoundError:
        pass
    return conf


def config_path() -> str:
    return os.environ.get("MIRAEPASS_KIOSK_CONF", DEFAULT_CONF)


def set_config_value(key: str, value: str, path: Optional[str] = None) -> None:
    """설정 파일의 KEY=VALUE 한 줄을 바꾸거나 없으면 추가한다 (나머지 줄·주석은 그대로)."""
    path = path or config_path()
    line = f"{key}={shlex.quote(value)}\n"
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError:
        lines = []
    for i, raw in enumerate(lines):
        stripped = raw.strip()
        if stripped.startswith(f"{key}=") or stripped.startswith(f"export {key}="):
            lines[i] = line
            break
    else:
        lines.append(line)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.writelines(lines)
    os.replace(tmp, path)


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode("utf-8")).hexdigest()


def check_pin(pin: str, conf: Dict[str, str]) -> bool:
    expected = conf.get("MAINT_PIN_SHA256", "").strip().lower()
    return bool(expected) and hash_pin(pin) == expected


# --------------------------------------------------------------------------
# 명령 실행
# --------------------------------------------------------------------------


@dataclass
class Result:
    code: int
    out: str
    err: str

    @property
    def ok(self) -> bool:
        return self.code == 0

    @property
    def text(self) -> str:
        return (self.out + ("\n" if self.out and self.err else "") + self.err).strip()


def run(cmd: Sequence[str], timeout: float = 30) -> Result:
    try:
        p = subprocess.run(list(cmd), capture_output=True, text=True, timeout=timeout)
        return Result(p.returncode, p.stdout, p.stderr)
    except FileNotFoundError:
        return Result(127, "", f"{cmd[0]}: 명령을 찾을 수 없어요")
    except subprocess.TimeoutExpired:
        return Result(124, "", f"{timeout:.0f}초 안에 끝나지 않아 중단했어요")


def nmcli(args: Sequence[str], timeout: float = 30) -> Result:
    """nmcli 실행. 권한이 없으면 install.sh가 만든 sudoers 규칙으로 다시 시도한다."""
    r = run(["nmcli", *args], timeout)
    if not r.ok and ("not authorized" in r.err.lower() or "insufficient privileges" in r.err.lower()):
        r = run(["sudo", "-n", "nmcli", *args], timeout)
    return r


# --------------------------------------------------------------------------
# nmcli 출력 해석
# --------------------------------------------------------------------------


def split_terse(line: str) -> List[str]:
    """nmcli -t 출력 한 줄을 ':'로 나눈다. 값 안의 ':'와 '\\'는 '\\:', '\\\\'로 이스케이프돼 있다."""
    fields: List[str] = []
    cur: List[str] = []
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == "\\" and i + 1 < len(line):
            cur.append(line[i + 1])
            i += 2
            continue
        if ch == ":":
            fields.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    fields.append("".join(cur))
    return fields


@dataclass
class WifiNetwork:
    ssid: str
    signal: int
    security: str
    in_use: bool

    @property
    def secured(self) -> bool:
        return bool(self.security) and self.security != "--"

    @property
    def enterprise(self) -> bool:
        return "802.1X" in self.security

    @property
    def bars(self) -> str:
        n = 4 if self.signal >= 75 else 3 if self.signal >= 50 else 2 if self.signal >= 25 else 1
        return "▮" * n + "▯" * (4 - n)


def parse_wifi_list(out: str) -> List[WifiNetwork]:
    """`nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY dev wifi list` 출력 → SSID별 가장 강한 신호 하나씩, 강한 순."""
    best: Dict[str, WifiNetwork] = {}
    for line in out.splitlines():
        if not line.strip():
            continue
        f = split_terse(line)
        if len(f) < 4:
            continue
        in_use, ssid, signal, security = f[0].strip() == "*", f[1], f[2], f[3]
        if not ssid:
            continue  # 숨겨진 네트워크는 '숨긴 네트워크 연결'로 직접 입력
        try:
            sig = int(signal)
        except ValueError:
            sig = 0
        prev = best.get(ssid)
        net = WifiNetwork(ssid, sig, security, in_use or bool(prev and prev.in_use))
        if prev is None or sig > prev.signal:
            best[ssid] = net
        elif in_use:
            prev.in_use = True
    return sorted(best.values(), key=lambda n: (not n.in_use, -n.signal, n.ssid.lower()))


def parse_device_status(out: str) -> List[Dict[str, str]]:
    """`nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev status` 출력."""
    rows = []
    for line in out.splitlines():
        f = split_terse(line)
        if len(f) >= 4 and f[1] in ("wifi", "ethernet"):
            rows.append({"device": f[0], "type": f[1], "state": f[2], "connection": f[3]})
    return rows


def wifi_connect_args(ssid: str, password: Optional[str], hidden: bool = False) -> List[str]:
    args = ["dev", "wifi", "connect", ssid]
    if password:
        args += ["password", password]
    if hidden:
        args += ["hidden", "yes"]
    return args


def friendly_nmcli_error(text: str) -> str:
    t = text.lower()
    if "secrets were required" in t or "802-11-wireless-security.psk" in t or "invalid passphrase" in t:
        return "비밀번호가 맞지 않아요"
    if "no network with ssid" in t:
        return "네트워크를 찾을 수 없어요. 다시 검색해 주세요"
    if "not authorized" in t or "insufficient privileges" in t or "a password is required" in t:
        return "권한이 없어요. install.sh로 설치했는지 확인해 주세요"
    if "timeout" in t or "시간" in t:
        return "연결 시간이 초과됐어요"
    return text.strip().splitlines()[-1] if text.strip() else "연결하지 못했어요"
