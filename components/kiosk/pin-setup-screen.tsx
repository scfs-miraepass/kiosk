"use client";

import { useMutation } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { AlertTriangle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ClientApiError } from "@/lib/fetcher";
import { candidateHonorific, formatPoint } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cartTotalAtom, customerAtom, paymentPendingAtom, stepAtom } from "@/store/kiosk";
import { NumericKeypad } from "./numeric-keypad";
import { PIN_LENGTH as LENGTH, PinBoxes, PinNotice } from "./pin-parts";
import { StepHeader } from "./step-header";
import { useSubmitOrder } from "./use-submit-order";

/**
 * 결제 비밀번호 만들기 + 결제.
 *
 * 결제 비밀번호가 아직 없는 사용자가 6자리를 두 번 눌러 만들고, 만든 비밀번호로 다시 묻지 않고 바로 결제한다.
 * 화면 구성은 결제 비밀번호 화면(PinScreen)과 같다: 화면을 바꾸지 않고 상태 줄(높이 고정)만 바꾼다.
 *
 * 처음 쓰는 사람이 헷갈리지 않도록
 * - 지금 몇 번째 단계인지(① 정하기 → ② 한 번 더) 크게 보여 준다
 * - 계정(로그인) 비밀번호를 넣는 곳이 아니라 '새로 정하는' 숫자라는 것을 따로 알린다
 * - 원하면 누른 숫자를 보면서 입력할 수 있다 (기본은 가림)
 */
export function PinSetupScreen({ shuffle, onHome }: { shuffle: boolean; onHome: () => void }) {
  const setStep = useSetAtom(stepAtom);
  const setPending = useSetAtom(paymentPendingAtom);
  const [customer, setCustomer] = useAtom(customerAtom);
  const total = useAtomValue(cartTotalAtom);
  /** 처음 누른 6자리. null이면 아직 첫 입력 중 */
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<{ message: string; at: number } | null>(null);
  const [reveal, setReveal] = useState(false);

  const restart = (message: string) => {
    setFirst(null);
    setPin("");
    setError({ message, at: Date.now() });
  };

  // 방금 만든 비밀번호가 틀릴 일은 없지만, 그렇게 응답이 오면 일반 결제 화면에서 다시 입력받는다
  const submit = useSubmitOrder({ onInvalidPin: () => setStep("pin") });

  const create = useMutation({
    mutationFn: (value: string) =>
      api<{ set: boolean }>("/api/customers/pin", { method: "POST", kiosk: true, body: { id: customer!.id, pin: value } }),
    onSuccess: (_data, value) => {
      // 이후 결제가 실패해 다시 시도할 때는 일반 결제 화면으로 간다
      setCustomer((c) => (c ? { ...c, needsPinSetup: false } : c));
      submit.mutate(value);
    },
    onError: (e) => {
      // 그 사이 다른 곳에서 비밀번호를 만들었다
      if (e instanceof ClientApiError && e.code === "PIN_ALREADY_SET") return setStep("pin");
      restart(e instanceof ClientApiError ? e.message : "비밀번호를 만들지 못했어요. 다시 시도해 주세요");
    },
  });
  const busy = create.isPending || submit.isPending;

  // 비밀번호를 만드는 동안에도 무입력 타이머·영업 종료 처리로 화면을 끊지 않는다 (결제 중은 useSubmitOrder가 알린다)
  useEffect(() => {
    setPending(busy);
  }, [busy, setPending]);

  if (!customer) return null;

  const type = (d: string) => {
    if (busy || pin.length >= LENGTH) return;
    const next = pin + d;
    if (next.length < LENGTH) return setPin(next);
    if (first === null) {
      setFirst(next);
      setPin("");
      setError(null);
      return;
    }
    if (next !== first) return restart("처음 누른 숫자와 달라요. ①부터 다시 정해 주세요");
    setPin(next);
    create.mutate(next);
  };

  const back = () => {
    if (first === null) return setStep("identify");
    setFirst(null);
    setPin("");
    setError(null);
  };

  return (
    <div className="flex h-dvh flex-col">
      <StepHeader current={3} title="키오스크 결제 비밀번호 만들기" onBack={busy ? undefined : back} onHome={busy ? undefined : onHome} />
      <div className="mx-auto grid min-h-0 w-full max-w-4xl flex-1 gap-6 overflow-y-auto px-4 pb-6 md:grid-cols-2 md:items-center md:gap-10 md:px-8 lg:max-w-6xl lg:gap-16">
        <div className="flex flex-col items-center gap-4 text-center">
          <div>
            <p className="text-2xl font-bold lg:text-3xl">{candidateHonorific(customer)}, 처음 오셨네요!</p>
            <p className="mt-1 text-lg text-muted-foreground lg:text-xl">결제할 때 쓸 숫자 6자리를 새로 정해 주세요</p>
          </div>
          <PinNotice>
            <p className="font-bold">MIRAEPASS 로그인 비밀번호를 넣는 곳이 아니에요</p>
            <p>기억하기 쉬운 숫자 6자리를 새로 정하면, 다음 결제부터 이 숫자를 눌러요</p>
          </PinNotice>

          {/* 단계 표시: 지금 처음 정하는 중인지, 확인을 위해 한 번 더 누르는 중인지 */}
          <ol className="grid w-full max-w-md grid-cols-2 gap-2" aria-label="비밀번호 만들기 단계">
            {(["① 숫자 6자리 정하기", "② 한 번 더 누르기"] as const).map((label, i) => {
              const active = (first === null ? 0 : 1) === i;
              const done = i === 0 && first !== null;
              return (
                <li
                  key={label}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "rounded-2xl px-3 py-3 text-base font-bold lg:text-lg",
                    active ? "bg-primary text-primary-foreground shadow-sm" : done ? "bg-primary/15 text-primary" : "bg-slate-200 text-slate-500",
                  )}
                >
                  {done ? "① 완료" : label}
                </li>
              );
            })}
          </ol>

          <PinBoxes value={pin} reveal={reveal} error={Boolean(error) && first === null} shakeKey={error?.at} />

          {/* 상태 줄: 높이를 미리 잡아 두어 안내가 바뀌어도 화면이 움직이지 않는다 */}
          <div className="flex min-h-11 items-center justify-center" role="status" aria-live="polite">
            {busy ? (
              <p className="flex items-center gap-2 text-lg font-semibold text-primary">
                <Loader2 className="size-5 animate-spin" />
                비밀번호를 만들고 결제하는 중이에요
              </p>
            ) : error ? (
              <p role="alert" className="flex items-center gap-2 rounded-xl bg-destructive/10 px-4 py-2 text-lg font-semibold text-destructive">
                <AlertTriangle className="size-5 shrink-0" />
                {error.message}
              </p>
            ) : (
              <p className="text-lg font-semibold text-slate-600">
                {first === null ? "사용할 숫자 6자리를 눌러 주세요" : "확인을 위해 방금 누른 숫자를 한 번 더 눌러 주세요"}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => setReveal((v) => !v)}
              aria-pressed={reveal}
              className="flex h-12 items-center gap-2 rounded-2xl bg-white px-4 text-base font-bold text-slate-700 shadow-sm active:scale-95 disabled:opacity-40"
            >
              {reveal ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              {reveal ? "숫자 가리기" : "누른 숫자 보기"}
            </button>
            <div className="rounded-2xl bg-white px-5 py-2.5 text-lg shadow-sm">
              결제 금액 <span className="font-extrabold text-primary">{formatPoint(total)}</span>
            </div>
          </div>
          <p className="text-base text-muted-foreground">비밀번호를 만들면 바로 결제돼요. 나중에 MIRAEPASS 앱에서 바꿀 수 있어요</p>
        </div>
        <NumericKeypad
          // 다시 입력할 때마다 숫자 배열을 새로 섞는다 (키패드만 바뀌고 화면은 그대로)
          key={error?.at ?? 0}
          shuffle={shuffle}
          onDigit={type}
          onDelete={() => !busy && setPin((v) => v.slice(0, -1))}
          onClear={() => !busy && setPin("")}
          className={cn("transition-opacity", busy && "pointer-events-none opacity-60")}
        />
      </div>
    </div>
  );
}
