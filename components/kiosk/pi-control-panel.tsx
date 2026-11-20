"use client";

import { Laptop, Loader2, RefreshCw, Terminal, Wifi } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PI_CONTROL_URL = "http://127.0.0.1:8765";

type WifiNetwork = { ssid: string; security: string; signal: number };
type Health = { ok: boolean; hostname?: string; user?: string; version?: string };

type FocusTarget = "ssid" | "wifiPassword" | "command";

type Props = {
  onFocusTarget: (target: FocusTarget) => void;
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

export function PiControlPanel({ onFocusTarget }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [tab, setTab] = useState<"network" | "terminal">("network");

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
    <section className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Laptop className="size-6 text-primary" /> 라즈베리파이 설정
          </h2>
          <p className="text-sm text-muted-foreground">네트워크와 터미널은 Pi의 로컬 서비스({PI_CONTROL_URL})가 처리합니다.</p>
        </div>
        <Button type="button" variant="outline" onClick={check} className="h-11 rounded-xl">
          <RefreshCw className="mr-2 size-4" /> 확인
        </Button>
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

      <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
        <TabButton active={tab === "network"} onClick={() => setTab("network")} icon={<Wifi className="size-4" />}>
          네트워크
        </TabButton>
        <TabButton active={tab === "terminal"} onClick={() => setTab("terminal")} icon={<Terminal className="size-4" />}>
          터미널
        </TabButton>
      </div>

      {tab === "network" ? <NetworkPanel disabled={!health} onFocusTarget={onFocusTarget} /> : <TerminalPanel disabled={!health} onFocusTarget={onFocusTarget} />}
    </section>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Button type="button" variant={active ? "default" : "ghost"} className="h-12 rounded-xl text-base" onClick={onClick}>
      {icon}
      <span className="ml-2">{children}</span>
    </Button>
  );
}

function NetworkPanel({ disabled, onFocusTarget }: { disabled: boolean; onFocusTarget: (target: FocusTarget) => void }) {
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [ssid, setSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useKioskTextInput("ssid", setSsid);
  useKioskTextInput("wifiPassword", setWifiPassword);

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
      await localApi("/wifi/connect", { method: "POST", body: JSON.stringify({ ssid: ssid.trim(), password: wifiPassword }) });
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
      <Input
        value={wifiPassword}
        onChange={(e) => setWifiPassword(e.target.value)}
        onFocus={() => onFocusTarget("wifiPassword")}
        placeholder="Wi‑Fi 비밀번호 (오픈 네트워크면 비워두세요)"
        className="h-12 text-base"
        disabled={disabled || loading}
      />
      {networks.length > 0 && (
        <div className="max-h-48 space-y-2 overflow-auto rounded-2xl border p-2">
          {networks.map((n) => (
            <button key={`${n.ssid}-${n.security}`} type="button" onClick={() => setSsid(n.ssid)} className="flex w-full items-center justify-between rounded-xl bg-slate-50 p-3 text-left hover:bg-blue-50">
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

function TerminalPanel({ disabled, onFocusTarget }: { disabled: boolean; onFocusTarget: (target: FocusTarget) => void }) {
  const quick = useMemo(() => ["ip addr", "nmcli device status", "journalctl -u miraepass-kiosk -n 80 --no-pager", "sudo systemctl restart miraepass-kiosk"], []);
  const [command, setCommand] = useState(quick[0]);
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);

  useKioskTextInput("command", setCommand);

  const run = async () => {
    if (!command.trim()) return;
    setLoading(true);
    try {
      const result = await localApi<{ code: number; output: string }>("/terminal/run", { method: "POST", body: JSON.stringify({ command }) });
      setOutput(`$ ${command}\n(exit ${result.code})\n${result.output}`);
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "명령 실행에 실패했어요");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {quick.map((q) => (
          <Button key={q} type="button" variant="outline" onClick={() => setCommand(q)} className="rounded-xl" disabled={disabled || loading}>
            {q}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input value={command} onChange={(e) => setCommand(e.target.value)} onFocus={() => onFocusTarget("command")} className="h-12 font-mono text-base" disabled={disabled || loading} />
        <Button type="button" onClick={run} disabled={disabled || loading || !command.trim()} className="h-12 rounded-xl">
          {loading ? <Loader2 className="size-4 animate-spin" /> : "실행"}
        </Button>
      </div>
      <pre className="min-h-52 max-h-72 overflow-auto rounded-2xl bg-slate-950 p-4 text-sm text-green-100">{output || "명령 결과가 여기에 표시됩니다."}</pre>
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
