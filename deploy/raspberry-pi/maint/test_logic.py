"""점검 도구 로직 테스트 (evdev·Tk 없이 실행):  python3 -m unittest -v test_logic.py"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import (  # noqa: E402
    check_pin,
    friendly_nmcli_error,
    hash_pin,
    load_config,
    parse_device_status,
    parse_wifi_list,
    set_config_value,
    split_terse,
    wifi_connect_args,
)
from touch_gesture import HoldDetector  # noqa: E402


class TerseTest(unittest.TestCase):
    def test_escaped_colon_and_backslash(self):
        self.assertEqual(split_terse(r"*:iptime\:5G:41:WPA2"), ["*", "iptime:5G", "41", "WPA2"])
        self.assertEqual(split_terse(r" :a\\b:10:"), [" ", "a\\b", "10", ""])


class WifiListTest(unittest.TestCase):
    OUT = "\n".join(
        [
            "*:Cafe:70:WPA2",
            " :Cafe:85:WPA2",  # 같은 SSID의 다른 AP: 더 강한 신호를 쓰고 '연결됨'은 유지
            " :Guest:90:",
            " ::50:WPA2",  # 숨긴 네트워크는 목록에서 뺀다
            r" :iptime\:5G:30:WPA1 WPA2",
            " :Staff:60:WPA2 802.1X",
        ]
    )

    def test_dedupe_sort_and_flags(self):
        nets = parse_wifi_list(self.OUT)
        self.assertEqual([n.ssid for n in nets], ["Cafe", "Guest", "Staff", "iptime:5G"])
        cafe = nets[0]
        self.assertTrue(cafe.in_use)
        self.assertEqual(cafe.signal, 85)
        self.assertFalse(nets[1].secured)
        self.assertTrue(nets[2].enterprise)
        self.assertEqual(cafe.bars, "▮▮▮▮")

    def test_device_status(self):
        rows = parse_device_status("wlan0:wifi:connected:Cafe\neth0:ethernet:unavailable:\nlo:loopback:connected (externally):lo\n")
        self.assertEqual([r["device"] for r in rows], ["wlan0", "eth0"])

    def test_connect_args(self):
        self.assertEqual(wifi_connect_args("A B", "pw"), ["dev", "wifi", "connect", "A B", "password", "pw"])
        self.assertEqual(wifi_connect_args("H", None, hidden=True), ["dev", "wifi", "connect", "H", "hidden", "yes"])

    def test_friendly_error(self):
        self.assertEqual(friendly_nmcli_error("Error: Connection activation failed: Secrets were required, but not provided."), "비밀번호가 맞지 않아요")
        self.assertIn("권한", friendly_nmcli_error("Error: Not authorized to control networking."))


class ConfigPinTest(unittest.TestCase):
    def test_load_and_pin(self):
        with tempfile.NamedTemporaryFile("w", suffix=".conf", delete=False) as f:
            f.write('# 주석\nKIOSK_URL="http://10.0.0.5:3000/kiosk"  # 서버\nexport MAINT_CORNER=bottom-left\n')
            f.write(f"MAINT_PIN_SHA256={hash_pin('2468')}\n")
            f.write("CHROMIUM_PROFILE=$HOME/.config/chromium-kiosk\n")
        try:
            conf = load_config(f.name)
        finally:
            os.unlink(f.name)
        self.assertEqual(conf["KIOSK_URL"], "http://10.0.0.5:3000/kiosk")
        self.assertEqual(conf["MAINT_CORNER"], "bottom-left")
        self.assertEqual(conf["MAINT_HOLD_SECONDS"], "5")  # 기본값
        self.assertEqual(conf["CHROMIUM_PROFILE"], os.path.expanduser("~/.config/chromium-kiosk"))
        self.assertTrue(check_pin("2468", conf))
        self.assertFalse(check_pin("1357", conf))
        self.assertFalse(check_pin("", {"MAINT_PIN_SHA256": ""}))  # PIN 미설정이면 항상 거부


class SetConfigTest(unittest.TestCase):
    def test_replace_and_append_keep_comments(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "kiosk.conf")
            with open(path, "w") as f:
                f.write("# 주석\nKIOSK_URL=http://old/kiosk\nMAINT_CORNER=top-right\n")
            set_config_value("KIOSK_URL", "http://10.0.0.9:3000/kiosk?a=1&b=2", path)
            set_config_value("MAINT_HOLD_SECONDS", "7", path)
            text = open(path).read()
            self.assertIn("# 주석", text)
            self.assertEqual(text.count("KIOSK_URL="), 1)
            conf = load_config(path)
            self.assertEqual(conf["KIOSK_URL"], "http://10.0.0.9:3000/kiosk?a=1&b=2")  # 셸 특수문자도 그대로
            self.assertEqual(conf["MAINT_HOLD_SECONDS"], "7")
            self.assertEqual(conf["MAINT_CORNER"], "top-right")


class HoldDetectorTest(unittest.TestCase):
    def d(self):
        return HoldDetector("top-right", size=0.1, hold=5)

    def test_fires_once_after_hold(self):
        d = self.d()
        self.assertFalse(d.update(True, 1, 0.95, 0.05, 0))
        self.assertFalse(d.update(True, 1, 0.96, 0.04, 4.9))
        self.assertTrue(d.update(True, 1, 0.96, 0.04, 5.0))
        self.assertFalse(d.update(True, 1, 0.96, 0.04, 9))  # 계속 누르고 있어도 한 번만
        d.update(False, 0, 0.96, 0.04, 10)  # 손을 떼면 다시 가능
        self.assertFalse(d.update(True, 1, 0.96, 0.04, 11))
        self.assertTrue(d.update(True, 1, 0.96, 0.04, 16))

    def test_leaving_corner_or_two_fingers_resets(self):
        d = self.d()
        d.update(True, 1, 0.95, 0.05, 0)
        d.update(True, 1, 0.5, 0.5, 3)  # 모서리 밖으로 밀면 처음부터
        self.assertFalse(d.update(True, 1, 0.95, 0.05, 5.5))
        self.assertFalse(d.update(True, 1, 0.95, 0.05, 10.4))
        self.assertTrue(d.update(True, 1, 0.95, 0.05, 10.5))  # 다시 들어온 5.5초부터 5초
        d = self.d()
        d.update(True, 1, 0.95, 0.05, 0)
        self.assertFalse(d.update(True, 2, 0.95, 0.05, 6))  # 두 손가락은 무시

    def test_other_corners(self):
        self.assertTrue(HoldDetector("bottom-left", 0.1, 1).in_corner(0.02, 0.97))
        self.assertFalse(HoldDetector("bottom-left", 0.1, 1).in_corner(0.97, 0.97))
        with self.assertRaises(ValueError):
            HoldDetector("middle")


if __name__ == "__main__":
    unittest.main()
