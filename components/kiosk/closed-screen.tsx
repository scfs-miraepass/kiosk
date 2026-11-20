"use client";

import { Moon } from "lucide-react";
import { useLongPress } from "@/hooks/use-long-press";
import type { StoreStatus } from "@/lib/types";

export function ClosedScreen({ status, onLongPress }: { status: StoreStatus; onLongPress: () => void }) {
  // 영업시간 밖에도 관리자 모드에 들어갈 수 있도록 달 아이콘에 숨은 길게 누르기
  const longPress = useLongPress(onLongPress);
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-b from-slate-100 to-slate-200 px-6 text-center select-none">
      <div {...longPress} className="flex size-24 touch-none items-center justify-center rounded-full bg-white shadow-sm">
        <Moon className="size-12 text-slate-500" />
      </div>
      <div className="space-y-3">
        <h1 className="text-h6 font-bold md:text-h4">지금은 주문을 받지 않아요</h1>
        <p className="text-xl text-slate-600">{status.message}</p>
      </div>
      {status.nextOpenAt && (
        <p className="rounded-full bg-white px-6 py-3 text-lg font-semibold text-primary shadow-sm">
          다음 영업 · {status.nextOpenAt}
        </p>
      )}
      {status.todayHours && !status.todayHours.closed && (
        <p className="text-muted-foreground">
          오늘 영업시간 {status.todayHours.open} ~ {status.todayHours.close}
        </p>
      )}
    </div>
  );
}
