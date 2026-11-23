"use client";

import { Info } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

export const PIN_LENGTH = 6;

/**
 * 결제 비밀번호 입력 칸 6개.
 * 작은 점만 있으면 큰 화면에서 몇 자리를 눌렀는지 알아보기 어려워서, ID 입력처럼 칸을 크게 보여 주고 'n / 6'을 함께 적는다.
 * reveal=true면 점 대신 숫자를 보여 준다 (비밀번호를 처음 만들 때만 선택적으로 사용).
 */
export function PinBoxes({
  value,
  error,
  reveal = false,
  shakeKey,
}: {
  value: string;
  error?: boolean;
  reveal?: boolean;
  /** 바뀌면 다시 마운트되면서 흔들림 애니메이션이 한 번 재생된다 (transform만 사용) */
  shakeKey?: number;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div key={shakeKey ?? 0} className={cn("flex gap-2", error && "kiosk-shake")} aria-label={`${value.length}자리 입력됨`}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "flex size-13 items-center justify-center rounded-2xl bg-white text-3xl font-bold tabular-nums shadow-sm lg:size-16 lg:text-4xl",
              i === value.length && "ring-2 ring-primary",
              error && value.length === 0 && "bg-destructive/5 ring-destructive/40",
            )}
          >
            {i < value.length ? (reveal ? value[i] : <span className="size-4 rounded-full bg-slate-800 lg:size-5" />) : null}
          </span>
        ))}
      </div>
      <p className="text-base font-semibold text-slate-500 tabular-nums">
        {value.length} / {PIN_LENGTH}자리
      </p>
    </div>
  );
}

/**
 * '키오스크 결제 비밀번호'를 MIRAEPASS 계정(로그인) 비밀번호로 착각하는 경우가 많아서 눈에 띄게 따로 알린다.
 */
export function PinNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-md items-start gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-left text-amber-950">
      <Info className="mt-0.5 size-6 shrink-0 text-amber-600" />
      <div className="space-y-0.5 text-base leading-snug lg:text-lg">{children}</div>
    </div>
  );
}
