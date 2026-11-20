"use client";

import { ArrowBigUp, Delete, Space, CornerDownLeft, Keyboard } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  onInput: (value: string) => void;
  onBackspace: () => void;
  onEnter?: () => void;
  disabled?: boolean;
};

const letters = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const symbols = ["1234567890", "-_/.:@#$%&", "!?+=,;*()"];

export function TouchKeyboard({ onInput, onBackspace, onEnter, disabled }: Props) {
  const [shift, setShift] = useState(false);
  const [symbolMode, setSymbolMode] = useState(false);
  const rows = symbolMode ? symbols : letters;

  const tap = (value: string) => {
    onInput(shift && !symbolMode ? value.toUpperCase() : value);
    if (shift && !symbolMode) setShift(false);
  };

  return (
    <div className="select-none rounded-3xl bg-slate-900 p-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-white/70">
        <Keyboard className="size-4" />
        터치 키보드
      </div>
      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={row} className="flex justify-center gap-2">
            {!symbolMode && idx === 2 && <Key label="Shift" icon={<ArrowBigUp className="size-5" />} onClick={() => setShift((v) => !v)} active={shift} disabled={disabled} wide />}
            {[...row].map((key) => (
              <Key key={key} label={shift && !symbolMode ? key.toUpperCase() : key} onClick={() => tap(key)} disabled={disabled} />
            ))}
            {idx === 2 && <Key label="삭제" icon={<Delete className="size-5" />} onClick={onBackspace} disabled={disabled} wide />}
          </div>
        ))}
        <div className="grid grid-cols-[1fr_2fr_1fr_1fr] gap-2">
          <Key label={symbolMode ? "ABC" : "123"} onClick={() => setSymbolMode((v) => !v)} disabled={disabled} />
          <Key label="공백" icon={<Space className="size-5" />} onClick={() => onInput(" ")} disabled={disabled} />
          <Key label="." onClick={() => onInput(".")} disabled={disabled} />
          <Key label="Enter" icon={<CornerDownLeft className="size-5" />} onClick={onEnter} disabled={disabled || !onEnter} />
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
}: {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      className={`${wide ? "min-w-20" : "min-w-12"} h-14 rounded-2xl text-lg font-bold ${active ? "bg-primary text-primary-foreground" : "bg-white text-slate-900 hover:bg-slate-100"}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="flex items-center justify-center gap-1">
        {icon}
        {icon && label.length > 2 ? <span className="text-sm">{label}</span> : label}
      </span>
    </Button>
  );
}
