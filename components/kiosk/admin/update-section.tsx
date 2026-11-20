"use client";

import { CheckCircle2, Download, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BigButton, Card, InfoGrid, Notice, type NoticeState, SectionHeader, StatusDot } from "./admin-ui";
import {
  errorMessage,
  LocalApiError,
  localApi,
  UPDATE_TERMINAL_STATES,
  type UpdateCheck,
  type UpdateState,
  type UpdateStatus,
  versionLabel,
} from "./local-api";

/** 업데이트가 진행되는 동안 상태를 다시 읽는 간격 */
const POLL_MS = 2000;

const STATE_LABEL: Record<UpdateState, string> = {
  checking: "확인 중",
  downloading: "내려받는 중",
  installing: "적용 중",
  done: "완료",
  uptodate: "최신 버전",
  failed: "실패",
};

const fetchStatus = () => localApi<UpdateStatus>("/update/status");
const fetchCheck = () => localApi<UpdateCheck>("/update/check", { method: "POST", body: "{}", timeoutMs: 40_000 });
const CHECK_ERROR = "업데이트를 확인하지 못했어요";
const STATUS_ERROR = "업데이트 상태를 불러오지 못했어요";

const formatTime = (sec?: number) => (sec ? new Date(sec * 1000).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "");

/**
 * 진행 상황을 지켜보는 대상.
 * - 요청 ID: 관리자 모드에서 방금 요청한 실행. 이 ID가 붙은 결과가 나올 때까지 기다린다 (지난 실행 결과와 섞이지 않도록).
 * - "existing": 화면을 열었을 때 이미 진행 중이던 실행 (자동 업데이트 등).
 */
type Watch = { requestId: string } | "existing" | null;

/**
 * 기기 스크립트 업데이트.
 * 기기는 GitHub 저장소의 최신 정식 릴리스에서 스크립트를 받아 적용한다.
 * 적용은 별도 systemd 서비스가 하므로, 중간에 로컬 서비스가 다시 시작돼도 계속 진행된다.
 */
export function UpdateSection({ disabled, onUpdated }: { disabled: boolean; onUpdated: () => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  // 화면을 열면 바로 최신 릴리스를 확인하므로 처음엔 확인 중으로 둔다
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [watch, setWatch] = useState<Watch>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [confirm, setConfirm] = useState<"update" | "force" | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);

  // 부모가 다시 그려질 때마다 새 함수가 와도 진행 상황 확인 타이머가 다시 시작되지 않도록 ref로 들고 있는다
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => {
    onUpdatedRef.current = onUpdated;
  });

  const applyCheck = useCallback((p: Promise<UpdateCheck>, isAlive: () => boolean = () => true) => {
    return p
      .then((c) => isAlive() && setCheck(c))
      .catch((e: unknown) => {
        if (!isAlive()) return;
        setCheck(null);
        setNotice({ tone: "error", text: errorMessage(e, CHECK_ERROR) });
      })
      .finally(() => isAlive() && setChecking(false));
  }, []);

  const recheck = () => {
    setChecking(true);
    void applyCheck(fetchCheck());
  };

  // 처음 열 때 상태를 읽고 최신 릴리스가 있는지 확인한다
  useEffect(() => {
    if (disabled) return;
    let alive = true;
    const isAlive = () => alive;
    fetchStatus()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        if (s.running) setWatch("existing");
      })
      .catch((e: unknown) => alive && setNotice({ tone: "error", text: errorMessage(e, STATUS_ERROR) }));
    void applyCheck(fetchCheck(), isAlive);
    return () => {
      alive = false;
    };
  }, [disabled, applyCheck]);

  // 진행 중에는 상태를 계속 읽는다. 적용 중 로컬 서비스가 잠깐 다시 시작되면 연결 오류는 무시하고 기다린다.
  useEffect(() => {
    if (!watch) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const s = await fetchStatus();
        if (!alive) return;
        setStatus(s);
        setReconnecting(false);
        const last = s.last;
        const finished =
          !s.running && last && UPDATE_TERMINAL_STATES.includes(last.state) && (watch === "existing" || last.requestId === watch.requestId);
        if (!finished) return;
        setWatch(null);
        if (last.state === "done") {
          setNotice({ tone: "success", text: last.message });
          onUpdatedRef.current();
          setChecking(true);
          void applyCheck(fetchCheck());
        } else {
          setNotice({ tone: last.state === "failed" ? "error" : "info", text: last.message });
        }
      } catch (e) {
        if (!alive) return;
        if (e instanceof LocalApiError && e.code === "UNAUTHORIZED") {
          setWatch(null);
          setNotice({ tone: "warning", text: "관리자 인증이 끝났어요. 관리자 모드를 다시 열어 결과를 확인해 주세요." });
        } else {
          setReconnecting(true); // 서비스 재시작 중
        }
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [watch, applyCheck]);

  const apply = async (force: boolean) => {
    setConfirm(null);
    setBusy(true);
    setNotice(null);
    try {
      const res = await localApi<UpdateStatus & { requestId: string }>("/update/apply", { method: "POST", body: JSON.stringify({ force }) });
      setStatus(res);
      setWatch({ requestId: res.requestId });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "업데이트를 시작하지 못했어요") });
    } finally {
      setBusy(false);
    }
  };

  const setAuto = async (enabled: boolean) => {
    setBusy(true);
    setNotice(null);
    try {
      setStatus(await localApi<UpdateStatus>("/update/auto", { method: "POST", body: JSON.stringify({ enabled }) }));
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e, "자동 업데이트 설정을 바꾸지 못했어요") });
    } finally {
      setBusy(false);
    }
  };

  const running = watch !== null || Boolean(status?.running);
  const last = status?.last ?? null;
  const locked = disabled || busy || running;

  return (
    <>
      <SectionHeader
        icon={<Download className="size-6" />}
        title="업데이트"
        description="GitHub의 최신 릴리스에서 기기 스크립트를 받아 적용합니다. 설정과 네트워크는 그대로 유지돼요."
        action={
          <BigButton variant="outline" onClick={recheck} disabled={disabled || checking || running} className="h-12 text-base">
            {checking ? <Loader2 className="size-5 animate-spin" /> : <RefreshCw className="size-5" />} 다시 확인
          </BigButton>
        }
      />
      <div className="space-y-4">
        <Card title="버전">
          <div className="space-y-4">
            <InfoGrid
              rows={[
                ["이 기기", status ? versionLabel(status.version) : "확인 중…"],
                ["최신 릴리스", check ? `v${check.latest}` : checking ? "확인 중…" : "확인 못 함"],
                ["저장소", check?.repo ?? status?.repo ?? ""],
              ]}
            />
            {check && !running && (
              <div className="flex items-center gap-3 text-lg font-extrabold">
                {check.updateAvailable ? (
                  <>
                    <TriangleAlert className="size-6 text-amber-500" /> 새 업데이트가 있어요
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-6 text-green-600" /> 최신 버전이에요
                  </>
                )}
              </div>
            )}

            {running ? (
              <div className="flex items-center gap-3 rounded-2xl bg-blue-50 p-4 text-base font-bold text-blue-900">
                <Loader2 className="size-6 shrink-0 animate-spin" />
                <span>
                  {reconnecting ? "서비스가 다시 시작되는 중이에요…" : last && !UPDATE_TERMINAL_STATES.includes(last.state) ? last.message : "업데이트를 준비하고 있어요"}
                  <span className="mt-1 block text-sm font-medium">화면이 잠깐 다시 시작될 수 있어요. 전원을 끄지 마세요.</span>
                </span>
              </div>
            ) : confirm ? (
              <div className="space-y-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4">
                <p className="text-base font-bold text-amber-900">
                  {confirm === "update" ? `v${check?.latest} 업데이트를 적용할까요?` : `최신 릴리스(v${check?.latest})를 다시 적용할까요?`} 적용하는 동안 키오스크
                  화면이 잠깐 다시 시작될 수 있으니 주문이 없을 때 진행해 주세요.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <BigButton variant="outline" onClick={() => setConfirm(null)}>
                    취소
                  </BigButton>
                  <BigButton onClick={() => void apply(confirm === "force")}>적용</BigButton>
                </div>
              </div>
            ) : check?.updateAvailable ? (
              <BigButton onClick={() => setConfirm("update")} disabled={locked} className="w-full">
                <Download className="size-5" /> v{check.latest}(으)로 업데이트
              </BigButton>
            ) : (
              <BigButton variant="outline" onClick={() => setConfirm("force")} disabled={locked || !check} className="w-full text-base">
                최신 릴리스 다시 적용
              </BigButton>
            )}
          </div>
        </Card>

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        <Card title="자동 업데이트">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-xl font-extrabold">
              <StatusDot tone={status ? (status.auto ? "ok" : "warn") : "off"} />
              {status ? (status.auto ? "켜짐 · 매일 새벽 3:30 전후" : "꺼짐") : "확인 중…"}
            </div>
            <p className="text-base text-slate-600">새 릴리스가 있을 때만 적용해요. 그 시간에 기기가 꺼져 있었으면 다음에 켤 때 확인합니다.</p>
            <InfoGrid
              rows={[
                ["다음 확인", status?.auto ? status.nextRun || "-" : "-"],
                ["최근 결과", last ? `${STATE_LABEL[last.state] ?? last.state} · ${last.manual ? "수동" : "자동"} · ${formatTime(last.updatedAt)}` : "기록 없음"],
                ...(last && !running ? ([["내용", last.message]] as [string, string][]) : []),
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <BigButton variant={status?.auto ? "primary" : "outline"} onClick={() => void setAuto(true)} disabled={locked || status?.auto === true || !status}>
                켜기
              </BigButton>
              <BigButton variant={status && !status.auto ? "primary" : "outline"} onClick={() => void setAuto(false)} disabled={locked || status?.auto === false || !status}>
                끄기
              </BigButton>
            </div>
          </div>
        </Card>

        {status?.log && (
          <details className="rounded-3xl border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer text-base font-bold text-slate-700">최근 업데이트 기록 보기</summary>
            <pre className="mt-3 max-h-80 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-relaxed whitespace-pre-wrap text-slate-100 select-text">{status.log}</pre>
          </details>
        )}
      </div>
    </>
  );
}
