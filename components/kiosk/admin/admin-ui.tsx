"use client";

import { Eye, EyeOff } from "lucide-react";
import type React from "react";
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TouchKeyboard } from "../touch-keyboard";

/*
 * 관리자 모드 공통 UI.
 * 라즈베리파이 4B(VideoCore VI) + Chromium에서 부드럽게 돌도록
 * 흐림(backdrop-filter)·큰 그림자·전환 애니메이션 없이 단색 면과 테두리만 쓴다.
 * 터치 대상은 최소 48px 이상으로 둔다.
 */

// ───────────────────────── 터치 키보드 ─────────────────────────

type ActiveField = {
  id: string;
  label: string;
  el: HTMLInputElement;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  onEnter?: () => void;
};

type KeyboardCtx = {
  activate: (field: ActiveField) => void;
  release: (id: string) => void;
};

const AdminKeyboardContext = createContext<KeyboardCtx | null>(null);

/**
 * 관리자 화면의 입력칸과 플로팅 터치 키보드를 잇는다.
 * 입력칸이 포커스를 얻으면 키보드가 열리고, 다른 곳을 누르면 닫힌다.
 * render prop의 keyboardOpen으로 본문 아래 여백을 늘려 키보드가 입력칸을 가리지 않게 한다.
 */
export function AdminKeyboardProvider({ children }: { children: (keyboardOpen: boolean) => React.ReactNode }) {
  const [active, setActive] = useState<ActiveField | null>(null);
  const activeRef = useRef<ActiveField | null>(null);

  const activate = useCallback((field: ActiveField) => {
    activeRef.current = field;
    setActive(field);
  }, []);

  const release = useCallback((id: string) => {
    // 키를 누르는 순간 잠깐 포커스가 빠질 수 있어 조금 기다렸다가 판단한다.
    window.setTimeout(() => {
      const current = activeRef.current;
      if (!current || current.id !== id) return; // 이미 다른 입력칸으로 옮겨감
      const focused = document.activeElement;
      if (focused instanceof Element && focused.closest("[data-touch-keyboard]")) {
        current.el.focus({ preventScroll: true });
        return;
      }
      if (focused === current.el) return;
      activeRef.current = null;
      setActive(null);
    }, 120);
  }, []);

  const close = useCallback(() => {
    const current = activeRef.current;
    activeRef.current = null;
    setActive(null);
    current?.el.blur();
  }, []);

  const ctx = useMemo(() => ({ activate, release }), [activate, release]);

  return (
    <AdminKeyboardContext.Provider value={ctx}>
      {children(active !== null)}
      {active && (
        <TouchKeyboard
          onInput={(text) => activeRef.current?.setValue((prev) => `${prev}${text}`)}
          onBackspace={() => activeRef.current?.setValue((prev) => prev.slice(0, -1))}
          onEnter={() => {
            const onEnter = activeRef.current?.onEnter;
            close();
            onEnter?.();
          }}
          onClose={close}
          targetLabel={active.label}
        />
      )}
    </AdminKeyboardContext.Provider>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: React.Dispatch<React.SetStateAction<string>>;
  placeholder?: string;
  hint?: React.ReactNode;
  disabled?: boolean;
  /** 비밀번호처럼 가려서 표시 (눈 버튼으로 보기 전환) */
  secret?: boolean;
  /** 터치 키보드의 완료 키를 누르면 호출 */
  onEnter?: () => void;
};

/**
 * 라벨 + 큰 입력칸. 터치 키보드와 자동으로 연결된다.
 *
 * secret 입력칸은 type="password" 대신 -webkit-text-security로 가린다.
 * Chromium은 password 입력칸이 사라지면 "비밀번호를 저장할까요?" 말풍선을 띄우는데,
 * 키오스크 모드에서는 이 말풍선을 닫기 번거롭기 때문.
 */
export function AdminField({ label, value, onChange, placeholder, hint, disabled, secret, onEnter }: FieldProps) {
  const id = useId();
  const keyboard = useContext(AdminKeyboardContext);
  const [reveal, setReveal] = useState(false);
  const masked = secret && !reveal;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-bold text-slate-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            const el = e.currentTarget;
            keyboard?.activate({ id, label, el, setValue: onChange, onEnter });
            // 키보드 여백이 생긴 뒤에 입력칸을 화면 가운데로
            requestAnimationFrame(() => requestAnimationFrame(() => el.scrollIntoView({ block: "center" })));
          }}
          onBlur={() => keyboard?.release(id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
              onEnter?.();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          type="text"
          inputMode="none"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={cn(
            "h-14 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 text-lg text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary disabled:bg-slate-100 disabled:text-slate-400",
            secret && "pr-16",
            masked && "[-webkit-text-security:disc]",
          )}
        />
        {secret && (
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setReveal((v) => !v)}
            className="absolute inset-y-1 right-1 flex w-14 items-center justify-center rounded-xl text-slate-500 active:bg-slate-100"
            aria-label={reveal ? "가리기" : "보기"}
          >
            {reveal ? <EyeOff className="size-6" /> : <Eye className="size-6" />}
          </button>
        )}
      </div>
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

// ───────────────────────── 레이아웃 조각 ─────────────────────────

export function SectionHeader({ icon, title, description, action }: { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">{icon}</div>
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Card({ title, action, children, className }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-3xl border border-slate-200 bg-white p-5", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="text-lg font-extrabold text-slate-900">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function InfoGrid({ rows }: { rows: [label: string, value: React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-base">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-500">{label}</dt>
          <dd className="min-w-0 font-semibold break-all text-slate-900">{value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1.5 rounded-2xl bg-slate-100 p-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={cn(
            "h-12 rounded-xl text-base font-bold disabled:opacity-50",
            value === opt.value ? "bg-white text-primary ring-2 ring-primary" : "text-slate-600 active:bg-slate-200",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const NOTICE_TONE = {
  info: "bg-blue-50 text-blue-900",
  success: "bg-green-50 text-green-900",
  warning: "bg-amber-50 text-amber-900",
  error: "bg-red-50 text-red-800",
} as const;

export type NoticeTone = keyof typeof NOTICE_TONE;
export type NoticeState = { tone: NoticeTone; text: string } | null;

export function Notice({ tone, children, className }: { tone: NoticeTone; children: React.ReactNode; className?: string }) {
  return <p className={cn("rounded-2xl p-4 text-base font-semibold break-words", NOTICE_TONE[tone], className)}>{children}</p>;
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "off" }) {
  return <span className={cn("inline-block size-3 shrink-0 rounded-full", tone === "ok" ? "bg-green-500" : tone === "warn" ? "bg-amber-500" : "bg-slate-300")} />;
}

/** 큰 기본 동작 버튼 (터치용 56px) */
export function BigButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline" | "danger";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-14 items-center justify-center gap-2 rounded-2xl px-5 text-lg font-bold disabled:opacity-40",
        variant === "primary" && "bg-primary text-primary-foreground active:brightness-90",
        variant === "outline" && "border-2 border-slate-200 bg-white text-slate-800 active:bg-slate-100",
        variant === "danger" && "bg-red-600 text-white active:bg-red-700",
        className,
      )}
    >
      {children}
    </button>
  );
}
