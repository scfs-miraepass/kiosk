"use client";

import { memo } from "react";
import { formatPoint } from "@/lib/format";
import type { MenuItemDTO } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MenuThumb } from "./menu-thumb";

/**
 * 메뉴 카드.
 *
 * 성능 메모 (라즈베리파이 4B):
 * - 예전 MagicCard는 카드마다 포인터 위치를 따라 radial-gradient를 JS로 다시 그리고(window 리스너 3개씩),
 *   BEST 카드의 BorderBeam은 offset-distance를 JS(rAF)로 매 프레임 바꿔서 메뉴 화면 전체가 계속 repaint됐다.
 *   옵션 창의 배경 흐림과 겹치면 흐림까지 매 프레임 다시 계산돼 크게 끊겼다.
 * - 지금은 정적인 카드 + 테두리 강조만 쓴다. 눌림 효과는 transform(scale)이라 GPU 합성만 일어난다.
 * - 장바구니가 바뀌어도 카드가 다시 렌더링되지 않도록 memo + 안정적인 onSelect(item, emoji)를 받는다.
 */
export const MenuCard = memo(function MenuCard({
  item,
  emoji,
  onSelect,
}: {
  item: MenuItemDTO;
  emoji: string;
  onSelect: (item: MenuItemDTO, emoji: string) => void;
}) {
  const soldOut = item.isSoldOut;
  const best = item.badge === "BEST" && !soldOut;
  return (
    <button
      onClick={() => onSelect(item, emoji)}
      disabled={soldOut}
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-3xl bg-card text-left shadow-sm transition-transform duration-100 active:scale-[0.97] disabled:active:scale-100",
        best ? "ring-2 ring-primary/70" : "ring-1 ring-slate-200/70",
      )}
    >
      <div className={cn("flex h-full flex-col", soldOut && "opacity-45 grayscale")}>
        <MenuThumb imageUrl={item.imageUrl} emoji={emoji} name={item.name} className="aspect-[4/3] w-full" />
        <div className="flex flex-1 flex-col gap-1 p-3 md:p-4">
          <p className="line-clamp-2 text-lg leading-snug font-bold md:text-xl">{item.name}</p>
          <p className="mt-auto text-lg font-bold text-primary md:text-xl">{formatPoint(item.price)}</p>
        </div>
      </div>
      {item.badge && !soldOut && (
        <span
          className={cn(
            "absolute top-3 left-3 rounded-full px-2.5 py-1 text-xs font-bold text-white shadow",
            item.badge === "BEST" ? "bg-primary" : "bg-amber-500",
          )}
        >
          {item.badge}
        </span>
      )}
      {soldOut && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-slate-900/80 px-5 py-2 text-lg font-bold text-white">품절</span>
        </span>
      )}
    </button>
  );
});
