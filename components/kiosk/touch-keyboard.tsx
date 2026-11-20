"use client";

import { ArrowBigUp, Check, Delete, Space } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  onInput: (value: string) => void;
  onBackspace: () => void;
  onEnter?: () => void;
  targetLabel?: string;
  disabled?: boolean;
};

const letters = ["1234567890".split(""), "qwertyuiop".split(""), "asdfghjkl".split(""), "zxcvbnm".split("")];
const symbols = ["1234567890".split(""), ["-", "_", "/", ".", ":", "@", "#", "$", "%", "&"], ["!", "?", "+", "=", ",", ";", "*", "(", ")"], ["~", "'", '"', "|", "\\", "<", ">", "[", "]"]];
const quick = [".", "-", "_", "@", "/"];

export function TouchKeyboard({ onInput, onBackspace, onEnter, targetLabel = "입력", disabled }: Props) {
  const [shift, setShift] = useState(false);
  const [symbolMode, setSymbolMode] = useState(false);
  const rows = symbolMode ? symbols : letters;

  const tap = (value: string) => {
    onInput(shift && !symbolMode ? value.toUpperCase() : value);
    if (shift && !symbolMode) setShift(false);
  };

  return (
    <div className="select-none rounded-[2rem] border border-white/10 bg-slate-950 p-4 shadow-2xl shadow-slate-900/35">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-bold tracking-widest text-blue-300 uppercase">Touch Keyboard</p>
          <p className="text-sm font-semibold text-white/75">{targetLabel} 입력 중</p>
        </div>
        <div className="flex gap-2">
          {quick.map((key) => (
            <Key key={key} label={key} onClick={() => onInput(key)} disabled={disabled} compact />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={idx} className={cn("flex justify-center gap-2", idx === 2 && "px-6", idx === 3 && "px-14")}>
            {!symbolMode && idx === 3 && <Key label="Shift" icon={<ArrowBigUp className="size-5" />} onClick={() => setShift((v) => !v)} active={shift} disabled={disabled} wide />}
            {row.map((key) => (
              <Key key={key} label={shift && !symbolMode ? key.toUpperCase() : key} onClick={() => tap(key)} disabled={disabled} />
            ))}
            {idx === 3 && <Key label="삭제" icon={<Delete className="size-5" />} onClick={onBackspace} disabled={disabled} wide />}
          </div>
        ))}
        <div className="grid grid-cols-[1fr_2.5fr_1fr] gap-2 pt-1">
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
        compact ? "h-10 min-w-12 px-3 text-base" : "h-14 min-w-13 px-4 text-xl md:h-16 md:min-w-15",
        wide && "min-w-24 text-base",
        active && "bg-blue-500 text-white shadow-lg shadow-blue-500/30",
        action && "bg-blue-600 text-white shadow-lg shadow-blue-600/30",
        !active && !action && "bg-white text-slate-950 shadow-sm shadow-black/20 hover:bg-blue-50",
      )}
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
