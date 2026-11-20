"use client";

import { LockKeyhole, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { KIOSK_CONTROL_URL } from "./admin/local-api";
import { NumericKeypad } from "./numeric-keypad";

export function KioskAdminUnlock({ onUnlocked, onCancel }: { onUnlocked: () => void; onCancel: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (nextPin = pin) => {
    if (nextPin.length < 4) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${KIOSK_CONTROL_URL}/admin/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: nextPin }),
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message ?? "PIN을 확인할 수 없어요");
      onUnlocked();
    } catch (e) {
      setPin("");
      setError(
        e instanceof TypeError || (e instanceof DOMException && e.name === "TimeoutError")
          ? "키오스크 로컬 서비스에 연결할 수 없어요"
          : e instanceof Error
            ? e.message
            : "PIN 확인에 실패했어요",
      );
    } finally {
      setLoading(false);
    }
  };

  const addDigit = (digit: string) => {
    if (loading || pin.length >= 8) return;
    setPin((prev) => `${prev}${digit}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6">
      <div className="w-full max-w-md rounded-[2rem] bg-slate-100 p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <LockKeyhole className="size-7" />
            </div>
            <h2 className="text-2xl font-extrabold">관리자 PIN</h2>
            <p className="text-sm text-muted-foreground">네트워크·전원 설정은 관리자 확인 후 사용할 수 있어요.</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="rounded-full" onClick={onCancel} disabled={loading} aria-label="닫기">
            <X className="size-6" />
          </Button>
        </div>
        <div className="mb-4 flex justify-center gap-2">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className={`size-4 rounded-full ${idx < pin.length ? "bg-primary" : "bg-slate-300"}`} />
          ))}
        </div>
        {error && <p className="mb-4 rounded-2xl bg-red-50 p-3 text-center text-sm font-semibold text-red-700">{error}</p>}
        <NumericKeypad
          onDigit={addDigit}
          onDelete={() => setPin((prev) => prev.slice(0, -1))}
          onClear={() => setPin("")}
          keyClassName="bg-white"
        />
        <Button type="button" className="mt-4 h-14 w-full rounded-2xl text-lg font-bold" onClick={() => void submit()} disabled={loading || pin.length < 4}>
          관리자 모드 열기
        </Button>
        {loading && <p className="mt-4 text-center text-sm font-semibold text-muted-foreground">확인 중…</p>}
      </div>
    </div>
  );
}
