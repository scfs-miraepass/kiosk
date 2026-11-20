"use client";

import { MonitorSmartphone, TriangleAlert } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ClientApiError } from "@/lib/fetcher";
import { TouchKeyboard } from "./touch-keyboard";

/**
 * 키오스크 기기 등록: 관리자 설정 화면의 기기 토큰을 입력.
 * 입력한 토큰은 서버에서 확인된 뒤에만 저장한다.
 */
export function KioskSetup({
  reason,
  onRegistered,
}: {
  /** invalid: 저장돼 있던 토큰을 서버가 거부해서(토큰 변경) 다시 등록하는 중 */
  reason?: "invalid" | null;
  onRegistered: (token: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

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

  return (
    <div className="h-dvh overflow-hidden p-5">
      <div className="flex h-full min-h-0 items-center justify-center overflow-auto">
        <form onSubmit={submit} className="w-full max-w-md space-y-6 rounded-3xl bg-white p-8 shadow-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <MonitorSmartphone className="size-12 text-primary" />
          <h1 className="text-2xl font-bold">키오스크 기기 등록</h1>
          <p className="text-muted-foreground">
            관리자 › 설정 화면의 키오스크 기기 토큰을 입력해 주세요.
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
          onFocus={() => setKeyboardOpen(true)}
          onBlur={() => setKeyboardOpen(false)}
          placeholder="기기 토큰"
          className="h-14 text-lg"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <Button type="submit" className="h-14 w-full text-lg" disabled={!value.trim() || loading}>
            {loading ? "확인 중…" : "등록하기"}
          </Button>
        </div>
      </form>
      </div>
      {keyboardOpen && (
        <TouchKeyboard
          onInput={(text) => setValue((prev) => `${prev}${text}`)}
          onBackspace={() => setValue((prev) => prev.slice(0, -1))}
          onEnter={() => void submit()}
          onClose={() => setKeyboardOpen(false)}
          targetLabel="키오스크 토큰"
          disabled={loading}
        />
      )}
    </div>
  );
}
