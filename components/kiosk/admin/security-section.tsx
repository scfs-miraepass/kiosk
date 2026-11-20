"use client";

import { Loader2, ShieldCheck, ShieldOff, Terminal } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { BigButton, Card, InfoGrid, Notice, type NoticeState, SectionHeader, StatusDot } from "./admin-ui";
import { errorMessage, localApi, type SecurityStatus } from "./local-api";

type Pending = "firewall-off" | "ssh-on" | null;

/**
 * 방화벽 / SSH 설정.
 * 방화벽은 들어오는 연결을 모두 막는다 (키오스크는 서버에 접속만 하고 접속을 받을 일이 없음).
 * SSH를 켜면 방화벽이 켜져 있어도 SSH 포트만 열린다 — 로컬 서비스가 규칙을 다시 만든다.
 */
export function SecuritySection({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [busy, setBusy] = useState<"firewall" | "ssh" | null>(null);
  const [confirm, setConfirm] = useState<Pending>(null);
  const [notice, setNotice] = useState<NoticeState>(null);

  useEffect(() => {
    if (disabled) return;
    let alive = true;
    localApi<SecurityStatus>("/security/status", { timeoutMs: 20_000 })
      .then((s) => alive && setStatus(s))
      .catch((e: unknown) => alive && setNotice({ tone: "error", text: errorMessage(e, "보안 설정을 불러오지 못했어요") }));
    return () => {
      alive = false;
    };
  }, [disabled]);

  const change = async (kind: "firewall" | "ssh", enabled: boolean) => {
    setConfirm(null);
    setBusy(kind);
    setNotice(null);
    try {
      const next = await localApi<SecurityStatus>(`/security/${kind}`, { method: "POST", body: JSON.stringify({ enabled }), timeoutMs: 60_000 });
      setStatus(next);
      setNotice({
        tone: "success",
        text:
          kind === "firewall"
            ? enabled
              ? "방화벽을 켰어요. 들어오는 연결을 모두 차단합니다."
              : "방화벽을 껐어요."
            : enabled
              ? `SSH를 켰어요.${next.firewall.enabled ? ` 방화벽에서 SSH 포트(${next.ssh.ports.join(", ")})만 허용했어요.` : ""}`
              : "SSH를 껐어요. 이미 접속한 세션은 유지돼요.",
      });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "설정을 바꾸지 못했어요") });
    } finally {
      setBusy(null);
    }
  };

  const fw = status?.firewall;
  const ssh = status?.ssh;
  const locked = disabled || busy !== null || !status;

  return (
    <>
      <SectionHeader icon={<ShieldCheck className="size-6" />} title="보안" description="외부에서 이 기기로 들어오는 연결을 막고, 원격 접속(SSH)을 켜고 끕니다." />
      <div className="space-y-4">
        <Card title="방화벽">
          <div className="space-y-4">
            <StateRow on={fw?.enabled} loading={!status} onText="켜짐 · 들어오는 연결 차단" offText="꺼짐 · 모든 연결 허용" />
            <p className="text-base text-slate-600">
              키오스크는 서버에 접속하기만 하므로 들어오는 연결을 모두 막아도 주문·결제에는 영향이 없어요. SSH가 켜져 있으면 SSH 포트만 열어 둡니다.
            </p>
            {fw && (
              <InfoGrid
                rows={[
                  ["허용된 포트", fw.active ? (fw.sshPorts.length ? `SSH ${fw.sshPorts.join(", ")}` : "없음") : "-"],
                  ...(fw.others.length ? ([["다른 방화벽", `${fw.others.join(", ")} 동작 중 (규칙이 함께 적용돼요)`]] as [string, string][]) : []),
                ]}
              />
            )}
            {fw && !fw.available && <Notice tone="warning">nftables가 설치돼 있지 않아요. 설치 스크립트를 다시 실행해 주세요.</Notice>}
            {confirm === "firewall-off" ? (
              <ConfirmBox
                text="방화벽을 끄면 같은 네트워크의 다른 기기가 이 키오스크에 접속을 시도할 수 있어요. 끌까요?"
                action="방화벽 끄기"
                onCancel={() => setConfirm(null)}
                onConfirm={() => void change("firewall", false)}
              />
            ) : (
              <ToggleButtons
                on={fw?.enabled}
                busy={busy === "firewall"}
                disabled={locked || !fw?.available}
                onLabel="켜기"
                offLabel="끄기"
                onOn={() => void change("firewall", true)}
                onOff={() => setConfirm("firewall-off")}
              />
            )}
          </div>
        </Card>

        <Card title="SSH 원격 접속">
          <div className="space-y-4">
            <StateRow on={ssh?.enabled} loading={!status} onText={`켜짐 · 포트 ${ssh?.ports.join(", ") ?? ""}`} offText="꺼짐" icon={<Terminal className="size-5" />} />
            <p className="text-base text-slate-600">유지보수할 때만 켜고, 작업이 끝나면 꺼 두세요. 끄더라도 이미 접속한 세션은 끊기지 않아요.</p>
            {ssh && !ssh.installed && <Notice tone="warning">이 기기에 SSH 서버(openssh-server)가 설치돼 있지 않아요.</Notice>}
            {confirm === "ssh-on" ? (
              <ConfirmBox
                text={`SSH를 켜면 같은 네트워크에서 이 기기에 원격 접속할 수 있어요.${fw?.enabled ? " 방화벽에서 SSH 포트가 열립니다." : ""} 켤까요?`}
                action="SSH 켜기"
                onCancel={() => setConfirm(null)}
                onConfirm={() => void change("ssh", true)}
              />
            ) : (
              <ToggleButtons
                on={ssh?.enabled}
                busy={busy === "ssh"}
                disabled={locked || !ssh?.installed}
                onLabel="켜기"
                offLabel="끄기"
                onOn={() => setConfirm("ssh-on")}
                onOff={() => void change("ssh", false)}
              />
            )}
          </div>
        </Card>

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      </div>
    </>
  );
}

function StateRow({ on, loading, onText, offText, icon }: { on?: boolean; loading: boolean; onText: string; offText: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xl font-extrabold">
      {icon ?? (on ? <ShieldCheck className="size-6 text-green-600" /> : <ShieldOff className="size-6 text-slate-400" />)}
      <StatusDot tone={loading ? "off" : on ? "ok" : "warn"} />
      {loading ? "확인 중…" : on ? onText : offText}
    </div>
  );
}

function ToggleButtons({
  on,
  busy,
  disabled,
  onLabel,
  offLabel,
  onOn,
  onOff,
}: {
  on?: boolean;
  busy: boolean;
  disabled: boolean;
  onLabel: string;
  offLabel: string;
  onOn: () => void;
  onOff: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <BigButton variant={on ? "primary" : "outline"} onClick={onOn} disabled={disabled || on === true} className={cn(on && "disabled:opacity-100")}>
        {busy && !on ? <Loader2 className="size-5 animate-spin" /> : null} {onLabel}
      </BigButton>
      <BigButton variant={on === false ? "primary" : "outline"} onClick={onOff} disabled={disabled || on === false} className={cn(on === false && "disabled:opacity-100")}>
        {busy && on ? <Loader2 className="size-5 animate-spin" /> : null} {offLabel}
      </BigButton>
    </div>
  );
}

function ConfirmBox({ text, action, onCancel, onConfirm }: { text: string; action: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="space-y-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4">
      <p className="text-base font-bold text-amber-900">{text}</p>
      <div className="grid grid-cols-2 gap-3">
        <BigButton variant="outline" onClick={onCancel}>
          취소
        </BigButton>
        <BigButton variant="danger" onClick={onConfirm}>
          {action}
        </BigButton>
      </div>
    </div>
  );
}
