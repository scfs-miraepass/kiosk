"use client";

import { Activity, ArrowLeft, Cable, KeyRound, Loader2, Monitor, Power, RefreshCw, Settings, Wifi } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIdleTimer } from "@/hooks/use-idle-timer";
import { cn } from "@/lib/utils";
import { AdminKeyboardProvider, Notice, StatusDot } from "./admin-ui";
import { PowerSection, TokenSection } from "./device-sections";
import { DisplaySection } from "./display-section";
import { errorMessage, type Health, localApi, type NetworkStatus } from "./local-api";
import { type AdminSection, EthernetSection, StatusSection, WifiSection } from "./network-sections";

/** 관리자 모드를 열어 두고 이 시간 동안 아무 입력이 없으면 키오스크로 돌아간다 */
const ADMIN_IDLE_SECONDS = 180;
/** 로컬 서비스에 연결되지 않았을 때 다시 확인하는 간격 */
const HEALTH_RETRY_MS = 5000;

const NAV: { id: AdminSection; label: string; icon: React.ReactNode }[] = [
  { id: "status", label: "상태", icon: <Activity className="size-6" /> },
  { id: "ethernet", label: "유선 LAN", icon: <Cable className="size-6" /> },
  { id: "wifi", label: "Wi‑Fi", icon: <Wifi className="size-6" /> },
  { id: "display", label: "화면", icon: <Monitor className="size-6" /> },
  { id: "token", label: "기기 토큰", icon: <KeyRound className="size-6" /> },
  { id: "power", label: "전원", icon: <Power className="size-6" /> },
];

type Props = {
  onClose: () => void;
  onTokenRegistered: (token: string) => void;
};

/**
 * 키오스크 관리자 모드 (전체 화면).
 * 키오스크 기기(라즈베리파이 등 리눅스)의 로컬 제어 서비스(127.0.0.1:8765)를 통해 네트워크·전원을 설정한다.
 * 화면 전체를 불투명하게 덮어서 뒤 키오스크 화면과 합성할 필요가 없게 했다 (Pi GPU 부담 최소화).
 */
export function KioskAdminPanel({ onClose, onTokenRegistered }: Props) {
  const [section, setSection] = useState<AdminSection>("status");
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthChecking, setHealthChecking] = useState(true);
  const [network, setNetwork] = useState<NetworkStatus | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useIdleTimer(ADMIN_IDLE_SECONDS, onClose);

  const checkHealth = useCallback(async () => {
    setHealthChecking(true);
    try {
      const data = await localApi<Health>("/health", { timeoutMs: 5000 });
      setHealth(data);
      setHealthError(null);
      return data;
    } catch (e) {
      setHealth(null);
      setHealthError(errorMessage(e, "로컬 서비스에 연결할 수 없어요"));
      return null;
    } finally {
      setHealthChecking(false);
    }
  }, []);

  const refreshNetwork = useCallback(async () => {
    setNetworkLoading(true);
    try {
      setNetwork(await localApi<NetworkStatus>("/network/status", { timeoutMs: 30_000 }));
      setNetworkError(null);
    } catch (e) {
      setNetworkError(errorMessage(e, "네트워크 상태를 확인하지 못했어요"));
    } finally {
      setNetworkLoading(false);
    }
  }, []);

  // 처음 열 때 서비스 확인 → 네트워크 상태 조회. 연결이 안 되면 주기적으로 다시 확인한다.
  const connected = health !== null;
  useEffect(() => {
    if (connected) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const data = await checkHealth();
      if (!alive) return;
      if (data) void refreshNetwork();
      else timer = setTimeout(tick, HEALTH_RETRY_MS);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [connected, checkHealth, refreshNetwork]);

  const navigate = (next: AdminSection) => {
    setSection(next);
    scrollRef.current?.scrollTo({ top: 0 });
    if (connected && (next === "status" || next === "ethernet" || next === "wifi")) void refreshNetwork();
  };

  const netProps = { network, networkLoading, refreshNetwork, disabled: !connected };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 text-slate-900 select-none">
      {/* 헤더 */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Settings className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold">키오스크 관리자 모드</h1>
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <StatusDot tone={connected ? "ok" : healthChecking ? "warn" : "off"} />
              <span className="truncate">
                {connected ? `로컬 서비스 연결됨 · ${health.hostname ?? ""}` : healthChecking ? "로컬 서비스 확인 중…" : "로컬 서비스 연결 안 됨"}
              </span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-slate-900 px-5 text-base font-bold text-white active:bg-slate-700"
        >
          <ArrowLeft className="size-5" /> 키오스크로 돌아가기
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 섹션 메뉴: 세로 화면은 위쪽 가로 탭, 가로 화면은 왼쪽 세로 메뉴 */}
        <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-slate-200 bg-white p-3 [scrollbar-width:none] lg:w-60 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-4">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
              className={cn(
                "flex h-14 shrink-0 items-center gap-3 rounded-2xl px-4 text-base font-bold lg:w-full lg:text-lg",
                section === item.id ? "bg-primary text-primary-foreground" : "text-slate-600 active:bg-slate-100",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* 본문 */}
        <AdminKeyboardProvider>
          {(keyboardOpen) => (
            <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className={cn("mx-auto w-full max-w-3xl space-y-4 p-4 lg:p-6", keyboardOpen && "pb-[360px]")}>
                {!connected && !healthChecking && section !== "token" && (
                  <div className="space-y-3">
                    <Notice tone="warning">
                      {healthError ?? "로컬 서비스에 연결할 수 없어요"}
                      <span className="mt-1 block text-sm font-medium">
                        키오스크 기기에서 <code className="rounded bg-amber-100 px-1">sudo systemctl status miraepass-kiosk-control</code> 로 서비스 상태를 확인해 주세요.
                        자동으로 다시 연결을 시도합니다.
                      </span>
                    </Notice>
                    <button
                      type="button"
                      onClick={() => void checkHealth().then((d) => d && refreshNetwork())}
                      className="flex h-12 items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white px-5 text-base font-bold active:bg-slate-100"
                    >
                      {healthChecking ? <Loader2 className="size-5 animate-spin" /> : <RefreshCw className="size-5" />} 지금 다시 연결
                    </button>
                  </div>
                )}
                {connected && networkError && (section === "status" || section === "ethernet" || section === "wifi") && <Notice tone="error">{networkError}</Notice>}

                {section === "status" && <StatusSection {...netProps} health={health} onNavigate={navigate} />}
                {section === "ethernet" && <EthernetSection {...netProps} />}
                {section === "wifi" && <WifiSection {...netProps} />}
                {section === "display" && <DisplaySection disabled={!connected} />}
                {section === "token" && <TokenSection onTokenRegistered={onTokenRegistered} />}
                {section === "power" && <PowerSection health={health} />}
              </div>
            </main>
          )}
        </AdminKeyboardProvider>
      </div>
    </div>
  );
}
