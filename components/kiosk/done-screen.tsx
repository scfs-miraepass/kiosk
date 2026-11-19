"use client";

import confetti from "canvas-confetti";
import { useAtomValue } from "jotai";
import { CheckCircle2, Volume2 } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { formatPoint } from "@/lib/format";
import { customerAtom, orderResultAtom } from "@/store/kiosk";

/**
 * 순서대로 떠오르는 효과(.kiosk-rise)의 지연 시간. CSS(transform·opacity)만 쓴다.
 * 예전 BlurFade는 filter: blur를 JS로 매 프레임 바꿔서 저사양 기기에서 완료 화면 진입이 끊겼다.
 */
const delay = (s: number) => ({ "--delay": `${s}s` }) as CSSProperties;

export function DoneScreen({ seconds, onFinish }: { seconds: number; onFinish: () => void }) {
  const result = useAtomValue(orderResultAtom);
  const customer = useAtomValue(customerAtom);
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    // 저사양(라즈베리파이)에서도 매끄럽도록 입자 수·지속 시간을 줄이고, 화면 전환 프레임과 겹치지 않게 살짝 늦게 쏜다.
    // 기본 confetti()는 OffscreenCanvas + Worker에서 그려서 메인 스레드(터치 반응)를 막지 않는다.
    const colors = ["#2563eb", "#60a5fa", "#fbbf24", "#93c5fd"];
    const fire = (x: number, particleCount: number) =>
      confetti({ particleCount, spread: 70, startVelocity: 42, ticks: 150, origin: { x, y: 0.7 }, colors, disableForReducedMotion: true });
    const timers = [
      setTimeout(() => {
        fire(0.25, 40);
        fire(0.75, 40);
      }, 120),
      setTimeout(() => fire(0.5, 30), 450),
    ];
    return () => {
      timers.forEach(clearTimeout);
      confetti.reset();
    };
  }, []);

  useEffect(() => {
    if (left <= 0) return void onFinish();
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onFinish]);

  if (!result) return null;
  const callName =
    customer?.type === "teacher" ? `${customer.displayName} 선생님` : customer ? `${customer.grade}학년 ${customer.displayName}님` : "";

  return (
    <button onClick={onFinish} className="flex h-dvh w-full flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="kiosk-rise" style={delay(0.05)}>
        <CheckCircle2 className="size-20 text-success md:size-24" />
      </div>
      <div className="kiosk-rise" style={delay(0.12)}>
        <h1 className="text-h6 font-extrabold md:text-h4">주문이 완료됐어요!</h1>
      </div>
      <div className="kiosk-rise flex flex-col items-center rounded-[2rem] bg-white px-14 py-6 shadow-sm" style={delay(0.2)}>
        <span className="text-lg font-semibold text-muted-foreground">주문번호</span>
        {/* 숫자가 0부터 올라가는 카운터(매 프레임 텍스트·레이아웃 갱신) 대신 번호를 바로 보여주고 크기만 튀어나오게 */}
        <span
          className="kiosk-pop inline-block text-[5.5rem] leading-none font-black tracking-wider text-primary tabular-nums md:text-[7rem]"
          style={delay(0.28)}
        >
          {result.orderNo}
        </span>
      </div>
      <div className="kiosk-rise space-y-2" style={delay(0.3)}>
        <p className="flex items-center justify-center gap-2 text-xl font-semibold">
          <Volume2 className="size-6 text-primary" />
          음료가 준비되면 &ldquo;{callName}&rdquo;으로 불러드릴게요
        </p>
        <p className="text-lg text-muted-foreground">
          결제 {formatPoint(result.total)}
          {result.balanceAfter !== null && <> · 남은 포인트 {formatPoint(result.balanceAfter)}</>}
        </p>
      </div>
      <p className="mt-4 text-muted-foreground">{left}초 후 처음 화면으로 돌아가요 · 화면을 터치하면 바로 돌아가요</p>
    </button>
  );
}
