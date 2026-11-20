"use client";

import { MonitorSmartphone, TriangleAlert } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIdleTimer } from "@/hooks/use-idle-timer";
import { useLongPress } from "@/hooks/use-long-press";
import { api, ClientApiError } from "@/lib/fetcher";
import { KioskAdminUnlock } from "./kiosk-admin-unlock";
import { PiControlPanel, type PiControlFocusTarget } from "./pi-control-panel";
import { TouchKeyboard } from "./touch-keyboard";

type FocusTarget = "token" | PiControlFocusTarget;

/**
 * 키오스크 기기 등록 / 토큰 변경: 관리자 설정 화면의 기기 토큰을 입력.
 *
 * 입력한 토큰은 서버에서 확인된 뒤에만 저장한다. 그래서 토큰 변경 화면(onCancel 있음)에서
 * 틀린 토큰을 넣거나 취소해도 기존 토큰은 그대로 남고, 손님이 우연히 열어도 키오스크가 망가지지 않는다.
 */
export function KioskSetup({
  reason,
  onRegistered,
  onCancel,
}: {
  /** invalid: 저장돼 있던 토큰을 서버가 거부해서(토큰 변경) 다시 등록하는 중 */
  reason?: "manual" | "invalid" | null;
  onRegistered: (token: string) => void;
  /** 있으면 '토큰 변경' 모드: 취소하면 기존 토큰으로 돌아간다 */
  onCancel?: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>("token");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [adminUnlockOpen, setAdminUnlockOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const changing = !!onCancel;
  const openAdminUnlock = useLongPress(() => setAdminUnlockOpen(true));

  // 토큰 변경 화면을 열어 둔 채 자리를 비우면 1분 뒤 주문 화면으로 돌아간다
  useIdleTimer(60, () => onCancel?.(), changing && !loading);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const token = value.trim();
    setLoading(true);
    setError(null);
    try {
      await api("/api/kiosk/verify", { method: "POST", kiosk: token });
      onRegistered(token);
    } catch (err) {
      setError(
        err instanceof ClientApiError && err.code === "KIOSK_UNREGISTERED"
          ? "토큰이 맞지 않아요. 관리자 › 설정의 기기 토큰을 확인해 주세요"
          : err instanceof ClientApiError
            ? err.message
            : "확인에 실패했어요",
      );
    } finally {
      setLoading(false);
    }
  };

  const keyboardEvent = (detail: { target: PiControlFocusTarget; value?: string; backspace?: boolean }) => {
    window.dispatchEvent(new CustomEvent("mp-cafe:kiosk-keyboard", { detail }));
  };

  const inputText = (text: string) => {
    if (focusTarget === "token") setValue((prev) => `${prev}${text}`);
    else keyboardEvent({ target: focusTarget, value: text });
  };

  const backspace = () => {
    if (focusTarget === "token") setValue((prev) => prev.slice(0, -1));
    else keyboardEvent({ target: focusTarget, backspace: true });
  };

  const targetLabel: Record<FocusTarget, string> = {
    token: "키오스크 토큰",
    ssid: "Wi‑Fi 이름",
    wifiIdentity: "Enterprise ID",
    wifiPassword: "Wi‑Fi 비밀번호",
  };

  const focus = (target: FocusTarget) => {
    setFocusTarget(target);
    setKeyboardOpen(true);
  };

  const closeAdmin = () => {
    setAdminOpen(false);
    setKeyboardOpen(false);
    onCancel?.();
  };

  return (
    <div className="h-dvh overflow-hidden p-5">
      <div className="flex h-full min-h-0 items-center justify-center overflow-auto">
        {adminOpen ? (
          <PiControlPanel
            onFocusTarget={focus}
            onClose={closeAdmin}
          />
        ) : (
        <form onSubmit={submit} className="w-full max-w-md space-y-6 rounded-3xl bg-white p-8 shadow-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <button {...openAdminUnlock} type="button" className="touch-none rounded-3xl p-2" aria-label="키오스크 기기">
            <MonitorSmartphone className="size-12 text-primary" />
          </button>
          <h1 className="text-2xl font-bold">{changing ? "기기 토큰 변경" : "키오스크 기기 등록"}</h1>
          <p className="text-muted-foreground">
            관리자 › 설정 화면의 키오스크 기기 토큰을 입력해 주세요.
            {changing && <> 새 토큰이 확인돼야 바뀌고, 취소하면 지금 토큰을 그대로 써요.</>}
          </p>
          <p className="rounded-2xl bg-blue-50 p-3 text-sm text-blue-900">
            화면 하단 터치 키보드로 토큰을 입력할 수 있어요.
          </p>
        </div>
        {reason === "invalid" && (
          <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <TriangleAlert className="size-5 shrink-0" />
            저장돼 있던 기기 토큰이 서버와 맞지 않아 등록을 해제했어요. 서버의 토큰이 바뀌었다면 새 토큰을 입력해 주세요.
          </p>
        )}
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => focus("token")}
          placeholder={changing ? "새 기기 토큰" : "기기 토큰"}
          className="h-14 text-lg"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className={changing ? "grid grid-cols-[1fr_2fr] gap-3" : undefined}>
          {changing && (
            <Button type="button" variant="outline" className="h-14 text-lg" onClick={onCancel} disabled={loading}>
              취소
            </Button>
          )}
          <Button type="submit" className="h-14 w-full text-lg" disabled={!value.trim() || loading}>
            {loading ? "확인 중…" : changing ? "변경하기" : "등록하기"}
          </Button>
        </div>
      </form>
        )}
      </div>
      {keyboardOpen && (
        <TouchKeyboard
          onInput={inputText}
          onBackspace={backspace}
          onEnter={focusTarget === "token" ? () => void submit() : () => setKeyboardOpen(false)}
          onClose={() => setKeyboardOpen(false)}
          targetLabel={targetLabel[focusTarget]}
          disabled={loading}
        />
      )}
      {adminUnlockOpen && (
        <KioskAdminUnlock
          onCancel={() => setAdminUnlockOpen(false)}
          onUnlocked={() => {
            setAdminUnlockOpen(false);
            setAdminOpen(true);
          }}
        />
      )}
    </div>
  );
}
