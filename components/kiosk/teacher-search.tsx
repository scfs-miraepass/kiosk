"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Delete, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api, ClientApiError } from "@/lib/fetcher";
import { INITIAL_KEYS, matchesInitials } from "@/lib/hangul";
import { qk } from "@/lib/query-keys";
import type { TeacherOption } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_INITIALS = 5;

/**
 * 교사 이름 찾기: 성함의 초성을 차례로 눌러 목록을 좁히고 이름을 고른다.
 *
 * 라즈베리파이에서 가볍게 돌도록
 * - 서버에는 첫 초성을 누를 때 한 번만 묻고, 그다음 초성은 받아 둔 목록을 화면에서 거른다
 * - 목록 영역은 높이를 고정해서 결과 수가 바뀌어도 화면이 다시 배치되지 않는다
 * - 목록이 바뀔 때 전환 효과를 넣지 않는다
 */
export function TeacherSearch({
  busy,
  error,
  onPick,
  onInput,
  onUseId,
}: {
  /** 고른 교사를 확인하는 중 */
  busy: boolean;
  /** 고른 뒤 확인에서 난 오류 (잔액 부족 등) */
  error: string | null;
  onPick: (teacher: TeacherOption) => void;
  /** 초성을 누르거나 지울 때 (앞선 오류를 지우는 용도) */
  onInput: () => void;
  onUseId: () => void;
}) {
  const [initials, setInitials] = useState("");
  const [pickedId, setPickedId] = useState<number | null>(null);
  const first = initials.slice(0, 1);

  const teachers = useQuery({
    queryKey: qk.teachers(first),
    queryFn: () => api<TeacherOption[]>("/api/customers/teachers", { method: "POST", kiosk: true, body: { initial: first } }),
    enabled: first !== "",
    staleTime: 5 * 60_000,
  });

  const matched = useMemo(
    () => (teachers.data ?? []).filter((t) => matchesInitials(t.name, initials)),
    [teachers.data, initials],
  );

  const change = (next: string) => {
    if (busy) return;
    onInput();
    setPickedId(null);
    setInitials(next);
  };

  const message = error
    ? error
    : teachers.isError
      ? teachers.error instanceof ClientApiError
        ? teachers.error.message
        : "선생님 목록을 불러오지 못했어요"
      : null;

  const keyBase = "flex h-16 items-center justify-center rounded-2xl text-3xl font-semibold transition-transform duration-100 active:scale-95 md:h-20";

  return (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="space-y-1">
          <p className="text-xl font-semibold">성함의 초성을 차례로 눌러 주세요</p>
          <p className="text-muted-foreground">
            예) 홍길동 선생님 → <b className="text-foreground">ㅎ ㄱ ㄷ</b>
          </p>
        </div>

        <div
          className="flex h-16 w-full max-w-sm items-center justify-center rounded-2xl bg-white text-4xl font-bold tracking-[0.3em] shadow-sm"
          aria-label={`입력한 초성 ${initials}`}
        >
          {initials || <span className="text-lg font-medium tracking-normal text-slate-400">초성 입력</span>}
        </div>

        {/* 목록 영역: 높이 고정 + contain으로 안쪽 변화가 바깥 배치에 영향을 주지 않는다 */}
        <div className="h-64 w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl bg-slate-200/60 p-2 contain-strict md:h-72">
          {first === "" ? (
            <ListHint>초성을 누르면 선생님 목록이 나와요</ListHint>
          ) : teachers.isPending ? (
            <ListHint>
              <Loader2 className="size-7 animate-spin text-primary" />
            </ListHint>
          ) : teachers.isError ? (
            <ListHint>
              <button
                onClick={() => teachers.refetch()}
                className="h-12 rounded-xl bg-white px-5 text-base font-bold shadow-sm active:scale-95"
              >
                다시 시도
              </button>
            </ListHint>
          ) : matched.length === 0 ? (
            <ListHint>해당하는 선생님이 없어요</ListHint>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {matched.map((t) => (
                <li key={t.id}>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setPickedId(t.id);
                      onPick(t);
                    }}
                    className={cn(
                      "flex h-14 w-full items-center justify-center rounded-xl bg-white px-2 text-lg font-bold shadow-sm active:scale-95",
                      pickedId === t.id && "bg-primary text-primary-foreground",
                    )}
                  >
                    <span className="truncate">{t.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 상태 줄: 높이를 미리 잡아 두어 안내가 바뀌어도 화면이 움직이지 않는다 */}
        <div className="flex min-h-11 items-center justify-center" role="status" aria-live="polite">
          {busy ? (
            <p className="flex items-center gap-2 font-semibold text-primary">
              <Loader2 className="size-5 animate-spin" />
              확인하는 중이에요
            </p>
          ) : message ? (
            <p role="alert" className="flex items-center gap-2 rounded-xl bg-destructive/10 px-4 py-2 font-semibold text-destructive">
              <AlertTriangle className="size-5 shrink-0" />
              {message}
            </p>
          ) : null}
        </div>

        <button
          disabled={busy}
          onClick={onUseId}
          className="h-14 w-full max-w-sm rounded-2xl bg-white text-lg font-bold text-slate-700 shadow-sm active:scale-[0.98] disabled:opacity-40"
        >
          ID 4자리로 입력하기
        </button>
      </div>

      <div className={cn("grid grid-cols-4 gap-2.5 md:gap-3", busy && "pointer-events-none opacity-60")}>
        {INITIAL_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => initials.length < MAX_INITIALS && change(initials + k)}
            className={cn(keyBase, "bg-white shadow-sm")}
          >
            {k}
          </button>
        ))}
        <button onClick={() => change("")} className={cn(keyBase, "bg-slate-200 text-lg text-slate-600")}>
          전체삭제
        </button>
        <button onClick={() => change(initials.slice(0, -1))} className={cn(keyBase, "bg-slate-200 text-slate-600")} aria-label="지우기">
          <Delete className="size-8" />
        </button>
      </div>
    </>
  );
}

function ListHint({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-base font-medium text-slate-500">{children}</div>;
}
