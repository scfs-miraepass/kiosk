#!/usr/bin/env python3
"""
미래카페 키오스크 점검 패널 (터치 전용).

키보드·마우스 없이 터치만으로 Wi-Fi 연결, 네트워크 상태 확인, 명령 실행, 터미널, 키오스크 재시작·재부팅을 한다.
touch_gesture.py가 화면 모서리 길게 누르기를 감지하면 이 패널을 연다. PIN을 맞혀야 메뉴가 열린다.

  python3 maint_panel.py                       # 전체 화면 (실제 키오스크)
  python3 maint_panel.py --windowed 800x480    # 창 모드 (개발·확인용)
  python3 maint_panel.py --fake                # nmcli·재부팅 등을 실제로 실행하지 않는 가짜 모드 (개발 PC용)
"""

from __future__ import annotations

import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.error
import urllib.request
from typing import Callable, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    Result,
    WifiNetwork,
    check_pin,
    friendly_nmcli_error,
    load_config,
    nmcli,
    parse_device_status,
    parse_wifi_list,
    run,
    set_config_value,
    wifi_connect_args,
)

# 색 (키오스크 웹 화면과 같은 톤)
BG = "#F1F5F9"
CARD = "#FFFFFF"
PRIMARY = "#2563EB"
PRIMARY_FG = "#FFFFFF"
TEXT = "#0F172A"
MUTED = "#64748B"
KEY = "#E2E8F0"
DANGER = "#DC2626"
OK = "#16A34A"
FONT = "NanumGothic"
MONO = "DejaVu Sans Mono"

PIN_MAX_FAILS = 5
PIN_LOCK_SECONDS = 60

QUICK_COMMANDS = [
    ("IP 주소", "ip -br addr"),
    ("네트워크 장치", "nmcli dev status"),
    ("인터넷 확인", "ping -c 3 -W 2 8.8.8.8"),
    ("DNS 확인", "getent hosts google.com"),
    ("온도·전압", "vcgencmd measure_temp; vcgencmd get_throttled"),
    ("디스크", "df -h /"),
    ("메모리", "free -h"),
    ("최근 로그", "journalctl -b -n 40 --no-pager"),
]


# --------------------------------------------------------------------------
# 시스템 작업 (가짜 모드에서는 실제로 바꾸지 않는다)
# --------------------------------------------------------------------------


class System:
    def __init__(self, conf, fake: bool):
        self.conf, self.fake = conf, fake

    def wifi_radio_on(self) -> bool:
        if self.fake:
            return True
        r = nmcli(["radio", "wifi"])
        return r.ok and r.out.strip() == "enabled"

    def wifi_on(self) -> Result:
        return Result(0, "", "") if self.fake else nmcli(["radio", "wifi", "on"])

    def wifi_scan(self) -> List[WifiNetwork]:
        if self.fake:
            time.sleep(0.6)
            return parse_wifi_list(
                "*:SCFS-Cafe:82:WPA2\n:SCFS-Guest:64:\n:SCFS-Staff:58:WPA2 802.1X\n:iptime\\:5G:41:WPA1 WPA2\n"
                ":SCFS-Cafe:40:WPA2\n:Home_WiFi:22:WPA3\n:Classroom-3F:35:WPA2\n:Library:18:WPA2\n"
            )
        r = nmcli(["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "--rescan", "yes"], timeout=25)
        if not r.ok:
            raise RuntimeError(r.text or "Wi-Fi 목록을 가져오지 못했어요")
        return parse_wifi_list(r.out)

    def wifi_connect(self, ssid: str, password: Optional[str], hidden: bool = False) -> Result:
        if self.fake:
            time.sleep(1.2)
            return Result(0, f"Device 'wlan0' successfully activated ('{ssid}')", "") if password != "wrong" else Result(
                4, "", "Error: Connection activation failed: Secrets were required, but not provided."
            )
        return nmcli(wifi_connect_args(ssid, password, hidden), timeout=45)

    def status(self) -> List[tuple]:
        """[(제목, 값, 정상 여부 True/False/None)]"""
        if self.fake:
            time.sleep(0.5)
            return [
                ("wlan0 (Wi-Fi)", "연결됨 · SCFS-Cafe", True),
                ("eth0 (유선)", "연결 안 됨", None),
                ("IP 주소", "wlan0 192.168.0.42/24", None),
                ("게이트웨이", "192.168.0.1", None),
                ("인터넷", "정상 (full)", True),
                ("키오스크 서버", "정상 · HTTP 200", True),
            ]
        rows: List[tuple] = []
        r = nmcli(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "dev", "status"])
        for d in parse_device_status(r.out):
            kind = "Wi-Fi" if d["type"] == "wifi" else "유선"
            connected = d["state"].startswith("connected")
            value = f"연결됨 · {d['connection']}" if connected else {"disconnected": "연결 안 됨", "unavailable": "사용 불가 (케이블·전원 확인)", "unmanaged": "관리 안 됨"}.get(d["state"], d["state"])
            rows.append((f"{d['device']} ({kind})", value, True if connected else None))
        ip = run(["ip", "-4", "-br", "addr"])
        addrs = [" ".join(l.split()[i] for i in (0, 2) if len(l.split()) > i) for l in ip.out.splitlines() if not l.startswith("lo")]
        rows.append(("IP 주소", ", ".join(a for a in addrs if a.strip()) or "없음", bool(addrs) or False))
        gw = run(["ip", "route", "show", "default"]).out.split()
        rows.append(("게이트웨이", gw[2] if len(gw) > 2 else "없음", True if len(gw) > 2 else False))
        c = nmcli(["networking", "connectivity", "check"], timeout=15).out.strip()
        label = {"full": "정상", "limited": "제한됨 (인터넷 안 됨)", "portal": "로그인 필요 (포털)", "none": "연결 안 됨"}.get(c, c or "알 수 없음")
        rows.append(("인터넷", f"{label} ({c})" if c else label, c == "full"))
        rows.append(("키오스크 서버", *self.check_server()))
        return rows

    def check_server(self):
        url = self.conf["KIOSK_URL"]
        try:
            with urllib.request.urlopen(url, timeout=5) as res:
                return f"정상 · HTTP {res.status}", True
        except urllib.error.HTTPError as e:
            return f"응답 오류 · HTTP {e.code}", False
        except Exception as e:  # noqa: BLE001
            return f"연결 안 됨 · {getattr(e, 'reason', e)}", False

    def keyboard_running(self) -> bool:
        return run(["pgrep", "-x", "onboard"]).ok

    def set_kiosk_url(self, url: str) -> None:
        if self.fake:
            self.conf["KIOSK_URL"] = url
            return
        set_config_value("KIOSK_URL", url)
        self.conf["KIOSK_URL"] = url

    def restart_kiosk(self) -> None:
        if not self.fake:
            # kiosk-session의 반복 실행이 2초 뒤 다시 띄운다
            run(["pkill", "-f", f"user-data-dir={self.conf['CHROMIUM_PROFILE']}"])

    def power(self, action: str) -> Result:
        if self.fake:
            return Result(0, "", "")
        return run(["sudo", "-n", "systemctl", action])


# --------------------------------------------------------------------------
# 화면 키보드
# --------------------------------------------------------------------------

LAYOUTS = {
    "lower": ["1234567890", "qwertyuiop", "asdfghjkl", "⇧zxcvbnm⌫"],
    "upper": ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "⇧ZXCVBNM⌫"],
    "symbol": ["1234567890", "!@#$%^&*()", "-_=+[]{};:", "'\",.<>/?\\|`~⌫"],
}


class Keyboard(tk.Frame):
    """영문·숫자·기호 화면 키보드. 비밀번호·SSID·명령 입력용."""

    def __init__(self, master, app: "Panel", var: tk.StringVar, on_enter: Callable[[], None]):
        super().__init__(master, bg=BG)
        self.app, self.var, self.on_enter = app, var, on_enter
        self.layout = "lower"
        self.render()

    def press(self, key: str) -> None:
        if key == "⌫":
            self.var.set(self.var.get()[:-1])
        elif key == "⇧":
            self.layout = "upper" if self.layout == "lower" else "lower"
            self.render()
        elif key == "SYM":
            self.layout = "lower" if self.layout == "symbol" else "symbol"
            self.render()
        elif key == "SPACE":
            self.var.set(self.var.get() + " ")
        elif key == "ENTER":
            self.on_enter()
        else:
            self.var.set(self.var.get() + key)
            if self.layout == "upper":
                self.layout = "lower"
                self.render()

    def render(self) -> None:
        for w in self.winfo_children():
            w.destroy()
        a = self.app
        rows = [list(r) for r in LAYOUTS[self.layout]]
        rows.append(["SYM", "SPACE", "ENTER"])
        for keys in rows:
            row = tk.Frame(self, bg=BG)
            row.pack(fill="x", pady=a.gap // 2)
            for k in keys:
                label = {"SYM": "abc" if self.layout == "symbol" else "!#1", "SPACE": "띄어쓰기", "ENTER": "입력 완료"}.get(k, k)
                # 글자 수 단위 최소 너비: 800px 화면에서 14키 줄도 넘치지 않도록 1글자 + 여백 없음, 남는 폭은 균등 분배
                weight = {"SPACE": 6, "ENTER": 4, "SYM": 2, "⌫": 2, "⇧": 2}.get(k, 1)
                kind = "primary" if k == "ENTER" else "key"
                b = a.button(row, label, lambda k=k: self.press(k), kind=kind, height=a.key_h, font=a.f_key, padx=0)
                b.configure(width=weight)
                b.pack(side="left", expand=True, fill="both", padx=a.gap // 2)


# --------------------------------------------------------------------------
# 패널
# --------------------------------------------------------------------------


class Panel(tk.Tk):
    def __init__(self, fake: bool = False, windowed: Optional[str] = None):
        super().__init__()
        self.conf = load_config()
        self.sys = System(self.conf, fake)
        self.title("키오스크 점검")
        self.configure(bg=BG)
        if windowed:
            self.geometry(windowed)
            w, h = (int(v) for v in windowed.split("+")[0].split("x"))
        else:
            w, h = self.winfo_screenwidth(), self.winfo_screenheight()
            # 창 관리자가 전체 화면 요청을 처리하지 않아도 화면을 채우도록 크기·위치를 직접 지정
            self.geometry(f"{w}x{h}+0+0")
            self.attributes("-fullscreen", True)
        self.attributes("-topmost", True)
        self.sw, self.sh = w, h

        # 화면 크기에 맞춘 글자·버튼 크기 (800×480 공식 7인치 화면부터 1920×1080까지)
        base = min(26, max(14, int(min(w, h) / 32)))
        self.gap = max(4, base // 3)
        self.key_h = 2  # 키 높이(글자 줄 수): 손가락으로 누르기 충분한 높이
        self.f_title = (FONT, int(base * 1.35), "bold")
        self.f_big = (FONT, int(base * 1.1), "bold")
        self.f_body = (FONT, base)
        self.f_small = (FONT, max(11, int(base * 0.8)))
        self.f_key = (FONT, int(base * 1.05), "bold")
        self.f_mono = (MONO, max(10, int(base * 0.75)))

        self.jobs: "queue.Queue[tuple]" = queue.Queue()
        self.busy = 0  # 진행 중인 작업 (자동 닫기 보류)
        self.last_input = time.monotonic()
        self.fails = 0
        self.locked_until = 0.0
        self.unlocked = False
        self.bind_all("<ButtonPress>", self._touch, add="+")
        self.bind_all("<Key>", self._touch, add="+")
        self.after(100, self._poll)
        self.after(1000, self._idle_check)

        self.body = tk.Frame(self, bg=BG)
        self.body.pack(fill="both", expand=True)
        self.screen_pin()

    # ---- 공통 ----------------------------------------------------------

    def _touch(self, _e=None) -> None:
        self.last_input = time.monotonic()

    def _idle_check(self) -> None:
        idle = float(self.conf.get("MAINT_IDLE_SECONDS", "120"))
        if self.busy == 0 and time.monotonic() - self.last_input > idle:
            self.destroy()
            return
        self.after(1000, self._idle_check)

    def _poll(self) -> None:
        try:
            while True:
                done, value, error = self.jobs.get_nowait()
                self.busy = max(0, self.busy - 1)
                self._touch()
                done(value, error)
        except queue.Empty:
            pass
        self.after(100, self._poll)

    def background(self, fn: Callable, done: Callable[[object, Optional[BaseException]], None]) -> None:
        """fn을 스레드에서 실행하고, 결과는 Tk 메인 스레드에서 done(value, error)로 받는다."""
        self.busy += 1

        def work():
            try:
                self.jobs.put((done, fn(), None))
            except BaseException as e:  # noqa: BLE001
                self.jobs.put((done, None, e))

        threading.Thread(target=work, daemon=True).start()

    def button(self, parent, text, command, kind="normal", height=2, font=None, anchor="center", padx=None, wraplength=0):
        """터치용 버튼. tk.Button은 macOS에서 색이 안 바뀌어 Label로 직접 만든다. 손을 뗄 때 실행."""
        colors = {
            "normal": (CARD, TEXT, "#E2E8F0"),
            "primary": (PRIMARY, PRIMARY_FG, "#1D4ED8"),
            "danger": (DANGER, PRIMARY_FG, "#B91C1C"),
            "key": (CARD, TEXT, KEY),
            "ghost": (BG, MUTED, KEY),
        }
        bg, fg, active = colors[kind]
        b = tk.Label(parent, text=text, bg=bg, fg=fg, font=font or self.f_big, height=height, anchor=anchor, padx=self.gap * 2 if padx is None else padx, wraplength=wraplength, justify="center")

        def down(_e):
            b.configure(bg=active)

        def up(e):
            b.configure(bg=bg)
            if 0 <= e.x <= b.winfo_width() and 0 <= e.y <= b.winfo_height():
                command()

        b.bind("<ButtonPress-1>", down)
        b.bind("<ButtonRelease-1>", up)
        return b

    def clear(self) -> tk.Frame:
        for w in self.body.winfo_children():
            w.destroy()
        frame = tk.Frame(self.body, bg=BG)
        frame.pack(fill="both", expand=True, padx=self.gap * 3, pady=self.gap * 2)
        return frame

    def header(self, parent, title: str, back: Optional[Callable] = None) -> None:
        bar = tk.Frame(parent, bg=BG)
        bar.pack(fill="x", pady=(0, self.gap * 2))
        if back:
            self.button(bar, "‹ 뒤로", back, kind="normal", height=1).pack(side="left")
        tk.Label(bar, text=title, bg=BG, fg=TEXT, font=self.f_title).pack(side="left", padx=self.gap * 3)
        self.button(bar, "닫기 ✕", self.destroy, kind="ghost", height=1).pack(side="right")

    def message(self, title: str, text: str, back: Callable, ok: Optional[bool] = None) -> None:
        f = self.clear()
        self.header(f, title, back)
        color = OK if ok else DANGER if ok is False else TEXT
        tk.Label(f, text=text, bg=BG, fg=color, font=self.f_big, wraplength=self.sw - self.gap * 12, justify="center").pack(expand=True)
        self.button(f, "확인", back, kind="primary").pack(fill="x")

    def progress(self, title: str, text: str) -> None:
        f = self.clear()
        self.header(f, title)
        tk.Label(f, text=text, bg=BG, fg=MUTED, font=self.f_big).pack(expand=True)

    def confirm(self, title: str, text: str, yes: str, on_yes: Callable, back: Callable) -> None:
        f = self.clear()
        self.header(f, title, back)
        tk.Label(f, text=text, bg=BG, fg=TEXT, font=self.f_big, wraplength=self.sw - self.gap * 12).pack(expand=True)
        row = tk.Frame(f, bg=BG)
        row.pack(fill="x")
        self.button(row, "취소", back).pack(side="left", expand=True, fill="x", padx=(0, self.gap))
        self.button(row, yes, on_yes, kind="danger").pack(side="left", expand=True, fill="x", padx=(self.gap, 0))

    def text_input(self, title: str, on_ok: Callable[[str], None], back: Callable, secret=False, initial="", hint="") -> None:
        """전체 화면 키보드로 글자 입력"""
        f = self.clear()
        self.header(f, title, back)
        if hint:
            tk.Label(f, text=hint, bg=BG, fg=MUTED, font=self.f_small, wraplength=self.sw - self.gap * 12, justify="left").pack(anchor="w")
        var = tk.StringVar(value=initial)
        shown = tk.BooleanVar(value=not secret)
        row = tk.Frame(f, bg=BG)
        row.pack(fill="x", pady=self.gap)
        entry = tk.Entry(row, textvariable=var, font=self.f_big, show="" if not secret else "•", relief="flat", bg=CARD, fg=TEXT, insertwidth=3)
        entry.pack(side="left", fill="x", expand=True, ipady=self.gap * 2)
        if secret:

            def toggle():
                shown.set(not shown.get())
                entry.configure(show="" if shown.get() else "•")
                eye.configure(text="숨기기" if shown.get() else "보기")

            eye = self.button(row, "보기", toggle, height=1, font=self.f_body)
            eye.pack(side="left", padx=(self.gap, 0), fill="y")
        self.button(row, "지우기", lambda: var.set(""), height=1, font=self.f_body).pack(side="left", padx=(self.gap, 0), fill="y")
        Keyboard(f, self, var, lambda: on_ok(var.get())).pack(fill="both", expand=True, pady=(self.gap, 0))

    # ---- PIN ----------------------------------------------------------

    def screen_pin(self) -> None:
        f = self.clear()
        self.header(f, "키오스크 점검")
        if not self.conf.get("MAINT_PIN_SHA256"):
            tk.Label(f, text="점검 PIN이 설정되지 않아 열 수 없어요.\ninstall.sh를 다시 실행해 PIN을 설정해 주세요.", bg=BG, fg=DANGER, font=self.f_big, justify="center").pack(expand=True)
            return
        pin = tk.StringVar()
        info = tk.StringVar(value="점검 PIN을 입력해 주세요")
        tk.Label(f, textvariable=info, bg=BG, fg=MUTED, font=self.f_body).pack()
        dots = tk.Label(f, text="", bg=BG, fg=TEXT, font=self.f_title)
        dots.pack(pady=self.gap)

        def refresh(*_):
            dots.configure(text="● " * len(pin.get()) or " ")

        pin.trace_add("write", refresh) if hasattr(pin, "trace_add") else pin.trace("w", refresh)
        refresh()

        def submit():
            now = time.monotonic()
            if now < self.locked_until:
                info.set(f"{int(self.locked_until - now) + 1}초 뒤에 다시 시도해 주세요")
                pin.set("")
                return
            if check_pin(pin.get(), self.conf):
                self.unlocked = True
                self.screen_home()
                return
            self.fails += 1
            pin.set("")
            if self.fails >= PIN_MAX_FAILS:
                self.fails = 0
                self.locked_until = now + PIN_LOCK_SECONDS
                info.set(f"{PIN_MAX_FAILS}번 틀려서 {PIN_LOCK_SECONDS}초 동안 잠겼어요")
            else:
                info.set(f"PIN이 맞지 않아요 ({PIN_MAX_FAILS - self.fails}번 남음)")

        pad = tk.Frame(f, bg=BG)
        pad.pack(expand=True)
        keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "지움", "0", "확인"]
        for i, k in enumerate(keys):
            if k == "지움":
                cmd = lambda: pin.set(pin.get()[:-1])  # noqa: E731
            elif k == "확인":
                cmd = submit
            else:
                cmd = lambda k=k: len(pin.get()) < 12 and pin.set(pin.get() + k)  # noqa: E731
            b = self.button(pad, k, cmd, kind="primary" if k == "확인" else "key", height=2, font=self.f_key)
            b.configure(width=6)
            b.grid(row=i // 3, column=i % 3, padx=self.gap, pady=self.gap, sticky="nsew")

    # ---- 메뉴 ----------------------------------------------------------

    def screen_home(self) -> None:
        f = self.clear()
        self.header(f, "키오스크 점검")
        grid = tk.Frame(f, bg=BG)
        grid.pack(fill="both", expand=True)
        items = [
            ("Wi-Fi 설정", self.screen_wifi, "primary"),
            ("네트워크 상태", self.screen_status, "normal"),
            ("명령 실행", self.screen_command, "normal"),
            ("터미널 열기", self.open_terminal, "normal"),
            ("고급 네트워크 설정\n(고정 IP·학교 계정 Wi-Fi)", self.open_network_editor, "normal"),
            ("화상 키보드 끄기" if self.sys.keyboard_running() else "화상 키보드 켜기\n(웹 화면 입력용)", self.toggle_keyboard, "normal"),
            ("키오스크 주소 변경", self.change_url, "normal"),
            ("키오스크 다시 시작", lambda: self.confirm("키오스크 다시 시작", "키오스크 화면(Chromium)을 다시 시작할까요?", "다시 시작", self.restart_kiosk, self.screen_home), "normal"),
            ("재부팅", lambda: self.confirm("재부팅", "라즈베리파이를 재부팅할까요?", "재부팅", lambda: self.power("reboot"), self.screen_home), "danger"),
            ("전원 끄기", lambda: self.confirm("전원 끄기", "라즈베리파이 전원을 끌까요?\n다시 켜려면 전원을 뽑았다 꽂아야 해요.", "전원 끄기", lambda: self.power("poweroff"), self.screen_home), "danger"),
        ]
        cols = 2 if self.sw < 1000 else 5
        cell_w = int(self.sw / cols) - self.gap * 8
        for i, (label, cmd, kind) in enumerate(items):
            b = self.button(grid, label, cmd, kind=kind, height=3, font=self.f_big, wraplength=cell_w)
            b.grid(row=i // cols, column=i % cols, padx=self.gap, pady=self.gap, sticky="nsew")
        for c in range(cols):
            grid.columnconfigure(c, weight=1, uniform="menu")
        for r in range((len(items) + cols - 1) // cols):
            grid.rowconfigure(r, weight=1, uniform="menu")
        tk.Label(f, text=f"키오스크 주소: {self.conf['KIOSK_URL']}", bg=BG, fg=MUTED, font=self.f_small).pack(anchor="w", pady=(self.gap, 0))

    # ---- Wi-Fi ----------------------------------------------------------

    def screen_wifi(self, notice: str = "", notice_ok: Optional[bool] = None) -> None:
        self.progress("Wi-Fi 설정", "주변 Wi-Fi를 찾는 중…")

        def scan():
            if not self.sys.wifi_radio_on():
                return None
            return self.sys.wifi_scan()

        def done(nets, err):
            if err:
                return self.message("Wi-Fi 설정", f"Wi-Fi 목록을 가져오지 못했어요\n{err}", self.screen_home, ok=False)
            if nets is None:
                return self.confirm("Wi-Fi 설정", "Wi-Fi가 꺼져 있어요. 켤까요?", "Wi-Fi 켜기", self.turn_wifi_on, self.screen_home)
            self.wifi_list(nets, 0, notice, notice_ok)

        self.background(scan, done)

    def turn_wifi_on(self) -> None:
        self.progress("Wi-Fi 설정", "Wi-Fi를 켜는 중…")
        self.background(self.sys.wifi_on, lambda r, e: self.screen_wifi())

    def wifi_list(self, nets: List[WifiNetwork], page: int, notice: str = "", notice_ok: Optional[bool] = None) -> None:
        f = self.clear()
        self.header(f, "Wi-Fi 설정", self.screen_home)
        current = next((n.ssid for n in nets if n.in_use), None)
        status = notice or (f"현재 연결: {current}" if current else "연결된 Wi-Fi가 없어요")
        color = OK if notice_ok else DANGER if notice_ok is False else (OK if current else MUTED)
        tk.Label(f, text=status, bg=BG, fg=color, font=self.f_body, anchor="w").pack(fill="x")

        actions = tk.Frame(f, bg=BG)
        actions.pack(side="bottom", fill="x", pady=(self.gap, 0))
        # 한 화면에 들어가는 줄 수: 화면 높이에서 제목·상태·아래 버튼·쪽 번호를 뺀 만큼
        row_h = int(self.f_big[1] * 1.9) + self.gap * 3
        used = int(self.f_title[1] * 2.6) + int(self.f_body[1] * 1.8) + int(self.f_big[1] * 2.4) + int(self.f_small[1] * 1.8) + self.gap * 10
        per_page = max(3, (self.sh - used) // row_h)
        pages = max(1, (len(nets) + per_page - 1) // per_page)
        page = min(page, pages - 1)
        if page > 0:
            self.button(actions, "◀", lambda: self.wifi_list(nets, page - 1), height=1).pack(side="left", padx=(0, self.gap))
        self.button(actions, "다시 검색", self.screen_wifi, height=1).pack(side="left", expand=True, fill="x")
        self.button(actions, "숨긴 네트워크", self.hidden_network, height=1).pack(side="left", expand=True, fill="x", padx=self.gap)
        if page < pages - 1:
            self.button(actions, "▶", lambda: self.wifi_list(nets, page + 1), height=1).pack(side="left")

        lst = tk.Frame(f, bg=BG)
        lst.pack(fill="both", expand=True, pady=(self.gap, 0))
        if not nets:
            tk.Label(lst, text="찾은 Wi-Fi가 없어요. 다시 검색해 주세요", bg=BG, fg=MUTED, font=self.f_body).pack(expand=True)
        for n in nets[page * per_page : (page + 1) * per_page]:
            lock = "학교 계정" if n.enterprise else "잠금" if n.secured else "공개"
            label = f"{n.bars}   {n.ssid}   · {lock}" + ("   ✓ 연결됨" if n.in_use else "")
            b = self.button(lst, label, lambda n=n: self.pick_network(n, nets), kind="primary" if n.in_use else "normal", height=1, font=self.f_big, anchor="w")
            b.pack(fill="x", pady=self.gap // 2, ipady=self.gap)
        if pages > 1:
            tk.Label(lst, text=f"{page + 1} / {pages}", bg=BG, fg=MUTED, font=self.f_small).pack(side="bottom")

    def pick_network(self, n: WifiNetwork, nets: List[WifiNetwork]) -> None:
        back = lambda: self.wifi_list(nets, 0)  # noqa: E731
        if n.enterprise:
            return self.message(
                "Wi-Fi 설정",
                f"'{n.ssid}'은(는) 학교 계정(802.1X) 방식이에요.\n메뉴의 '고급 네트워크 설정'에서 아이디와 비밀번호를 넣어 연결해 주세요.",
                back,
            )
        if n.in_use:
            return self.message("Wi-Fi 설정", f"'{n.ssid}'에 이미 연결돼 있어요", back, ok=True)
        if n.secured:
            return self.text_input(f"'{n.ssid}' 비밀번호", lambda pw: self.connect(n.ssid, pw), back, secret=True)
        self.connect(n.ssid, None)

    def hidden_network(self) -> None:
        def got_ssid(ssid: str):
            if not ssid.strip():
                return self.screen_wifi()
            self.text_input(
                f"'{ssid}' 비밀번호",
                lambda pw: self.connect(ssid, pw or None, hidden=True),
                self.screen_wifi,
                secret=True,
                hint="비밀번호가 없는 네트워크면 비운 채로 '입력 완료'를 눌러 주세요",
            )

        self.text_input("숨긴 네트워크 이름(SSID)", got_ssid, self.screen_wifi, hint="이름은 대소문자를 구분해요")

    def connect(self, ssid: str, password: Optional[str], hidden: bool = False) -> None:
        self.progress("Wi-Fi 설정", f"'{ssid}'에 연결하는 중…\n최대 45초 걸릴 수 있어요")

        def done(r: Result, err):
            if err or not r.ok:
                text = friendly_nmcli_error(str(err) if err else r.text)
                return self.screen_wifi(f"'{ssid}' 연결 실패: {text}", False)
            self.screen_wifi(f"'{ssid}'에 연결했어요", True)

        self.background(lambda: self.sys.wifi_connect(ssid, password, hidden), done)

    # ---- 네트워크 상태 ---------------------------------------------------------

    def screen_status(self) -> None:
        self.progress("네트워크 상태", "확인하는 중…")

        def done(rows, err):
            f = self.clear()
            self.header(f, "네트워크 상태", self.screen_home)
            card = tk.Frame(f, bg=CARD)
            card.pack(fill="both", expand=True)
            for title, value, good in rows or [("오류", str(err), False)]:
                line = tk.Frame(card, bg=CARD)
                line.pack(fill="x", padx=self.gap * 3, pady=self.gap)
                tk.Label(line, text=title, bg=CARD, fg=MUTED, font=self.f_body, width=12, anchor="w").pack(side="left")
                color = OK if good else DANGER if good is False else TEXT
                tk.Label(line, text=value, bg=CARD, fg=color, font=self.f_body, anchor="w", wraplength=self.sw * 0.6, justify="left").pack(side="left", fill="x")
            row = tk.Frame(f, bg=BG)
            row.pack(fill="x", pady=(self.gap, 0))
            self.button(row, "새로 고침", self.screen_status, height=1).pack(side="left", expand=True, fill="x", padx=(0, self.gap))
            self.button(row, "Wi-Fi 설정", self.screen_wifi, kind="primary", height=1).pack(side="left", expand=True, fill="x")

        self.background(self.sys.status, done)

    # ---- 명령 실행 ---------------------------------------------------------

    def screen_command(self, command: str = "", output: str = "") -> None:
        f = self.clear()
        self.header(f, "명령 실행", self.screen_home)
        tk.Label(
            f,
            text="키오스크 사용자 권한으로 실행해요 (최대 60초). 입력이 필요한 명령(nano, nmtui 등)은 '터미널 열기'를 쓰세요.",
            bg=BG,
            fg=MUTED,
            font=self.f_small,
            wraplength=self.sw - self.gap * 8,
            justify="left",
        ).pack(anchor="w")

        row = tk.Frame(f, bg=BG)
        row.pack(fill="x", pady=self.gap)
        cmd_label = self.button(row, command or "여기를 눌러 명령 입력", lambda: self.text_input("명령 입력", lambda c: self.screen_command(c, output), lambda: self.screen_command(command, output), initial=command), height=1, font=self.f_mono, anchor="w")
        cmd_label.pack(side="left", expand=True, fill="x")
        self.button(row, "실행", lambda: command.strip() and self.exec_command(command), kind="primary", height=1).pack(side="left", padx=(self.gap, 0))

        quick = tk.Frame(f, bg=BG)
        quick.pack(fill="x")
        cols = 4
        for i, (label, cmd) in enumerate(QUICK_COMMANDS):
            b = self.button(quick, label, lambda cmd=cmd: self.exec_command(cmd), height=1, font=self.f_body)
            b.grid(row=i // cols, column=i % cols, padx=self.gap // 2, pady=self.gap // 2, sticky="nsew")
        for c in range(cols):
            quick.columnconfigure(c, weight=1, uniform="quick")

        out_row = tk.Frame(f, bg=BG)
        out_row.pack(fill="both", expand=True, pady=(self.gap, 0))
        # width/height=1: 기본 요청 크기(80×24글자) 때문에 스크롤 버튼이 화면 밖으로 밀리지 않도록, 남는 공간만 채운다
        text = tk.Text(out_row, font=self.f_mono, bg="#0F172A", fg="#E2E8F0", relief="flat", wrap="char", padx=self.gap, pady=self.gap, width=1, height=1)
        text.insert("1.0", output or "결과가 여기에 나와요")
        text.configure(state="disabled")
        scroll = tk.Frame(out_row, bg=BG)
        scroll.pack(side="right", fill="y", padx=(self.gap, 0))
        text.pack(side="left", fill="both", expand=True)
        self.button(scroll, "▲", lambda: text.yview_scroll(-1, "pages"), height=2).pack(fill="both", expand=True)
        self.button(scroll, "▼", lambda: text.yview_scroll(1, "pages"), height=2).pack(fill="both", expand=True, pady=(self.gap, 0))
        if output:
            text.see("end")

    def exec_command(self, command: str) -> None:
        self.progress("명령 실행", f"$ {command}\n\n실행하는 중…")

        def work():
            # 오류 출력도 실행 순서대로 보이도록 stdout에 합친다
            try:
                p = subprocess.run(["bash", "-lc", command], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=60)
                return f"$ {command}\n{p.stdout.rstrip()}\n\n[종료 코드 {p.returncode}]"
            except subprocess.TimeoutExpired as e:
                partial = e.stdout.decode(errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
                return f"$ {command}\n{partial.rstrip()}\n\n[60초가 지나 중단했어요]"

        self.background(work, lambda out, err: self.screen_command(command, out or str(err)))

    # ---- 외부 프로그램 (터미널·고급 네트워크 설정) + 화상 키보드 -------------------

    def launch_with_keyboard(self, title: str, argv: List[str]) -> None:
        """argv를 위쪽에, 화상 키보드(onboard)를 아래쪽에 띄우고, argv가 끝나면 패널로 돌아온다."""
        if not shutil.which(argv[0]):
            return self.message(title, f"{argv[0]}이(가) 설치돼 있지 않아요.\ninstall.sh를 다시 실행해 주세요.", self.screen_home, ok=False)
        kb_h = int(self.sh * 0.4)
        keyboard = None
        if shutil.which("onboard"):
            keyboard = subprocess.Popen(["onboard", "-l", "Compact", "-s", f"{self.sw}x{kb_h}", "-x", "0", "-y", str(self.sh - kb_h)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        proc = subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.withdraw()

        def wait():
            proc.wait()
            if keyboard:
                keyboard.terminate()
            return None

        def back(_v, _e):
            self.deiconify()
            self.attributes("-topmost", True)
            self.screen_home()

        # 프로그램이 열려 있는 동안은 background 작업으로 세어 자동 닫기를 보류한다
        self.background(wait, back)

    def open_terminal(self) -> None:
        kb_h = int(self.sh * 0.4)
        px = max(10, int(self.f_mono[1] * 1.3))  # 글자 크기(pt) → 대략적인 픽셀
        cols = max(40, int(self.sw / (px * 0.6)))
        rows = max(8, int((self.sh - kb_h) / (px * 1.25)) - 1)
        self.launch_with_keyboard(
            "터미널 열기",
            ["xterm", "-fa", "Monospace", "-fs", str(self.f_mono[1]), "-geometry", f"{cols}x{rows}+0+0", "-bg", "#0F172A", "-fg", "#E2E8F0", "-title", "키오스크 터미널 (exit 입력 시 닫힘)"],
        )

    def open_network_editor(self) -> None:
        self.launch_with_keyboard("고급 네트워크 설정", ["nm-connection-editor"])

    # ---- 키오스크·전원 ---------------------------------------------------------

    def toggle_keyboard(self) -> None:
        """
        Chromium 화면 위에 화상 키보드(onboard)를 띄우거나 닫는다.
        키오스크 웹 화면의 입력칸(예: 기기 토큰 등록)은 키보드 없이 입력할 방법이 없어서 필요하다.
        """
        if self.sys.keyboard_running():
            run(["pkill", "-x", "onboard"])
            return self.screen_home()
        if not shutil.which("onboard"):
            return self.message("화상 키보드", "onboard가 설치돼 있지 않아요.\ninstall.sh를 다시 실행해 주세요.", self.screen_home, ok=False)
        kb_h = int(self.sh * 0.4)
        subprocess.Popen(["onboard", "-l", "Compact", "-s", f"{self.sw}x{kb_h}", "-x", "0", "-y", str(self.sh - kb_h)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        # 패널을 닫아 키오스크 화면에서 바로 입력하게 한다. 다 쓰면 점검 패널 → '화상 키보드 끄기'
        self.destroy()

    def change_url(self) -> None:
        def save(url: str):
            url = url.strip()
            if not url.startswith(("http://", "https://")):
                return self.message("키오스크 주소 변경", "주소는 http:// 또는 https://로 시작해야 해요", self.change_url, ok=False)
            self.sys.set_kiosk_url(url)
            self.confirm("키오스크 주소 변경", f"저장했어요.\n{url}\n\n키오스크를 다시 시작해서 적용할까요?", "다시 시작", self.restart_kiosk, self.screen_home)

        self.text_input("키오스크 주소", save, self.screen_home, initial=self.conf["KIOSK_URL"], hint="예) http://192.168.0.10:3000/kiosk")

    def restart_kiosk(self) -> None:
        self.sys.restart_kiosk()
        self.destroy()

    def power(self, action: str) -> None:
        self.progress("전원", "재부팅하는 중…" if action == "reboot" else "전원을 끄는 중…")
        self.background(lambda: self.sys.power(action), lambda r, e: (r and r.ok) or self.message("전원", f"실행하지 못했어요\n{(r.text if r else e) or ''}\ninstall.sh의 sudo 설정을 확인해 주세요.", self.screen_home, ok=False))


def main() -> int:
    fake = "--fake" in sys.argv
    windowed = None
    if "--windowed" in sys.argv:
        i = sys.argv.index("--windowed")
        windowed = sys.argv[i + 1] if i + 1 < len(sys.argv) else "800x480"
    Panel(fake=fake, windowed=windowed).mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
