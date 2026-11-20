"use client";

import { ArrowBigUp, Check, Delete, GripHorizontal, Space, X } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  onInput: (value: string) => void;
  onBackspace: () => void;
  onEnter?: () => void;
  onClose?: () => void;
  targetLabel?: string;
  disabled?: boolean;
};

const letters = ["1234567890".split(""), "qwertyuiop".split(""), "asdfghjkl".split(""), "zxcvbnm".split("")];
const symbols = ["1234567890".split(""), ["-", "_", "/", ".", ":", "@", "#", "$", "%", "&"], ["!", "?", "+", "=", ",", ";", "*", "(", ")"], ["~", "'", '"', "|", "\\", "<", ">", "[", "]"]];
const quick = [".", "-", "_", "@", "/"];
const KEYBOARD_WIDTH = 720;
const KEYBOARD_HEIGHT = 300;

export function TouchKeyboard({ onInput, onBackspace, onEnter, onClose, targetLabel = "입력", disabled }: Props) {
  const [shift, setShift] = useState(false);
  const [symbolMode, setSymbolMode] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);
  const rows = symbolMode ? symbols : letters;

  const tap = (value: string) => {
    onInput(shift && !symbolMode ? value.toUpperCase() : value);
    if (shift && !symbolMode) setShift(false);
  };

  const current = position ?? {
    x: Math.max(16, typeof window === "undefined" ? 16 : window.innerWidth - KEYBOARD_WIDTH - 32),
    y: Math.max(16, typeof window === "undefined" ? 16 : window.innerHeight - KEYBOARD_HEIGHT - 32),
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { pointerId: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    const maxX = Math.max(8, window.innerWidth - KEYBOARD_WIDTH - 8);
    const maxY = Math.max(8, window.innerHeight - KEYBOARD_HEIGHT - 8);
    setPosition({
      x: Math.min(maxX, Math.max(8, e.clientX - drag.current.dx)),
      y: Math.min(maxY, Math.max(8, e.clientY - drag.current.dy)),
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  };

  return (
    <div
      className="fixed z-40 select-none rounded-[1.5rem] border border-white/10 bg-slate-950 p-3 shadow-2xl shadow-slate-900/35"
      style={{ left: current.x, top: current.y, width: KEYBOARD_WIDTH }}
    >
      <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl bg-white/8 px-3 py-2">
        <div
          className="flex flex-1 cursor-grab touch-none items-center justify-between gap-3 active:cursor-grabbing"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div>
            <p className="text-[10px] font-bold tracking-widest text-blue-300 uppercase">Touch Keyboard</p>
            <p className="text-xs font-semibold text-white/75">{targetLabel} 입력 중 · 위쪽 바를 잡고 이동</p>
          </div>
          <GripHorizontal className="size-6 text-white/45" />
        </div>
        <div className="flex gap-1.5">
          {quick.map((key) => (
            <Key key={key} label={key} onClick={() => onInput(key)} disabled={disabled} compact />
          ))}
          {onClose && <Key label="닫기" icon={<X className="size-4" />} onClick={onClose} disabled={disabled} compact />}
        </div>
      </div>
      <div className="space-y-1.5">
        {rows.map((row, idx) => (
          <div key={idx} className={cn("flex justify-center gap-1.5", idx === 2 && "px-5", idx === 3 && "px-10")}>
            {!symbolMode && idx === 3 && <Key label="Shift" icon={<ArrowBigUp className="size-5" />} onClick={() => setShift((v) => !v)} active={shift} disabled={disabled} wide />}
            {row.map((key) => (
              <Key key={key} label={shift && !symbolMode ? key.toUpperCase() : key} onClick={() => tap(key)} disabled={disabled} />
            ))}
            {idx === 3 && <Key label="삭제" icon={<Delete className="size-5" />} onClick={onBackspace} disabled={disabled} wide />}
          </div>
        ))}
        <div className="grid grid-cols-[1fr_2.5fr_1fr] gap-1.5 pt-1">
          <Key label={symbolMode ? "ABC" : "123"} onClick={() => setSymbolMode((v) => !v)} disabled={disabled} />
          <Key label="공백" icon={<Space className="size-5" />} onClick={() => onInput(" ")} disabled={disabled} />
          <Key label="완료" icon={<Check className="size-5" />} onClick={onEnter} disabled={disabled || !onEnter} action />
        </div>
      </div>
    </div>
  );
}

function Key({
  label,
  icon,
  onClick,
  active,
  disabled,
  wide,
  compact,
  action,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  wide?: boolean;
  compact?: boolean;
  action?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center justify-center rounded-2xl font-extrabold transition duration-100 active:scale-95 disabled:opacity-40",
        compact ? "h-9 min-w-10 px-2 text-sm" : "h-10 min-w-11 px-3 text-base md:h-11 md:min-w-12",
        wide && "min-w-20 text-sm",
        active && "bg-blue-500 text-white shadow-lg shadow-blue-500/30",
        action && "bg-blue-600 text-white shadow-lg shadow-blue-600/30",
        !active && !action && "bg-white text-slate-950 shadow-sm shadow-black/20 hover:bg-blue-50",
      )}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="flex items-center justify-center gap-1">
        {icon}
        {icon && label.length > 2 ? <span className="text-sm">{label}</span> : label}
      </span>
    </button>
  );
}
