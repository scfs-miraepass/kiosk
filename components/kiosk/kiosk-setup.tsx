"use client";

import { MonitorSmartphone, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIdleTimer } from "@/hooks/use-idle-timer";
import { api, ClientApiError } from "@/lib/fetcher";

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
  const changing = !!onCancel;

  // 토큰 변경 화면을 열어 둔 채 자리를 비우면 1분 뒤 주문 화면으로 돌아간다
  useIdleTimer(60, () => onCancel?.(), changing && !loading);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    <div className="flex h-dvh items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-6 rounded-3xl bg-white p-8 shadow-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <MonitorSmartphone className="size-12 text-primary" />
          <h1 className="text-2xl font-bold">{changing ? "기기 토큰 변경" : "키오스크 기기 등록"}</h1>
          <p className="text-muted-foreground">
            관리자 › 설정 화면의 키오스크 기기 토큰을 입력해 주세요.
            {changing && <> 새 토큰이 확인돼야 바뀌고, 취소하면 지금 토큰을 그대로 써요.</>}
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
    </div>
  );
}
