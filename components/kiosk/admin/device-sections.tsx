"use client";

import { KeyRound, Loader2, Power, RefreshCw, RotateCw } from "lucide-react";
import { useState } from "react";
import { api, ClientApiError } from "@/lib/fetcher";
import { AdminField, BigButton, Card, Notice, type NoticeState, SectionHeader } from "./admin-ui";
import { errorMessage, type Health, localApi } from "./local-api";

// ───────────────────────── 기기 토큰 ─────────────────────────

export function TokenSection({ onTokenRegistered }: { onTokenRegistered: (token: string) => void }) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);

  const submit = async () => {
    const next = token.trim();
    if (!next || loading) return;
    setLoading(true);
    setNotice(null);
    try {
      await api("/api/kiosk/verify", { method: "POST", kiosk: next });
      onTokenRegistered(next);
      setNotice({ tone: "success", text: "키오스크 토큰을 변경했어요." });
      setToken("");
    } catch (err) {
      setNotice({
        tone: "error",
        text:
          err instanceof ClientApiError && err.code === "KIOSK_UNREGISTERED"
            ? "토큰이 맞지 않아요. 관리자 › 설정의 기기 토큰을 확인해 주세요"
            : err instanceof ClientApiError
              ? err.message
              : "토큰 확인에 실패했어요",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SectionHeader icon={<KeyRound className="size-6" />} title="기기 토큰" description="서버 관리자 › 설정 화면의 키오스크 기기 토큰으로 이 기기를 다시 등록합니다." />
      <Card>
        <div className="space-y-4">
          <AdminField label="새 키오스크 토큰" value={token} onChange={setToken} placeholder="기기 토큰" disabled={loading} onEnter={() => void submit()} hint="서버에서 확인된 토큰만 저장돼요. 틀리면 기존 토큰이 그대로 유지됩니다." />
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          <BigButton onClick={() => void submit()} disabled={!token.trim() || loading} className="w-full">
            {loading && <Loader2 className="size-5 animate-spin" />} {loading ? "확인 중…" : "토큰 변경"}
          </BigButton>
        </div>
      </Card>
    </>
  );
}

// ───────────────────────── 전원 ─────────────────────────

type PowerAction = "reboot" | "shutdown";
const POWER_LABEL: Record<PowerAction, string> = { reboot: "재부팅", shutdown: "종료" };

export function PowerSection({ health }: { health: Health | null }) {
  const [confirm, setConfirm] = useState<PowerAction | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const powerDisabled = !health?.powerControl;

  const run = async (action: PowerAction) => {
    setLoading(true);
    setNotice(null);
    try {
      await localApi(`/system/${action}`, { method: "POST", body: "{}" });
      setNotice({ tone: "success", text: action === "reboot" ? "재부팅합니다. 잠시 뒤 키오스크가 다시 켜져요." : "종료합니다. 화면이 꺼진 뒤 전원을 분리해 주세요." });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, `${POWER_LABEL[action]} 명령에 실패했어요`) });
      setLoading(false);
    } finally {
      setConfirm(null);
    }
  };

  return (
    <>
      <SectionHeader icon={<Power className="size-6" />} title="전원" description="화면을 새로 고치거나 기기를 재부팅·종료합니다." />
      <div className="space-y-4">
        <Card title="화면">
          <p className="mb-4 text-base text-slate-600">네트워크를 바꾼 뒤 화면이 이상하면 키오스크 화면을 새로 불러오세요.</p>
          <BigButton variant="outline" onClick={() => window.location.reload()} className="w-full">
            <RefreshCw className="size-5" /> 키오스크 화면 새로고침
          </BigButton>
        </Card>

        <Card title="기기 전원">
          {powerDisabled && (
            <Notice tone="warning" className="mb-4">
              {health ? "이 기기에서는 전원 제어가 꺼져 있어요. 설치 스크립트로 설치한 키오스크에서만 사용할 수 있어요." : "로컬 서비스에 연결되지 않아 전원 제어를 사용할 수 없어요."}
            </Notice>
          )}
          {confirm ? (
            <div className="space-y-3 rounded-2xl border-2 border-red-200 bg-red-50 p-4">
              <p className="text-lg font-extrabold text-red-800">정말 키오스크를 {POWER_LABEL[confirm]}할까요?</p>
              <p className="text-sm text-red-700">진행 중인 주문이 없는지 확인해 주세요.</p>
              <div className="grid grid-cols-2 gap-3">
                <BigButton variant="outline" onClick={() => setConfirm(null)} disabled={loading}>
                  취소
                </BigButton>
                <BigButton variant="danger" onClick={() => void run(confirm)} disabled={loading}>
                  {loading && <Loader2 className="size-5 animate-spin" />} {POWER_LABEL[confirm]}
                </BigButton>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <BigButton variant="outline" onClick={() => setConfirm("reboot")} disabled={powerDisabled || loading}>
                <RotateCw className="size-5" /> 재부팅
              </BigButton>
              <BigButton variant="danger" onClick={() => setConfirm("shutdown")} disabled={powerDisabled || loading}>
                <Power className="size-5" /> 종료
              </BigButton>
            </div>
          )}
          {notice && <Notice tone={notice.tone} className="mt-4">{notice.text}</Notice>}
        </Card>
      </div>
    </>
  );
}
