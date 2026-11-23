"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { AlertTriangle, Loader2, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { candidateHonorific, formatPoint } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cartTotalAtom, customerAtom, stepAtom } from "@/store/kiosk";
import { NumericKeypad } from "./numeric-keypad";
import { PIN_LENGTH as LENGTH, PinBoxes, PinNotice } from "./pin-parts";
import { StepHeader } from "./step-header";
import { useSubmitOrder } from "./use-submit-order";

/**
 * 키오스크 결제 비밀번호 입력 + 결제.
 *
 * 6자리를 채우면 이 화면에서 바로 결제를 요청한다 (서버가 비밀번호 검증 → 포인트 차감 → 주문 확정).
 * 예전에는 별도의 '결제 중' 화면으로 넘어갔다가 비밀번호가 틀리면 돌아와서, 응답이 빠를 때 화면이 깜박였다.
 * 지금은 화면을 바꾸지 않고 상태 줄(높이 고정)만 '확인 중' → '오류 안내'로 바꾼다.
 */
export function PinScreen({ shuffle, onHome }: { shuffle: boolean; onHome: () => void }) {
  const setStep = useSetAtom(stepAtom);
  const customer = useAtomValue(customerAtom);
  const total = useAtomValue(cartTotalAtom);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<{ message: string; at: number } | null>(null);

  const submit = useSubmitOrder({
    onInvalidPin: (message) => {
      setPin("");
      setError({ message, at: Date.now() });
    },
  });
  const busy = submit.isPending;

  if (!customer) return null;

  const type = (d: string) => {
    if (busy || pin.length >= LENGTH) return;
    const next = pin + d;
    setPin(next);
    if (next.length === LENGTH) submit.mutate(next);
  };

  return (
    <div className="flex h-dvh flex-col">
      <StepHeader
        current={3}
        title="키오스크 결제 비밀번호"
        onBack={busy ? undefined : () => setStep("identify")}
        onHome={busy ? undefined : onHome}
      />
      <div className="mx-auto grid min-h-0 w-full max-w-4xl flex-1 gap-6 overflow-y-auto px-4 pb-6 md:grid-cols-2 md:items-center md:gap-10 md:px-8 lg:max-w-6xl lg:gap-16">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 lg:size-20">
            <LockKeyhole className="size-8 text-primary lg:size-10" />
          </span>
          <div>
            <p className="text-2xl font-bold lg:text-3xl">{candidateHonorific(customer)}</p>
            <p className="mt-1 text-lg text-muted-foreground lg:text-xl">
              결제 비밀번호 <b className="text-foreground">숫자 6자리</b>를 눌러 주세요
            </p>
          </div>
          <PinNotice>
            <p className="font-bold">MIRAEPASS 로그인 비밀번호가 아니에요</p>
            <p>처음 키오스크에서 결제할 때 직접 정한 숫자 6자리예요</p>
          </PinNotice>
          <PinBoxes value={pin} error={Boolean(error)} shakeKey={error?.at} />

          {/* 상태 줄: 높이를 미리 잡아 두어 안내가 바뀌어도 화면이 움직이지 않는다 */}
          <div className="flex min-h-11 items-center justify-center" role="status" aria-live="polite">
            {busy ? (
              <p className="flex items-center gap-2 text-lg font-semibold text-primary">
                <Loader2 className="size-5 animate-spin" />
                비밀번호를 확인하고 결제하는 중이에요
              </p>
            ) : error ? (
              <p role="alert" className="flex items-center gap-2 rounded-xl bg-destructive/10 px-4 py-2 text-lg font-semibold text-destructive">
                <AlertTriangle className="size-5 shrink-0" />
                {error.message}
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl bg-white px-6 py-3 text-lg shadow-sm lg:text-xl">
            결제 금액 <span className="font-extrabold text-primary">{formatPoint(total)}</span>
          </div>
          <p className="text-base text-muted-foreground">
            비밀번호가 기억나지 않으면 MIRAEPASS 앱에서 키오스크 비밀번호를 다시 정할 수 있어요
          </p>
        </div>
        <NumericKeypad
          // 비밀번호가 틀릴 때마다 숫자 배열을 새로 섞는다 (키패드만 바뀌고 화면은 그대로)
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
