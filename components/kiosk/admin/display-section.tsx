"use client";

import { ArrowUp, Check, Loader2, Monitor, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { BigButton, Card, Notice, type NoticeState, SectionHeader } from "./admin-ui";
import { type DisplayStatus, errorMessage, localApi, type Rotation } from "./local-api";

const OPTIONS: { value: Rotation; label: string; hint: string; deg: number }[] = [
  { value: "normal", label: "기본", hint: "회전 없음", deg: 0 },
  { value: "right", label: "오른쪽으로 90°", hint: "시계 방향", deg: 90 },
  { value: "left", label: "왼쪽으로 90°", hint: "반시계 방향", deg: -90 },
  { value: "inverted", label: "180° 뒤집기", hint: "위아래 반전", deg: 180 },
];

const labelOf = (r: Rotation) => OPTIONS.find((o) => o.value === r)?.label ?? r;

/**
 * 화면 방향 설정.
 * 방향을 바꾸면 터치 좌표도 함께 돌린다. 터치가 맞지 않아 '유지'를 못 누르는 경우를 대비해
 * 로컬 서비스가 15초 뒤 자동으로 이전 방향으로 되돌린다 (페이지가 멈춰도 동작).
 */
export function DisplaySection({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<DisplayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const update = useCallback((next: DisplayStatus) => {
    setStatus(next);
    setSecondsLeft(next.pending?.secondsLeft ?? 0);
  }, []);

  const load = useCallback(async () => {
    try {
      update(await localApi<DisplayStatus>("/display/status"));
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "화면 설정을 불러오지 못했어요") });
    }
  }, [update]);

  useEffect(() => {
    if (disabled) return;
    let alive = true;
    localApi<DisplayStatus>("/display/status")
      .then((next) => alive && update(next))
      .catch((e: unknown) => alive && setNotice({ tone: "error", text: errorMessage(e, "화면 설정을 불러오지 못했어요") }));
    return () => {
      alive = false;
    };
  }, [disabled, update]);

  // 확인 대기 카운트다운. 0이 되면 서비스가 되돌렸는지 다시 확인한다.
  const pending = status?.pending ?? null;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          setTimeout(() => {
            void load();
            setNotice({ tone: "info", text: "확인하지 않아 이전 방향으로 되돌렸어요." });
          }, 1200);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pending, load]);

  const call = async (path: string, body: object, done?: (s: DisplayStatus) => string | null) => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await localApi<DisplayStatus>(path, { method: "POST", body: JSON.stringify(body), timeoutMs: 20_000 });
      update(next);
      const text = done?.(next);
      if (text) setNotice({ tone: "success", text });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "화면 방향을 바꾸지 못했어요") });
    } finally {
      setBusy(false);
    }
  };

  const choose = (rotation: Rotation) => void call("/display/rotation", { rotation });
  const keep = () => void call("/display/confirm", {}, (s) => `화면 방향을 ‘${labelOf(s.saved)}’로 저장했어요.`);
  const revert = () => void call("/display/revert", {}, () => "이전 방향으로 되돌렸어요.");

  const current = status?.rotation ?? null;
  const locked = disabled || busy || !status?.available;

  return (
    <>
      <SectionHeader icon={<Monitor className="size-6" />} title="화면 방향" description="키오스크를 세로/가로로 설치한 방향에 맞게 화면과 터치를 함께 돌립니다." />
      <div className="space-y-4">
        {status && !status.available && <Notice tone="warning">화면 회전 스크립트가 설치돼 있지 않아요. 설치 스크립트를 다시 실행해 주세요.</Notice>}
        <Card title="방향 선택">
          <div className="grid grid-cols-2 gap-3">
            {OPTIONS.map((opt) => {
              const active = current === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={locked || active}
                  onClick={() => choose(opt.value)}
                  className={cn(
                    "flex flex-col items-center gap-3 rounded-3xl border-2 p-5 disabled:cursor-default",
                    active ? "border-primary bg-primary/5" : "border-slate-200 bg-white active:bg-slate-50 disabled:opacity-50",
                  )}
                >
                  {/* 화면 모양 미리보기: 화살표가 회전 후 화면의 위쪽 */}
                  <span className="flex size-20 items-center justify-center">
                    <span
                      className={cn("flex h-12 w-18 items-center justify-center rounded-lg border-4", active ? "border-primary text-primary" : "border-slate-400 text-slate-500")}
                      style={{ transform: `rotate(${opt.deg}deg)` }}
                    >
                      <ArrowUp className="size-6" strokeWidth={3} />
                    </span>
                  </span>
                  <span className="text-center">
                    <span className="block text-lg font-extrabold text-slate-900">{opt.label}</span>
                    <span className="block text-sm text-slate-500">{active ? "현재 방향" : opt.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-sm text-slate-500">
            방향을 바꾼 뒤 15초 안에 ‘유지’를 누르지 않으면 자동으로 원래대로 돌아가요. 터치 위치가 맞지 않으면 그냥 기다리세요.
          </p>
        </Card>
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      </div>

      {pending && secondsLeft > 0 && (
        // 회전 직후 어디를 보고 있든 바로 보이도록 화면 전체에 띄운다 (흐림 없이 단색)
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-6">
          <div className="w-full max-w-md space-y-5 rounded-3xl bg-white p-6 text-center">
            <p className="text-2xl font-extrabold text-slate-900">이 방향을 유지할까요?</p>
            <p className="text-base text-slate-600">
              <span className="text-4xl font-extrabold text-primary tabular-nums">{secondsLeft}</span>
              <span className="mt-1 block">초 뒤 ‘{labelOf(pending.previous)}’ 방향으로 되돌아가요.</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <BigButton variant="outline" onClick={revert} disabled={busy}>
                <RotateCcw className="size-5" /> 되돌리기
              </BigButton>
              <BigButton onClick={keep} disabled={busy}>
                {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />} 유지
              </BigButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
