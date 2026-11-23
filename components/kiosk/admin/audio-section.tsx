"use client";

import { Headphones, Loader2, Minus, Monitor, Play, Plus, RefreshCw, Sparkles, Speaker, Usb, Volume2, VolumeX } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BigButton, Card, Notice, type NoticeState, SectionHeader, StatusDot } from "./admin-ui";
import { type AudioOutput, type AudioStatus, errorMessage, localApi } from "./local-api";

const AUTO = "auto";
const VOLUME_STEP = 10;
/** 볼륨 막대를 움직이는 동안은 마지막 값만 보낸다 */
const VOLUME_SAVE_DELAY_MS = 350;

const KIND_ICON: Record<AudioOutput["kind"], React.ReactNode> = {
  hdmi: <Monitor className="size-6" />,
  headphones: <Headphones className="size-6" />,
  usb: <Usb className="size-6" />,
  other: <Speaker className="size-6" />,
};

/** 키오스크 화면(Chromium)에서 직접 '삐-삐'를 낸다. 실제 주문 화면과 같은 경로(출력·볼륨)로 나오는지 확인하는 용도. */
async function playBrowserBeep() {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error("이 브라우저는 소리 재생을 지원하지 않아요");
  const ctx = new AudioCtx();
  try {
    await ctx.resume();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const t = ctx.currentTime + 0.05;
    for (const [freq, start, length] of [
      [880, 0, 0.25],
      [1320, 0.37, 0.35],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.connect(gain);
      // 앞뒤를 부드럽게 올리고 내려 '딱' 소리를 없앤다
      gain.gain.setValueAtTime(0, t + start);
      gain.gain.linearRampToValueAtTime(0.5, t + start + 0.01);
      gain.gain.setValueAtTime(0.5, t + start + length - 0.01);
      gain.gain.linearRampToValueAtTime(0, t + start + length);
      osc.start(t + start);
      osc.stop(t + start + length);
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  } finally {
    void ctx.close();
  }
}

/**
 * 소리 설정: 출력 장치(HDMI 모니터 스피커·이어폰 잭·USB)와 볼륨.
 * 로컬 서비스가 ALSA 장치(miraepass = 고른 출력 + 소프트웨어 볼륨)를 만들고, Chromium은 그 장치로 소리를 낸다.
 * 볼륨은 바로 적용되고, 출력 장치를 바꾸면 Chromium이 새 설정을 읽도록 키오스크 화면이 다시 시작된다.
 */
export function AudioSection({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback((next: AudioStatus) => {
    setStatus(next);
    setVolume(next.volume);
  }, []);

  const load = useCallback(async () => {
    setBusy("load");
    try {
      update(await localApi<AudioStatus>("/audio/status"));
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "소리 설정을 불러오지 못했어요") });
    } finally {
      setBusy(null);
    }
  }, [update]);

  useEffect(() => {
    if (disabled) return;
    let alive = true;
    localApi<AudioStatus>("/audio/status")
      .then((next) => alive && update(next))
      .catch((e: unknown) => alive && setNotice({ tone: "error", text: errorMessage(e, "소리 설정을 불러오지 못했어요") }));
    return () => {
      alive = false;
    };
  }, [disabled, update]);

  useEffect(() => () => void (saveTimer.current && clearTimeout(saveTimer.current)), []);

  const saveVolume = useCallback((next: number) => {
    setVolume(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await localApi<AudioStatus>("/audio/volume", { method: "POST", body: JSON.stringify({ volume: next }) });
        setStatus(res);
        setNotice(res.applied === false ? { tone: "warning", text: "볼륨을 저장했어요. 소리 장치가 준비되면(다음 재생·재부팅 때) 적용돼요." } : null);
      } catch (e) {
        setNotice({ tone: "error", text: errorMessage(e, "볼륨을 바꾸지 못했어요") });
      }
    }, VOLUME_SAVE_DELAY_MS);
  }, []);

  const testDevice = async (output: string) => {
    setBusy(`test:${output}`);
    setNotice(null);
    try {
      await localApi("/audio/test", { method: "POST", body: JSON.stringify({ output }), timeoutMs: 20_000 });
      setNotice({ tone: "info", text: "테스트음을 냈어요. ‘삐-삐’ 소리가 들렸는지 확인해 주세요." });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "테스트음을 재생하지 못했어요") });
    } finally {
      setBusy(null);
    }
  };

  const testScreen = async () => {
    setBusy("screen");
    setNotice(null);
    try {
      await playBrowserBeep();
      setNotice({ tone: "info", text: "키오스크 화면에서 소리를 냈어요. 주문 화면의 소리도 같은 스피커·볼륨으로 나와요." });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "소리를 재생하지 못했어요") });
    } finally {
      setBusy(null);
    }
  };

  const applyOutput = async (output: string) => {
    setBusy("output");
    setNotice(null);
    try {
      const next = await localApi<AudioStatus>("/audio/output", { method: "POST", body: JSON.stringify({ output }), timeoutMs: 30_000 });
      update(next);
      setConfirm(null);
      if (next.restarting) setRestarting(true);
      else setNotice({ tone: "success", text: "출력 장치를 저장했어요. 지금 쓰는 장치와 같아서 바로 적용돼 있어요." });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "출력 장치를 바꾸지 못했어요") });
    } finally {
      setBusy(null);
    }
  };

  const outputs = status?.outputs ?? [];
  const activeLabel = outputs.find((o) => o.id === status?.active)?.label;
  const locked = disabled || busy !== null || restarting || !status;
  const confirmLabel = confirm === AUTO ? "자동 (HDMI 우선)" : outputs.find((o) => o.id === confirm)?.label;

  return (
    <>
      <SectionHeader
        icon={<Volume2 className="size-6" />}
        title="소리"
        description="소리가 나올 스피커(HDMI 모니터·이어폰 잭·USB)와 볼륨을 정합니다."
        action={
          <button
            type="button"
            onClick={() => void load()}
            disabled={disabled || busy !== null}
            className="flex h-12 items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white px-4 text-base font-bold active:bg-slate-100 disabled:opacity-50"
          >
            {busy === "load" ? <Loader2 className="size-5 animate-spin" /> : <RefreshCw className="size-5" />} 새로 고침
          </button>
        }
      />
      <div className="space-y-4">
        {status && !status.available && (
          <Notice tone="warning">소리 도구(alsa-utils)가 설치돼 있지 않아 볼륨 조절과 테스트음을 쓸 수 없어요. 업데이트를 적용하거나 설치 스크립트를 다시 실행해 주세요.</Notice>
        )}
        {status?.soundServer && (
          <Notice tone="warning">
            사운드 서버({status.soundServer})가 동작 중이에요. Chromium이 그쪽으로 소리를 내면 여기 설정이 적용되지 않을 수 있어요.
          </Notice>
        )}
        {status && outputs.length === 0 && (
          <Notice tone="warning">
            소리 장치를 찾지 못했어요. HDMI 모니터를 켜 둔 상태로 기기를 재부팅해 보세요. 모니터를 나중에 연결하면 HDMI 소리 장치가 생기지 않을 수 있어요.
          </Notice>
        )}
        {status?.missing && <Notice tone="warning">저장한 출력 장치({status.output})가 연결돼 있지 않아 {activeLabel ?? "다른 장치"}로 소리를 내고 있어요.</Notice>}

        <Card title="볼륨">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="볼륨 낮추기"
                disabled={locked || volume === null || volume <= 0}
                onClick={() => volume !== null && saveVolume(Math.max(0, volume - VOLUME_STEP))}
                className="flex size-14 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-200 bg-white active:bg-slate-100 disabled:opacity-40"
              >
                <Minus className="size-6" />
              </button>
              <div className="flex min-w-0 flex-1 flex-col items-center">
                <span className="flex items-center gap-2 text-4xl font-extrabold text-slate-900 tabular-nums">
                  {volume === 0 ? <VolumeX className="size-8 text-slate-400" /> : <Volume2 className="size-8 text-primary" />}
                  {volume ?? "–"}
                  <span className="text-xl text-slate-400">%</span>
                </span>
              </div>
              <button
                type="button"
                aria-label="볼륨 높이기"
                disabled={locked || volume === null || volume >= 100}
                onClick={() => volume !== null && saveVolume(Math.min(100, volume + VOLUME_STEP))}
                className="flex size-14 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-200 bg-white active:bg-slate-100 disabled:opacity-40"
              >
                <Plus className="size-6" />
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={volume ?? 0}
              disabled={locked || volume === null}
              onChange={(e) => saveVolume(Number(e.target.value))}
              aria-label="볼륨"
              className="h-10 w-full cursor-pointer accent-primary disabled:opacity-40"
            />
            <div className="grid grid-cols-2 gap-3">
              <BigButton variant="outline" onClick={() => void testScreen()} disabled={disabled || busy !== null || restarting}>
                {busy === "screen" ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5" />} 화면에서 재생
              </BigButton>
              <BigButton
                variant="outline"
                onClick={() => status?.active && void testDevice(status.active)}
                disabled={locked || !status?.available || !status?.active}
              >
                {busy === `test:${status?.active}` ? <Loader2 className="size-5 animate-spin" /> : <Speaker className="size-5" />} 기기 테스트음
              </BigButton>
            </div>
            <p className="text-sm text-slate-500">
              볼륨은 바로 적용돼요. ‘화면에서 재생’은 주문 화면과 같은 경로로 소리를 내고, ‘기기 테스트음’은 기기가 스피커로 직접 소리를 내요.
            </p>
          </div>
        </Card>

        <Card title="출력 장치">
          <div className="space-y-3">
            <OutputRow
              icon={<Sparkles className="size-6" />}
              label="자동 (HDMI 우선)"
              detail={status?.output === AUTO && activeLabel ? `지금: ${activeLabel}` : "모니터가 연결된 HDMI를 부팅할 때마다 골라요"}
              selected={status?.output === AUTO}
              disabled={locked}
              onSelect={() => setConfirm(AUTO)}
            />
            {outputs.map((o) => (
              <OutputRow
                key={o.id}
                icon={KIND_ICON[o.kind]}
                label={o.label}
                detail={
                  <span className="flex items-center gap-2">
                    {o.kind === "hdmi" && o.connected !== null && (
                      <>
                        <StatusDot tone={o.connected ? "ok" : "off"} />
                        {o.connected ? "모니터 연결됨" : "모니터 없음"} ·
                      </>
                    )}
                    <span className="font-mono">{o.id}</span>
                    {status?.active === o.id && <span className="font-bold text-primary">· 사용 중</span>}
                  </span>
                }
                selected={status?.output === o.id}
                disabled={locked}
                onSelect={() => setConfirm(o.id)}
                onTest={status?.available ? () => void testDevice(o.id) : undefined}
                testing={busy === `test:${o.id}`}
              />
            ))}
          </div>
          {confirm !== null && confirm !== status?.output ? (
            <div className="mt-4 space-y-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4">
              <p className="text-base font-bold text-amber-900">
                소리 출력을 ‘{confirmLabel}’(으)로 바꿀까요? 출력 장치가 바뀌면 키오스크 화면이 다시 시작되고 관리자 모드가 닫혀요.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <BigButton variant="outline" onClick={() => setConfirm(null)} disabled={busy !== null}>
                  취소
                </BigButton>
                <BigButton onClick={() => void applyOutput(confirm)} disabled={busy !== null}>
                  {busy === "output" && <Loader2 className="size-5 animate-spin" />} 적용
                </BigButton>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              바꾸기 전에 ‘테스트’로 어느 장치에서 소리가 나는지 확인해 보세요. 라즈베리파이 4는 모니터를 꽂은 포트(HDMI 0 / HDMI 1)를 골라야 해요.
            </p>
          )}
        </Card>

        {restarting && (
          <Notice tone="info">
            <Loader2 className="mr-2 inline size-5 animate-spin" />
            키오스크 화면을 다시 시작하는 중이에요… 잠시 뒤 새 출력 장치로 소리가 나요.
          </Notice>
        )}
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      </div>
    </>
  );
}

function OutputRow({
  icon,
  label,
  detail,
  selected,
  disabled,
  onSelect,
  onTest,
  testing,
}: {
  icon: React.ReactNode;
  label: string;
  detail: React.ReactNode;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onTest?: () => void;
  testing?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border-2 p-3", selected ? "border-primary bg-primary/5" : "border-slate-200 bg-white")}>
      <button type="button" onClick={onSelect} disabled={disabled || selected} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default">
        <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl", selected ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-600")}>
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-lg font-extrabold text-slate-900">{label}</span>
          <span className="block text-sm text-slate-500">{detail}</span>
        </span>
      </button>
      {selected && <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">선택됨</span>}
      {onTest && (
        <button
          type="button"
          onClick={onTest}
          disabled={disabled}
          className="flex h-12 shrink-0 items-center gap-1.5 rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-bold active:bg-slate-100 disabled:opacity-40"
        >
          {testing ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5" />} 테스트
        </button>
      )}
    </div>
  );
}
