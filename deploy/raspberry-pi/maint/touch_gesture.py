#!/usr/bin/env python3
"""
터치스크린 모서리 길게 누르기 → 점검 패널 열기.

키보드 없이 터치만 되는 키오스크에서 점검 패널을 여는 유일한 입구다.
Chromium(키오스크 페이지)과 상관없이 리눅스 입력 장치(evdev)를 직접 읽기 때문에,
와이파이가 끊겨 키오스크 페이지가 뜨지 않을 때도 동작한다. 터치 이벤트는 가로채지 않는다(읽기만).

  python3 touch_gesture.py           # 감시 (kiosk-session이 실행)
  python3 touch_gesture.py --debug   # 누른 위치를 0~1 좌표로 출력 (모서리 방향 확인용)

필요: python3-evdev, 실행 사용자가 input 그룹 (라즈베리파이 OS 기본 사용자는 이미 포함)
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from typing import Dict, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_config  # noqa: E402

PANEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "maint_panel.py")


class HoldDetector:
    """
    한 손가락으로 지정한 모서리 영역을 hold초 동안 계속 누르고 있으면 True를 한 번 돌려준다.
    손가락이 영역을 벗어나거나, 두 손가락 이상이 닿거나, 손을 떼면 처음부터 다시 잰다.
    한 번 실행된 뒤에는 손을 완전히 뗄 때까지 다시 실행되지 않는다.
    """

    def __init__(self, corner: str = "top-right", size: float = 0.08, hold: float = 5.0):
        if corner not in ("top-left", "top-right", "bottom-left", "bottom-right"):
            raise ValueError(f"MAINT_CORNER 값이 잘못됐어요: {corner}")
        self.corner, self.size, self.hold = corner, size, hold
        self.since: Optional[float] = None
        self.fired = False

    def in_corner(self, x: float, y: float) -> bool:
        top, left = self.corner.startswith("top"), self.corner.endswith("left")
        ok_x = x <= self.size if left else x >= 1 - self.size
        ok_y = y <= self.size if top else y >= 1 - self.size
        return ok_x and ok_y

    def update(self, touching: bool, fingers: int, x: float, y: float, now: float) -> bool:
        if not touching or fingers == 0:
            self.since, self.fired = None, False
            return False
        if self.fired:
            return False
        if fingers != 1 or not self.in_corner(x, y):
            self.since = None
            return False
        if self.since is None:
            self.since = now
        if now - self.since >= self.hold:
            self.fired = True
            return True
        return False


class TouchState:
    """evdev 이벤트를 모아 (누르는 중, 손가락 수, 정규화 x, y)로 만든다. 단일·멀티터치(프로토콜 B) 모두 지원."""

    def __init__(self, dev):
        from evdev import ecodes as e

        self.e = e
        caps = dict(dev.capabilities(absinfo=True)).get(e.EV_ABS, [])
        info = {code: ai for code, ai in caps}
        self.rx = info.get(e.ABS_MT_POSITION_X) or info.get(e.ABS_X)
        self.ry = info.get(e.ABS_MT_POSITION_Y) or info.get(e.ABS_Y)
        self.x = self.y = 0.5
        self.touching = False
        self.slot = 0
        self.slots: Dict[int, bool] = {}

    @staticmethod
    def norm(v: int, ai) -> float:
        span = (ai.max - ai.min) or 1
        return min(1.0, max(0.0, (v - ai.min) / span))

    @property
    def fingers(self) -> int:
        n = sum(1 for active in self.slots.values() if active)
        return n if n else (1 if self.touching else 0)

    def feed(self, ev) -> None:
        e = self.e
        if ev.type == e.EV_KEY and ev.code == e.BTN_TOUCH:
            self.touching = ev.value != 0
            if not self.touching:
                self.slots.clear()
        elif ev.type == e.EV_ABS:
            if ev.code == e.ABS_MT_SLOT:
                self.slot = ev.value
            elif ev.code == e.ABS_MT_TRACKING_ID:
                self.slots[self.slot] = ev.value != -1
            elif ev.code in (e.ABS_X, e.ABS_MT_POSITION_X) and self.rx and (ev.code == e.ABS_X or self.slot == 0):
                self.x = self.norm(ev.value, self.rx)
            elif ev.code in (e.ABS_Y, e.ABS_MT_POSITION_Y) and self.ry and (ev.code == e.ABS_Y or self.slot == 0):
                self.y = self.norm(ev.value, self.ry)


def find_touch_devices():
    from evdev import InputDevice, ecodes as e, list_devices

    found = []
    for path in list_devices():
        try:
            dev = InputDevice(path)
            caps = dev.capabilities()
            abs_codes = [c if isinstance(c, int) else c[0] for c in caps.get(e.EV_ABS, [])]
            has_pos = e.ABS_MT_POSITION_X in abs_codes or e.ABS_X in abs_codes
            if has_pos and e.BTN_TOUCH in caps.get(e.EV_KEY, []):
                found.append(dev)
            else:
                dev.close()
        except OSError:
            continue
    return found


def main() -> int:
    try:
        import evdev  # noqa: F401
    except ImportError:
        print("python3-evdev가 필요해요: sudo apt install python3-evdev", file=sys.stderr)
        return 1
    import select

    debug = "--debug" in sys.argv
    conf = load_config()
    make_detector = lambda: HoldDetector(  # noqa: E731
        conf["MAINT_CORNER"], float(conf["MAINT_CORNER_SIZE"]), float(conf["MAINT_HOLD_SECONDS"])
    )
    panel: Optional[subprocess.Popen] = None

    while True:
        devices = find_touch_devices()
        if not devices:
            # USB 터치스크린을 늦게 꽂는 경우를 위해 기다렸다가 다시 찾는다
            time.sleep(5)
            continue
        if debug:
            for d in devices:
                print(f"터치 장치: {d.path} {d.name}")
        # 장치마다 따로 판정한다 (터치가 없는 다른 장치가 판정을 초기화하지 않도록)
        states = {d.fd: (d, TouchState(d), make_detector()) for d in devices}
        try:
            while True:
                ready, _, _ = select.select(list(states), [], [], 0.2)
                for fd in ready:
                    dev, st, _ = states[fd]
                    for ev in dev.read():
                        st.feed(ev)
                        if debug and ev.type == st.e.EV_SYN:
                            print(f"touch={st.touching} fingers={st.fingers} x={st.x:.2f} y={st.y:.2f}")
                now = time.monotonic()
                for _, st, detector in states.values():
                    if detector.update(st.touching, st.fingers, st.x, st.y, now):
                        if panel is None or panel.poll() is not None:
                            panel = subprocess.Popen([sys.executable, PANEL])
        except OSError:
            # 장치가 빠졌다: 닫고 다시 찾는다
            for dev, _, _ in states.values():
                try:
                    dev.close()
                except OSError:
                    pass
            time.sleep(1)


if __name__ == "__main__":
    sys.exit(main())
