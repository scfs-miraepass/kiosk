"use client";

import { useMutation } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { AlertTriangle, GraduationCap, Loader2, Search } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { api, ClientApiError } from "@/lib/fetcher";
import { candidateHonorific } from "@/lib/format";
import type { CustomerCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { cartAtom, customerAtom, idempotencyKeyAtom, newIdempotencyKey, stepAtom } from "@/store/kiosk";
import { NumericKeypad } from "./numeric-keypad";
import { StepHeader } from "./step-header";
import { TeacherSearch } from "./teacher-search";

const ID_LENGTH = 4;

/**
 * 본인 확인: MIRAEPASS ID 4자리(학생은 학번, 교사는 고유 번호)를 입력한다.
 * 교사 ID는 계정을 만든 순서대로 붙어서 모르는 경우가 많으므로, 교사는 이름(초성)으로도 찾을 수 있다.
 * 이름 찾기 버튼이 화면 아래에 있을 때는 선생님들이 잘 찾지 못해서, 맨 위에 '학생 / 선생님' 탭으로 크게 나눈다.
 */
export function IdentifyScreen({ onHome }: { onHome: () => void }) {
  const setStep = useSetAtom(stepAtom);
  const setCustomer = useSetAtom(customerAtom);
  const setKey = useSetAtom(idempotencyKeyAtom);
  const cart = useAtomValue(cartAtom);
  const [mode, setMode] = useState<"id" | "teacher">("id");
  const [id, setId] = useState("");
  const [insufficient, setInsufficient] = useState<CustomerCandidate | null>(null);

  const lookup = useMutation({
    mutationFn: (customerId: number) =>
      api<CustomerCandidate>("/api/customers/lookup", {
        method: "POST",
        kiosk: true,
        // 잔액 비교 금액은 서버가 장바구니로 다시 계산한다
        body: {
          id: customerId,
          items: cart.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, optionItemIds: l.optionItemIds })),
        },
      }),
    onSuccess: (c) => {
      // 잔액이 확실히 부족하면 비밀번호를 받기 전에 알려준다 (최종 판정은 결제 시점)
      if (c.sufficient === false) return setInsufficient(c);
      setCustomer(c);
      setKey(newIdempotencyKey());
      // 결제 비밀번호가 아직 없으면 먼저 만들고 바로 결제한다
      setStep(c.needsPinSetup ? "pin-setup" : "pin");
    },
  });

  const clearError = () => {
    lookup.reset();
    setInsufficient(null);
  };
  const type = (d: string) => {
    clearError();
    setId((v) => (v.length < ID_LENGTH ? v + d : v));
  };
  const switchMode = (next: "id" | "teacher") => {
    clearError();
    setId("");
    setMode(next);
  };

  const error = insufficient
    ? `${candidateHonorific(insufficient)}, 포인트가 부족해요`
    : lookup.error instanceof ClientApiError
      ? lookup.error.message
      : lookup.error
        ? "조회에 실패했어요"
        : null;

  return (
    <div className="flex h-dvh flex-col">
      <StepHeader
        current={2}
        title={mode === "id" ? "학번(ID)을 입력해 주세요" : "선생님 성함을 찾아 주세요"}
        onBack={() => setStep("review")}
        onHome={onHome}
      />
      <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pb-4 md:px-8 lg:max-w-6xl">
        <div className="grid grid-cols-2 gap-2 rounded-3xl bg-slate-200/70 p-1.5" role="tablist" aria-label="본인 확인 방법">
          <ModeTab
            active={mode === "id"}
            disabled={lookup.isPending}
            onClick={() => mode !== "id" && switchMode("id")}
            icon={<GraduationCap className="size-7" />}
            title="학번·ID 입력"
            sub="학생 / ID를 아는 선생님"
          />
          <ModeTab
            active={mode === "teacher"}
            disabled={lookup.isPending}
            onClick={() => mode !== "teacher" && switchMode("teacher")}
            icon={<Search className="size-7" />}
            title="선생님 이름으로 찾기"
            sub="ID를 모르는 선생님"
          />
        </div>
      </div>
      <div className="mx-auto grid min-h-0 w-full max-w-4xl flex-1 gap-6 overflow-y-auto px-4 pb-6 md:grid-cols-2 md:items-center md:gap-10 md:px-8 lg:max-w-6xl lg:gap-16">
        {mode === "teacher" ? (
          <TeacherSearch busy={lookup.isPending} error={error} onPick={(t) => lookup.mutate(t.id)} onInput={clearError} />
        ) : (
          <>
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="space-y-1.5">
                <p className="text-xl font-semibold lg:text-2xl">숫자 4자리를 눌러 주세요</p>
                <p className="text-lg text-muted-foreground">
                  학생은 학번이에요. 예) 3학년 4반 12번 → <b className="text-foreground">3412</b>
                </p>
              </div>
              <div className="mt-1 flex gap-2.5" aria-label={`입력한 ID ${id}`}>
                {Array.from({ length: ID_LENGTH }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "flex size-16 items-center justify-center rounded-2xl bg-white text-4xl font-bold tabular-nums shadow-sm md:size-18 lg:size-20 lg:text-5xl",
                      i === id.length && !lookup.isPending && "ring-2 ring-primary",
                    )}
                  >
                    {id[i] ?? ""}
                  </span>
                ))}
              </div>
              {/* 상태 줄: 높이를 미리 잡아 두어 안내가 바뀌어도 화면이 움직이지 않는다 */}
              <div className="flex min-h-11 items-center justify-center" role="status" aria-live="polite">
                {error && (
                  <p role="alert" className="flex items-center gap-2 rounded-xl bg-destructive/10 px-4 py-2 text-lg font-semibold text-destructive">
                    <AlertTriangle className="size-5 shrink-0" />
                    {error}
                  </p>
                )}
              </div>
              <button
                disabled={id.length !== ID_LENGTH || lookup.isPending}
                onClick={() => lookup.mutate(Number(id))}
                className="flex h-16 w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-primary text-xl font-bold text-primary-foreground active:scale-[0.98] disabled:opacity-40 lg:h-20 lg:text-2xl"
              >
                {lookup.isPending && <Loader2 className="size-6 animate-spin" />}
                다음
              </button>
              <p className="text-base text-muted-foreground">ID는 MIRAEPASS 앱 설정 화면 맨 아래에서도 확인할 수 있어요</p>
            </div>
            <NumericKeypad
              onDigit={type}
              onDelete={() => {
                clearError();
                setId((v) => v.slice(0, -1));
              }}
              onClear={() => {
                clearError();
                setId("");
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ModeTab({
  active,
  disabled,
  onClick,
  icon,
  title,
  sub,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-18 items-center justify-center gap-3 rounded-2xl px-3 text-left transition-colors active:scale-[0.98] disabled:opacity-60 lg:h-20",
        active ? "bg-primary text-primary-foreground shadow-md" : "bg-transparent text-slate-600",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-lg font-bold lg:text-xl">{title}</span>
        <span className={cn("block truncate text-sm font-medium lg:text-base", active ? "text-primary-foreground/80" : "text-slate-500")}>{sub}</span>
      </span>
    </button>
  );
}
