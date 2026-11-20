"use client";

import { KeyRound, Laptop, Loader2, Power, RefreshCw, RotateCw, X } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ClientApiError } from "@/lib/fetcher";

const PI_CONTROL_URL = "http://127.0.0.1:8765";

type WifiNetwork = { ssid: string; security: string; signal: number };
type Health = { ok: boolean; hostname?: string; user?: string; version?: string };

type FocusTarget = "adminToken" | "ssid" | "wifiPassword" | "wifiIdentity" | "ethernetAddress" | "ethernetGateway" | "ethernetDns";

type Props = {
  onFocusTarget: (target: FocusTarget) => void;
  onInputBlur: () => void;
  onClose: () => void;
  onTokenRegistered?: (token: string) => void;
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

export function PiControlPanel({ onFocusTarget, onInputBlur, onClose, onTokenRegistered }: Props) {
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
          <p className="text-sm text-muted-foreground">토큰, 유선 LAN, 무선 Wi‑Fi, 전원 제어를 설정합니다.</p>
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]">
        <div className="space-y-4 xl:col-span-2">
          {onTokenRegistered && (
            <TokenResetPanel onFocusTarget={onFocusTarget} onInputBlur={onInputBlur} onTokenRegistered={onTokenRegistered} />
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <EthernetPanel disabled={!health} onFocusTarget={onFocusTarget} onInputBlur={onInputBlur} />
            <WifiPanel disabled={!health} onFocusTarget={onFocusTarget} onInputBlur={onInputBlur} />
          </div>
        </div>
        <SystemPanel disabled={!health} onClose={onClose} />
      </div>
    </section>
  );
}

function TokenResetPanel({
  onFocusTarget,
  onInputBlur,
  onTokenRegistered,
}: {
  onFocusTarget: (target: FocusTarget) => void;
  onInputBlur: () => void;
  onTokenRegistered: (token: string) => void;
}) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useKioskTextInput("adminToken", setToken);

  const submit = async () => {
    const next = token.trim();
    if (!next) return;
    setLoading(true);
    setMessage(null);
    try {
      await api("/api/kiosk/verify", { method: "POST", kiosk: next });
      onTokenRegistered(next);
      setMessage("키오스크 토큰을 변경했어요.");
      setToken("");
    } catch (err) {
      setMessage(
        err instanceof ClientApiError && err.code === "KIOSK_UNREGISTERED"
          ? "토큰이 맞지 않아요. 관리자 › 설정의 기기 토큰을 확인해 주세요"
          : err instanceof ClientApiError
            ? err.message
            : "토큰 확인에 실패했어요",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border bg-slate-50 p-4">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-extrabold">
        <KeyRound className="size-5 text-primary" /> 키오스크 토큰 재설정
      </h3>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onFocus={() => onFocusTarget("adminToken")}
          onBlur={onInputBlur}
          placeholder="새 키오스크 토큰"
          className="h-12 text-base"
          disabled={loading}
        />
        <Button type="button" onClick={() => void submit()} disabled={!token.trim() || loading} className="h-12 rounded-xl">
          {loading ? <Loader2 className="size-4 animate-spin" /> : "변경"}
        </Button>
      </div>
      {message && <p className="mt-3 rounded-2xl bg-white p-3 text-sm text-slate-700">{message}</p>}
    </div>
  );
}

type EthernetStatus = { device: string | null; connection: string | null; state: string; addresses: string; routes: string };

function EthernetPanel({
  disabled,
  onFocusTarget,
  onInputBlur,
}: {
  disabled: boolean;
  onFocusTarget: (target: FocusTarget) => void;
  onInputBlur: () => void;
}) {
  const [mode, setMode] = useState<"dhcp" | "static">("dhcp");
  const [address, setAddress] = useState("");
  const [gateway, setGateway] = useState("");
  const [dns, setDns] = useState("");
  const [status, setStatus] = useState<EthernetStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useKioskTextInput("ethernetAddress", setAddress);
  useKioskTextInput("ethernetGateway", setGateway);
  useKioskTextInput("ethernetDns", setDns);

  const refresh = async () => {
    setLoading(true);
    setMessage(null);
    try {
      setStatus(await localApi<EthernetStatus>("/ethernet/status"));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "유선 네트워크 상태를 확인하지 못했어요");
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await localApi("/ethernet/config", { method: "POST", body: JSON.stringify({ mode, address: address.trim(), gateway: gateway.trim(), dns: dns.trim() }) });
      setMessage("유선 네트워크 설정을 적용했어요.");
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "유선 네트워크 설정에 실패했어요");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-3xl border bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-extrabold">유선 LAN</h3>
          <p className="text-xs text-muted-foreground">이더넷 케이블 연결 설정</p>
        </div>
        <Button type="button" variant="outline" onClick={refresh} disabled={disabled || loading} className="h-10 rounded-xl">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} 상태
        </Button>
      </div>
      {status && (
        <p className="rounded-2xl bg-white p-3 text-xs text-slate-700">
          장치: {status.device ?? "없음"} · 연결: {status.connection ?? "없음"} · 상태: {status.state}
          {status.addresses && <span className="block whitespace-pre-wrap">{status.addresses}</span>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-1">
        <ModeButton active={mode === "dhcp"} onClick={() => setMode("dhcp")} disabled={disabled || loading}>
          DHCP 자동
        </ModeButton>
        <ModeButton active={mode === "static"} onClick={() => setMode("static")} disabled={disabled || loading}>
          고정 IP
        </ModeButton>
      </div>
      {mode === "static" && (
        <div className="space-y-2">
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={() => onFocusTarget("ethernetAddress")}
            onBlur={onInputBlur}
            placeholder="IP/CIDR 예: 192.168.0.50/24"
            className="h-12 text-base"
            disabled={disabled || loading}
          />
          <Input
            value={gateway}
            onChange={(e) => setGateway(e.target.value)}
            onFocus={() => onFocusTarget("ethernetGateway")}
            onBlur={onInputBlur}
            placeholder="게이트웨이 예: 192.168.0.1"
            className="h-12 text-base"
            disabled={disabled || loading}
          />
          <Input
            value={dns}
            onChange={(e) => setDns(e.target.value)}
            onFocus={() => onFocusTarget("ethernetDns")}
            onBlur={onInputBlur}
            placeholder="DNS 예: 8.8.8.8,1.1.1.1"
            className="h-12 text-base"
            disabled={disabled || loading}
          />
        </div>
      )}
      {message && <p className="rounded-2xl bg-white p-3 text-sm text-slate-700">{message}</p>}
      <Button type="button" onClick={apply} disabled={disabled || loading || (mode === "static" && !address.trim())} className="h-12 w-full rounded-xl text-base">
        유선 설정 적용
      </Button>
    </div>
  );
}

function WifiPanel({
  disabled,
  onFocusTarget,
  onInputBlur,
}: {
  disabled: boolean;
  onFocusTarget: (target: FocusTarget) => void;
  onInputBlur: () => void;
}) {
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
    <div className="space-y-4 rounded-3xl border bg-slate-50 p-4">
      <div>
        <h3 className="text-lg font-extrabold">무선 Wi‑Fi</h3>
        <p className="text-xs text-muted-foreground">WPA-Personal / WPA-Enterprise 연결</p>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input
          value={ssid}
          onChange={(e) => setSsid(e.target.value)}
          onFocus={() => onFocusTarget("ssid")}
          onBlur={onInputBlur}
          placeholder="Wi‑Fi 이름(SSID)"
          className="h-12 text-base"
          disabled={disabled || loading}
        />
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
          onBlur={onInputBlur}
          placeholder="Enterprise ID / 사용자 이름"
          className="h-12 text-base"
          disabled={disabled || loading}
        />
      )}
      <Input
        value={wifiPassword}
        onChange={(e) => setWifiPassword(e.target.value)}
        onFocus={() => onFocusTarget("wifiPassword")}
        onBlur={onInputBlur}
        placeholder={securityMode === "enterprise" ? "Enterprise 비밀번호" : "Wi‑Fi 비밀번호 (오픈 네트워크면 비워두세요)"}
        className="h-12 text-base"
        disabled={disabled || loading}
      />
      {networks.length > 0 && (
        <div className="max-h-48 space-y-2 overflow-auto rounded-2xl border bg-white p-2">
          {networks.map((n) => (
            <button key={`${n.ssid}-${n.security}`} type="button" onClick={() => selectNetwork(n)} className="flex w-full items-center justify-between rounded-xl bg-slate-50 p-3 text-left hover:bg-blue-50">
              <span className="font-semibold">{n.ssid}</span>
              <span className="text-sm text-muted-foreground">{n.signal}% · {n.security || "open"}</span>
            </button>
          ))}
        </div>
      )}
      {message && <p className="rounded-2xl bg-white p-3 text-sm text-slate-700">{message}</p>}
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
