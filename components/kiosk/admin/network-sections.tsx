"use client";

import { Activity, Cable, ChevronRight, Loader2, Lock, RefreshCw, Wifi } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AdminField, BigButton, Card, InfoGrid, Notice, type NoticeState, Segmented, SectionHeader, SignalBars, StatusDot } from "./admin-ui";
import {
  deviceStateLabel,
  type EthernetStatus,
  errorMessage,
  type Health,
  localApi,
  type NetworkStatus,
  signalLevel,
  WEAK_SIGNAL,
  type WifiNetwork,
  type WifiStatus,
} from "./local-api";

/** Wi‑Fi 화면을 보는 동안 신호 세기를 다시 읽는 간격 */
const WIFI_POLL_MS = 5000;

export type AdminSection = "status" | "ethernet" | "wifi" | "display" | "security" | "token" | "power";

type NetworkProps = {
  network: NetworkStatus | null;
  networkLoading: boolean;
  refreshNetwork: () => Promise<void>;
  disabled: boolean;
};

const CONNECTIVITY: Record<string, { label: string; tone: "ok" | "warn" | "off" }> = {
  full: { label: "인터넷 연결됨", tone: "ok" },
  limited: { label: "제한됨 (인터넷 없음)", tone: "warn" },
  portal: { label: "로그인 필요 (캡티브 포털)", tone: "warn" },
  none: { label: "연결 안 됨", tone: "off" },
};

const ipText = (s: { addresses: string[] }) => s.addresses.join(", ");

function RefreshButton({ onClick, loading, disabled }: { onClick: () => void; loading: boolean; disabled?: boolean }) {
  return (
    <BigButton variant="outline" onClick={onClick} disabled={disabled || loading} className="h-12 text-base">
      {loading ? <Loader2 className="size-5 animate-spin" /> : <RefreshCw className="size-5" />} 새로고침
    </BigButton>
  );
}

// ───────────────────────── 상태 요약 ─────────────────────────

export function StatusSection({ network, networkLoading, refreshNetwork, disabled, health, onNavigate }: NetworkProps & { health: Health | null; onNavigate: (s: AdminSection) => void }) {
  const conn = network ? (CONNECTIVITY[network.connectivity] ?? { label: "확인 불가", tone: "off" as const }) : null;

  return (
    <>
      <SectionHeader
        icon={<Activity className="size-6" />}
        title="기기 상태"
        description="네트워크와 로컬 서비스 상태를 한눈에 확인합니다."
        action={<RefreshButton onClick={() => void refreshNetwork()} loading={networkLoading} disabled={disabled} />}
      />
      <div className="space-y-4">
        <Card title="인터넷">
          <div className="flex items-center gap-3 text-xl font-extrabold">
            <StatusDot tone={conn?.tone ?? "off"} />
            {conn?.label ?? (networkLoading ? "확인 중…" : "확인 불가")}
          </div>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <SummaryCard
            icon={<Cable className="size-5" />}
            title="유선 LAN"
            status={network?.ethernet}
            kind="ethernet"
            extra={network?.ethernet.device ? (network.ethernet.method === "manual" ? "고정 IP" : "DHCP 자동") : undefined}
            onClick={() => onNavigate("ethernet")}
          />
          <SummaryCard
            icon={<Wifi className="size-5" />}
            title="Wi‑Fi"
            status={network?.wifi}
            kind="wifi"
            extra={network?.wifi.ssid ?? undefined}
            signal={network?.wifi.connected ? network.wifi.signal : null}
            onClick={() => onNavigate("wifi")}
          />
        </div>
        <Card title="기기 정보">
          <InfoGrid
            rows={[
              ["기기 모델", health?.model],
              ["호스트 이름", network?.hostname ?? health?.hostname],
              ["로컬 서비스", health ? `연결됨 · v${health.version ?? "?"}` : "연결 안 됨"],
              ["전원 제어", health ? (health.powerControl ? "사용 가능" : "사용 불가") : "-"],
              ["키오스크 주소", typeof window === "undefined" ? "" : window.location.origin],
            ]}
          />
        </Card>
      </div>
    </>
  );
}

function SummaryCard({
  icon,
  title,
  status,
  kind,
  extra,
  signal,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  status?: EthernetStatus | WifiStatus;
  kind: "ethernet" | "wifi";
  extra?: string;
  signal?: number | null;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-4 rounded-3xl border border-slate-200 bg-white p-5 text-left active:bg-slate-50">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-base font-extrabold text-slate-900">{title}</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
          <StatusDot tone={status?.connected ? "ok" : "off"} />
          {status ? deviceStateLabel(status.state, kind) : "확인 중…"}
          {extra && <span className="truncate">· {extra}</span>}
        </p>
        {status?.connected && <p className="mt-1 truncate text-sm font-semibold text-slate-800">{ipText(status)}</p>}
        {signal != null && (
          <p className={cn("mt-1.5 flex items-center gap-2 text-sm font-semibold", signal < WEAK_SIGNAL ? "text-red-600" : "text-slate-700")}>
            <SignalBars signal={signal} />
            신호 {signal}% · {signalLevel(signal).label}
          </p>
        )}
      </div>
      <ChevronRight className="size-6 text-slate-400" />
    </button>
  );
}

// ───────────────────────── 유선 LAN ─────────────────────────

const DEFAULT_NETMASK = "255.255.255.0";

/** "192.168.0.10/24" → ["192.168.0.10", "255.255.255.0"] */
function splitCidr(cidr: string): [string, string] {
  const [ip, prefix] = cidr.split("/");
  const bits = Number(prefix);
  if (!prefix || !Number.isInteger(bits) || bits < 0 || bits > 32) return [ip, DEFAULT_NETMASK];
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return [ip, [24, 16, 8, 0].map((s) => (mask >>> s) & 255).join(".")];
}

export function EthernetSection({ network, networkLoading, refreshNetwork, disabled }: NetworkProps) {
  const status = network?.ethernet ?? null;
  const [mode, setMode] = useState<"dhcp" | "static">("dhcp");
  const [address, setAddress] = useState("");
  const [netmask, setNetmask] = useState(DEFAULT_NETMASK);
  const [gateway, setGateway] = useState("");
  const [dns, setDns] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [prefilled, setPrefilled] = useState(false);

  // 처음 받은 상태로 폼을 채운다 (이후 새로고침은 입력 중인 값을 덮지 않음)
  if (status && !prefilled) {
    setPrefilled(true);
    if (status.method === "manual" && status.config) {
      const [ip, mask] = splitCidr(status.config.addresses[0] ?? "");
      setMode("static");
      setAddress(ip ?? "");
      setNetmask(mask);
      setGateway(status.config.gateway);
      setDns(status.config.dns.join(", "));
    }
  }

  const busy = disabled || saving;
  const noDevice = status?.device === null;

  const apply = async () => {
    if (mode === "static" && !address.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await localApi<{ activated: boolean; message: string }>("/ethernet/config", {
        method: "POST",
        body: JSON.stringify({ mode, address: address.trim(), netmask: netmask.trim(), gateway: gateway.trim(), dns: dns.trim() }),
        timeoutMs: 60_000,
      });
      setNotice({ tone: res.activated ? "success" : "warning", text: res.message });
      await refreshNetwork();
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "유선 네트워크 설정에 실패했어요") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionHeader
        icon={<Cable className="size-6" />}
        title="유선 LAN"
        description="이더넷 케이블 연결의 IP 설정을 바꿉니다."
        action={<RefreshButton onClick={() => void refreshNetwork()} loading={networkLoading} disabled={disabled} />}
      />
      <div className="space-y-4">
        <Card title="현재 상태">
          {noDevice ? (
            <Notice tone="warning">유선 네트워크 장치를 찾을 수 없어요.</Notice>
          ) : (
            <InfoGrid
              rows={[
                [
                  "상태",
                  status ? (
                    <span className="inline-flex items-center gap-2">
                      <StatusDot tone={status.connected ? "ok" : "off"} />
                      {deviceStateLabel(status.state, "ethernet")} {status.device && <span className="font-normal text-slate-500">({status.device})</span>}
                    </span>
                  ) : (
                    "확인 중…"
                  ),
                ],
                ["방식", status ? (status.method === "manual" ? "고정 IP" : "DHCP 자동") : ""],
                ["IP 주소", status ? ipText(status) : ""],
                ["게이트웨이", status?.gateway],
                ["DNS", status?.dns.join(", ")],
              ]}
            />
          )}
        </Card>

        <Card title="IP 설정">
          <div className="space-y-4">
            <Segmented
              value={mode}
              onChange={setMode}
              disabled={busy || noDevice}
              options={[
                { value: "dhcp", label: "DHCP 자동" },
                { value: "static", label: "고정 IP" },
              ]}
            />
            {mode === "dhcp" ? (
              <p className="text-base text-slate-600">공유기(DHCP 서버)에서 IP 주소를 자동으로 받아옵니다. 대부분의 매장에서는 이 설정을 쓰면 됩니다.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <AdminField label="IP 주소" value={address} onChange={setAddress} placeholder="예: 192.168.0.50" disabled={busy} />
                <AdminField label="서브넷 마스크" value={netmask} onChange={setNetmask} placeholder="255.255.255.0 또는 24" disabled={busy} />
                <AdminField label="게이트웨이" value={gateway} onChange={setGateway} placeholder="예: 192.168.0.1" disabled={busy} />
                <AdminField label="DNS (선택)" value={dns} onChange={setDns} placeholder="예: 8.8.8.8, 1.1.1.1" disabled={busy} onEnter={() => void apply()} />
              </div>
            )}
            <Notice tone="info" className="text-sm font-medium">
              적용하는 동안 네트워크가 잠깐 끊길 수 있어요. 주문이 없는 시간에 바꿔 주세요.
            </Notice>
            {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
            <BigButton onClick={() => void apply()} disabled={busy || noDevice || (mode === "static" && !address.trim())} className="w-full">
              {saving && <Loader2 className="size-5 animate-spin" />} {saving ? "적용 중…" : "유선 설정 적용"}
            </BigButton>
          </div>
        </Card>
      </div>
    </>
  );
}

// ───────────────────────── Wi‑Fi ─────────────────────────

/** 현재 연결의 신호 세기: 큰 막대 + % + 문구, 아래에 dBm·대역·속도 */
function SignalPanel({ status }: { status: WifiStatus }) {
  if (status.signal == null) return null;
  const level = signalLevel(status.signal);
  const details = [status.dbm != null ? `${status.dbm} dBm` : null, status.band, status.rate].filter(Boolean).join(" · ");
  return (
    <div className="mb-4 space-y-3">
      <div className="flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
        <SignalBars signal={status.signal} size="lg" />
        <div className="min-w-0">
          <p className="text-2xl font-extrabold text-slate-900">
            {status.signal}% <span className="text-lg font-bold text-slate-600">{level.label}</span>
          </p>
          {details && <p className="text-sm text-slate-500">{details}</p>}
        </div>
      </div>
      {status.signal < WEAK_SIGNAL && (
        <Notice tone="warning" className="text-sm">
          신호가 약해요. 주문·결제 중 연결이 끊길 수 있으니 공유기를 가까이 두거나 유선 LAN 연결을 권장해요.
        </Notice>
      )}
    </div>
  );
}

export function WifiSection({ network, networkLoading, refreshNetwork, disabled }: NetworkProps) {
  // 신호 세기는 계속 바뀌므로 이 화면을 보는 동안 가볍게 다시 읽는다 (캐시된 값, 재검색 없음)
  const [live, setLive] = useState<WifiStatus | null>(null);
  useEffect(() => {
    if (disabled) return;
    let alive = true;
    const poll = () =>
      localApi<WifiStatus>("/wifi/status", { timeoutMs: 8000 })
        .then((next) => alive && setLive(next))
        .catch(() => {});
    void poll();
    const timer = setInterval(poll, WIFI_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [disabled]);
  const status = live ?? network?.wifi ?? null;
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [ssid, setSsid] = useState("");
  const [hidden, setHidden] = useState(false);
  const [securityMode, setSecurityMode] = useState<"personal" | "enterprise">("personal");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const scan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      setNetworks(await localApi<WifiNetwork[]>("/wifi/scan", { timeoutMs: 45_000 }));
    } catch (e) {
      setScanError(errorMessage(e, "Wi‑Fi 검색에 실패했어요"));
    } finally {
      setScanning(false);
    }
  };

  // 탭에 처음 들어오면 한 번 자동 검색
  const scanned = useRef(false);
  useEffect(() => {
    if (disabled || scanned.current) return;
    scanned.current = true;
    void scan();
  }, [disabled]);

  const openForm = (next: { ssid: string; enterprise: boolean; hidden: boolean }) => {
    setSsid(next.ssid);
    setHidden(next.hidden);
    setSecurityMode(next.enterprise ? "enterprise" : "personal");
    setPassword("");
    setNotice(null);
    setFormOpen(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: "start" }));
  };

  const connect = async () => {
    if (!ssid.trim()) return;
    setConnecting(true);
    setNotice(null);
    try {
      await localApi("/wifi/connect", {
        method: "POST",
        body: JSON.stringify({ ssid: ssid.trim(), securityMode, identity: identity.trim(), password, hidden }),
        timeoutMs: 90_000,
      });
      setNotice({ tone: "success", text: `‘${ssid.trim()}’에 연결했어요.` });
      setPassword("");
      await Promise.all([refreshNetwork(), scan()]);
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "Wi‑Fi 연결에 실패했어요") });
    } finally {
      setConnecting(false);
    }
  };

  const busy = disabled || connecting;
  const noDevice = status?.device === null;

  return (
    <>
      <SectionHeader
        icon={<Wifi className="size-6" />}
        title="Wi‑Fi"
        description="무선 네트워크를 검색하고 연결합니다. (WPA-Personal / WPA-Enterprise)"
        action={<RefreshButton onClick={() => void refreshNetwork()} loading={networkLoading} disabled={disabled} />}
      />
      <div className="space-y-4">
        <Card title="현재 연결">
          {noDevice ? (
            <Notice tone="warning">무선 네트워크 장치를 찾을 수 없어요.</Notice>
          ) : (
            <>
            {status?.connected && <SignalPanel status={status} />}
            <InfoGrid
              rows={[
                [
                  "상태",
                  status ? (
                    <span className="inline-flex items-center gap-2">
                      <StatusDot tone={status.connected ? "ok" : "off"} />
                      {deviceStateLabel(status.state, "wifi")}
                    </span>
                  ) : (
                    "확인 중…"
                  ),
                ],
                ["네트워크", status?.connected ? (status.ssid ?? "") : ""],
                ["IP 주소", status ? ipText(status) : ""],
              ]}
            />
            </>
          )}
        </Card>

        {formOpen && (
          <div ref={formRef} className="scroll-mt-4">
            <Card title="연결 설정">
              <div className="space-y-4">
                <AdminField label="Wi‑Fi 이름 (SSID)" value={ssid} onChange={setSsid} placeholder="네트워크 이름" disabled={busy || !hidden} />
                <Segmented
                  value={securityMode}
                  onChange={setSecurityMode}
                  disabled={busy}
                  options={[
                    { value: "personal", label: "일반 (WPA-Personal)" },
                    { value: "enterprise", label: "기업 (WPA-Enterprise)" },
                  ]}
                />
                {securityMode === "enterprise" && (
                  <AdminField label="사용자 ID" value={identity} onChange={setIdentity} placeholder="Enterprise ID / 사용자 이름" disabled={busy} hint="PEAP / MSCHAPv2 방식으로 연결합니다." />
                )}
                <AdminField
                  label="비밀번호"
                  value={password}
                  onChange={setPassword}
                  placeholder={securityMode === "enterprise" ? "Enterprise 비밀번호" : "비밀번호 (개방형 네트워크면 비워 두세요)"}
                  disabled={busy}
                  secret
                  onEnter={() => void connect()}
                />
                {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
                <div className="grid grid-cols-[1fr_2fr] gap-3">
                  <BigButton variant="outline" onClick={() => setFormOpen(false)} disabled={connecting}>
                    취소
                  </BigButton>
                  <BigButton onClick={() => void connect()} disabled={busy || !ssid.trim()}>
                    {connecting && <Loader2 className="size-5 animate-spin" />} {connecting ? "연결 중…" : "연결"}
                  </BigButton>
                </div>
              </div>
            </Card>
          </div>
        )}
        {!formOpen && notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        <Card
          title="주변 네트워크"
          action={
            <BigButton variant="outline" onClick={() => void scan()} disabled={disabled || scanning || noDevice} className="h-12 text-base">
              {scanning ? <Loader2 className="size-5 animate-spin" /> : <RefreshCw className="size-5" />} {scanning ? "검색 중…" : "다시 검색"}
            </BigButton>
          }
        >
          {scanError && <Notice tone="error" className="mb-3">{scanError}</Notice>}
          {networks === null ? (
            <p className="py-6 text-center text-base text-slate-500">{scanning ? "주변 Wi‑Fi를 찾고 있어요…" : "‘다시 검색’을 눌러 주세요."}</p>
          ) : networks.length === 0 ? (
            <p className="py-6 text-center text-base text-slate-500">찾은 네트워크가 없어요.</p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
              {networks.map((n) => (
                <li key={n.ssid}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openForm({ ssid: n.ssid, enterprise: n.enterprise, hidden: false })}
                    className={cn("flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-100 disabled:opacity-50", n.active && "bg-green-50")}
                  >
                    <span className="flex w-12 shrink-0 flex-col items-center gap-1">
                      <SignalBars signal={n.signal} />
                      <span className={cn("text-xs font-bold", n.signal < WEAK_SIGNAL ? "text-red-600" : "text-slate-600")}>{n.signal}%</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg font-bold text-slate-900">{n.ssid}</span>
                      <span className="block text-sm text-slate-500">
                        {[n.security ? (n.enterprise ? "기업용 보안" : "보안") : "개방형", signalLevel(n.signal).label, n.bands.length ? n.bands.join(" / ") : n.band]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    {n.active && <span className="rounded-full bg-green-600 px-3 py-1 text-sm font-bold text-white">연결됨</span>}
                    {n.security && <Lock className="size-5 shrink-0 text-slate-400" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <BigButton variant="outline" onClick={() => openForm({ ssid: "", enterprise: false, hidden: true })} disabled={busy || noDevice} className="mt-3 w-full text-base">
            숨겨진 네트워크 직접 입력
          </BigButton>
        </Card>
      </div>
    </>
  );
}
