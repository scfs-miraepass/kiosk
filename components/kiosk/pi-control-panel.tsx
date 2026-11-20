"use client";

import { Laptop, Loader2, Power, RefreshCw, RotateCw, Wifi, X } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PI_CONTROL_URL = "http://127.0.0.1:8765";

type WifiNetwork = { ssid: string; security: string; signal: number };
type Health = { ok: boolean; hostname?: string; user?: string; version?: string };

type FocusTarget = "ssid" | "wifiPassword" | "wifiIdentity";

type Props = {
  onFocusTarget: (target: FocusTarget) => void;
  onClose: () => void;
};

async function localApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PI_CONTROL_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.message ?? "라즈베리파이 로컬 서비스에 연결할 수 없어요");
  return json.data as T;
}

export function PiControlPanel({ onFocusTarget, onClose }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const check = async () => {
    setHealthError(null);
    try {
      setHealth(await localApi<Health>("/health"));
    } catch (e) {
      setHealth(null);
      setHealthError(e instanceof Error ? e.message : "로컬 서비스에 연결할 수 없어요");
    }
  };

  useEffect(() => {
    let alive = true;
    localApi<Health>("/health")
      .then((data) => {
        if (!alive) return;
        setHealthError(null);
        setHealth(data);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setHealth(null);
        setHealthError(e instanceof Error ? e.message : "로컬 서비스에 연결할 수 없어요");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="w-full max-w-5xl rounded-3xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Laptop className="size-6 text-primary" /> 키오스크 관리자 모드
          </h2>
          <p className="text-sm text-muted-foreground">네트워크 설정과 전원 제어는 Pi의 로컬 서비스({PI_CONTROL_URL})가 처리합니다.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={check} className="h-11 rounded-xl">
            <RefreshCw className="mr-2 size-4" /> 확인
          </Button>
          <Button type="button" variant="default" onClick={onClose} className="h-11 rounded-xl">
            <X className="mr-2 size-4" /> 키오스크로 돌아가기
          </Button>
        </div>
      </div>

      {health ? (
        <p className="mb-4 rounded-2xl bg-green-50 p-3 text-sm font-semibold text-green-800">
          로컬 서비스 연결됨 {health.hostname ? `· ${health.hostname}` : ""} {health.version ? `· v${health.version}` : ""}
        </p>
      ) : (
        <p className="mb-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
          {healthError ?? "로컬 서비스 확인 중…"} 설치 스크립트 실행 후 키오스크를 다시 시작해 주세요.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-3xl border bg-slate-50 p-4">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-extrabold">
            <Wifi className="size-5 text-primary" /> 네트워크 설정
          </h3>
          <NetworkPanel disabled={!health} onFocusTarget={onFocusTarget} />
        </div>
        <SystemPanel disabled={!health} onClose={onClose} />
      </div>
    </section>
  );
}

function NetworkPanel({ disabled, onFocusTarget }: { disabled: boolean; onFocusTarget: (target: FocusTarget) => void }) {
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [ssid, setSsid] = useState("");
  const [securityMode, setSecurityMode] = useState<"personal" | "enterprise">("personal");
  const [wifiIdentity, setWifiIdentity] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useKioskTextInput("ssid", setSsid);
  useKioskTextInput("wifiIdentity", setWifiIdentity);
  useKioskTextInput("wifiPassword", setWifiPassword);

  const selectNetwork = (network: WifiNetwork) => {
    setSsid(network.ssid);
    if (/802\.1X|WPA-EAP|EAP/i.test(network.security)) setSecurityMode("enterprise");
  };

  const scan = async () => {
    setLoading(true);
    setMessage(null);
    try {
      setNetworks(await localApi<WifiNetwork[]>("/wifi/scan"));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Wi‑Fi 검색에 실패했어요");
    } finally {
      setLoading(false);
    }
  };

  const connect = async () => {
    if (!ssid.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      await localApi("/wifi/connect", {
        method: "POST",
        body: JSON.stringify({ ssid: ssid.trim(), securityMode, identity: wifiIdentity.trim(), password: wifiPassword }),
      });
      setMessage("연결 명령을 보냈어요. 잠시 뒤 네트워크가 바뀔 수 있어요.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Wi‑Fi 연결에 실패했어요");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input value={ssid} onChange={(e) => setSsid(e.target.value)} onFocus={() => onFocusTarget("ssid")} placeholder="Wi‑Fi 이름(SSID)" className="h-12 text-base" disabled={disabled || loading} />
        <Button type="button" variant="outline" onClick={scan} disabled={disabled || loading} className="h-12 rounded-xl">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} 검색
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-1">
        <ModeButton active={securityMode === "personal"} onClick={() => setSecurityMode("personal")} disabled={disabled || loading}>
          WPA-Personal
        </ModeButton>
        <ModeButton active={securityMode === "enterprise"} onClick={() => setSecurityMode("enterprise")} disabled={disabled || loading}>
          WPA-Enterprise
        </ModeButton>
      </div>
      {securityMode === "enterprise" && (
        <Input
          value={wifiIdentity}
          onChange={(e) => setWifiIdentity(e.target.value)}
          onFocus={() => onFocusTarget("wifiIdentity")}
          placeholder="Enterprise ID / 사용자 이름"
          className="h-12 text-base"
          disabled={disabled || loading}
        />
      )}
      <Input
        value={wifiPassword}
        onChange={(e) => setWifiPassword(e.target.value)}
        onFocus={() => onFocusTarget("wifiPassword")}
        placeholder={securityMode === "enterprise" ? "Enterprise 비밀번호" : "Wi‑Fi 비밀번호 (오픈 네트워크면 비워두세요)"}
        className="h-12 text-base"
        disabled={disabled || loading}
      />
      {networks.length > 0 && (
        <div className="max-h-48 space-y-2 overflow-auto rounded-2xl border p-2">
          {networks.map((n) => (
            <button key={`${n.ssid}-${n.security}`} type="button" onClick={() => selectNetwork(n)} className="flex w-full items-center justify-between rounded-xl bg-slate-50 p-3 text-left hover:bg-blue-50">
              <span className="font-semibold">{n.ssid}</span>
              <span className="text-sm text-muted-foreground">{n.signal}% · {n.security || "open"}</span>
            </button>
          ))}
        </div>
      )}
      {message && <p className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-700">{message}</p>}
      <Button type="button" onClick={connect} disabled={disabled || loading || !ssid.trim()} className="h-12 w-full rounded-xl text-base">
        Wi‑Fi 연결
      </Button>
    </div>
  );
}

function ModeButton({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant={active ? "default" : "ghost"} className="h-11 rounded-xl text-sm" onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

function SystemPanel({ disabled, onClose }: { disabled: boolean; onClose: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const power = async (action: "reboot" | "shutdown") => {
    const label = action === "reboot" ? "재부팅" : "종료";
    if (!window.confirm(`키오스크를 ${label}할까요?`)) return;
    setLoading(true);
    setMessage(null);
    try {
      await localApi(`/system/${action}`, { method: "POST", body: JSON.stringify({}) });
      setMessage(`${label} 명령을 보냈어요.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : `${label} 명령에 실패했어요`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border bg-slate-50 p-4">
      <h3 className="mb-4 text-lg font-extrabold">전원 / 화면</h3>
      <div className="space-y-3">
        <Button type="button" variant="outline" className="h-14 w-full justify-start rounded-2xl text-base" onClick={onClose}>
          <X className="mr-3 size-5" /> 키오스크로 돌아가기
        </Button>
        <Button type="button" variant="outline" className="h-14 w-full justify-start rounded-2xl text-base" onClick={() => void power("reboot")} disabled={disabled || loading}>
          <RotateCw className="mr-3 size-5" /> 재부팅
        </Button>
        <Button type="button" variant="destructive" className="h-14 w-full justify-start rounded-2xl text-base" onClick={() => void power("shutdown")} disabled={disabled || loading}>
          <Power className="mr-3 size-5" /> 종료
        </Button>
      </div>
      {message && <p className="mt-4 rounded-2xl bg-white p-3 text-sm text-slate-700">{message}</p>}
    </div>
  );
}

function useKioskTextInput(target: FocusTarget, setter: React.Dispatch<React.SetStateAction<string>>) {
  useEffect(() => {
    const onInput = (e: Event) => {
      const detail = (e as CustomEvent<{ target: FocusTarget; value?: string; backspace?: boolean }>).detail;
      if (!detail || detail.target !== target) return;
      setter((prev) => (detail.backspace ? prev.slice(0, -1) : `${prev}${detail.value ?? ""}`));
    };
    window.addEventListener("mp-cafe:kiosk-keyboard", onInput);
    return () => window.removeEventListener("mp-cafe:kiosk-keyboard", onInput);
  }, [setter, target]);
}

export type PiControlFocusTarget = FocusTarget;
