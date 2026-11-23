"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMenu, usePublicSettings, useStoreStatus } from "@/hooks/queries";
import { useIdleTimer } from "@/hooks/use-idle-timer";
import { useSocket } from "@/hooks/use-socket";
import { api, KIOSK_UNREGISTERED_EVENT } from "@/lib/fetcher";
import { configureKioskSound, playEffect, preloadVoice, type SoundEffect, speak, stopVoice, VOICE } from "@/lib/kiosk-sound";
import { qk } from "@/lib/query-keys";
import type { MenuItemDTO } from "@/lib/types";
import {
  kioskTokenAtom,
  orderResultAtom,
  paymentPendingAtom,
  resetKioskAtom,
  stepAtom,
  syncCartWithMenuAtom,
  tokenSetupAtom,
  type KioskStep,
} from "@/store/kiosk";
import { AttractScreen } from "./attract-screen";
import { ClosedScreen } from "./closed-screen";
import { DoneScreen } from "./done-screen";
import { ErrorScreen } from "./error-screen";
import { IdentifyScreen } from "./identify-screen";
import { KioskAdminUnlock } from "./kiosk-admin-unlock";
import { KioskSetup } from "./kiosk-setup";
import { MenuScreen } from "./menu-screen";
import { KioskAdminPanel } from "./admin/admin-panel";
import { PinScreen } from "./pin-screen";
import { PinSetupScreen } from "./pin-setup-screen";
import { ReviewScreen } from "./review-screen";

/** 입력 중인 단계: 이때만 무입력 타이머로 대기화면 복귀 */
const INTERACTIVE: KioskStep[] = ["menu", "review", "identify", "pin", "pin-setup", "error"];
/** 결제 완료 화면은 영업 종료 화면으로 끊지 않는다 (결제 진행 중은 paymentPendingAtom으로 판단) */
const UNINTERRUPTIBLE: KioskStep[] = ["done"];

const useMounted = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

/** 저장된 토큰이 아직 유효한지 서버에 확인. 거부되면 fetcher가 KIOSK_UNREGISTERED_EVENT를 보낸다 (네트워크 오류는 무시) */
const verifyToken = () => api("/api/kiosk/verify", { method: "POST", kiosk: true }).catch(() => {});

export function KioskApp() {
  const mounted = useMounted();
  const [token, setToken] = useAtom(kioskTokenAtom);
  const [setup, setSetup] = useAtom(tokenSetupAtom);
  const reset = useSetAtom(resetKioskAtom);

  // 서버가 저장된 토큰을 거부하면(서버 토큰이 바뀜) 토큰을 지우고 등록 화면으로 보낸다.
  // 키오스크 모드에서는 주소창·개발자 도구가 없어 저장된 토큰을 지울 방법이 없기 때문.
  // 결제 요청이 거부된 경우에도 서버가 토큰부터 확인하므로 포인트는 차감되지 않았다.
  useEffect(() => {
    const onUnregistered = () => {
      setToken(null);
      setSetup("invalid");
      reset("attract");
    };
    window.addEventListener(KIOSK_UNREGISTERED_EVENT, onUnregistered);
    return () => window.removeEventListener(KIOSK_UNREGISTERED_EVENT, onUnregistered);
  }, [setToken, setSetup, reset]);

  const registered = useCallback(
    (next: string) => {
      setToken(next);
      setSetup(null);
      reset("attract");
    },
    [setToken, setSetup, reset],
  );

  if (!mounted) return <FullscreenLoader />;
  if (!token) return <KioskSetup reason={setup} onRegistered={registered} />;
  return <KioskFlow token={token} />;
}

function KioskFlow({ token }: { token: string }) {
  const qc = useQueryClient();
  const [step, setStep] = useAtom(stepAtom);
  const setToken = useSetAtom(kioskTokenAtom);
  const reset = useSetAtom(resetKioskAtom);
  const syncCart = useSetAtom(syncCartWithMenuAtom);
  const paying = useAtomValue(paymentPendingAtom);
  const locked = paying || UNINTERRUPTIBLE.includes(step);
  const menu = useMenu();
  const status = useStoreStatus();
  const settings = usePublicSettings();
  const setTokenSetup = useSetAtom(tokenSetupAtom);
  const [adminUnlockOpen, setAdminUnlockOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  // 직원용 숨은 동작: 로고(영업 종료 화면은 달 아이콘)를 5초 동안 누르면 관리자 PIN 확인
  const openAdminUnlock = useCallback(() => setAdminUnlockOpen(true), []);

  // 켜질 때 저장된 토큰이 아직 유효한지 확인 (손님이 주문을 다 한 뒤에야 실패하지 않도록)
  useEffect(() => {
    verifyToken();
  }, [token]);

  useSocket(
    { role: "kiosk", kioskToken: token },
    {
      "menu:changed": () => qc.invalidateQueries({ queryKey: qk.menu }),
      "store:changed": (s) => qc.setQueryData(qk.storeStatus, s),
      "settings:changed": () => qc.invalidateQueries({ queryKey: qk.publicSettings }),
    },
    () => {
      qc.invalidateQueries({ queryKey: qk.menu });
      qc.invalidateQueries({ queryKey: qk.storeStatus });
      // 서버 토큰을 바꾸려면 서버를 재시작해야 하므로, 재연결될 때 토큰을 다시 확인한다
      verifyToken();
    },
  );

  // 메뉴(가격·품절)가 바뀌면 장바구니를 최신 메뉴에 맞춘다
  const menuMap = useMemo(() => {
    const map = new Map<number, MenuItemDTO>();
    menu.data?.forEach((c) => c.items.forEach((i) => map.set(i.id, i)));
    return map;
  }, [menu.data]);
  useEffect(() => {
    if (menu.data && !locked) syncCart(menuMap);
    // step 변화로는 다시 맞출 필요 없음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuMap, syncCart]);

  const kiosk = settings.data?.kiosk ?? { idleSeconds: 60, doneSeconds: 10, shufflePinPad: true, soundEffects: true, voiceGuide: true };
  useKioskSound(step, kiosk.soundEffects, kiosk.voiceGuide && !adminOpen);
  const goHome = useCallback(() => reset("attract"), [reset]);
  const finish = useCallback(() => reset("attract"), [reset]);

  // 관리자 모드가 열려 있는 동안은 손님용 무입력 타이머를 멈춘다 (관리자 모드는 자체 타이머로 닫힘)
  useIdleTimer(kiosk.idleSeconds, goHome, INTERACTIVE.includes(step) && !paying && !adminOpen && !adminUnlockOpen);

  const closed = status.data && !status.data.open;
  useEffect(() => {
    if (closed && !locked && step !== "attract") reset("attract");
  }, [closed, locked, step, reset]);

  if (menu.isPending || status.isPending) return <FullscreenLoader />;
  if (menu.isError) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 text-center">
        <p className="text-2xl font-bold">메뉴를 불러오지 못했어요</p>
        <button onClick={() => menu.refetch()} className="h-14 rounded-2xl bg-primary px-8 text-lg font-bold text-primary-foreground">
          다시 시도
        </button>
      </div>
    );
  }
  const adminLayer = (
    <>
      {adminUnlockOpen && (
        <KioskAdminUnlock
          onCancel={() => setAdminUnlockOpen(false)}
          onUnlocked={() => {
            setAdminUnlockOpen(false);
            setAdminOpen(true);
          }}
        />
      )}
      {adminOpen && (
        <KioskAdminPanel
          onClose={() => {
            setAdminOpen(false);
            reset("attract");
          }}
          onTokenRegistered={(next) => {
            setToken(next);
            setTokenSetup(null);
            reset("attract");
          }}
        />
      )}
    </>
  );

  if (closed && !locked) {
    return (
      <>
        <ClosedScreen status={status.data!} onLongPress={openAdminUnlock} />
        {adminLayer}
      </>
    );
  }

  return (
    <div className="kiosk-surface h-dvh overflow-hidden">
      {step === "attract" && <AttractScreen menu={menu.data} onStart={() => setStep("menu")} />}
      {step === "menu" && <MenuScreen menu={menu.data} onHome={goHome} onLogoLongPress={openAdminUnlock} />}
      {step === "review" && <ReviewScreen onHome={goHome} />}
      {step === "identify" && <IdentifyScreen onHome={goHome} />}
      {step === "pin" && <PinScreen shuffle={kiosk.shufflePinPad} onHome={goHome} />}
      {step === "pin-setup" && <PinSetupScreen shuffle={kiosk.shufflePinPad} onHome={goHome} />}
      {step === "done" && <DoneScreen seconds={kiosk.doneSeconds} onFinish={finish} />}
      {step === "error" && <ErrorScreen onHome={goHome} />}
      {adminLayer}
    </div>
  );
}

const SOUND_EFFECTS: SoundEffect[] = ["tap", "add", "remove", "success", "error"];
/** 단계마다 하는 음성 안내 (done·error는 효과음과 함께 따로 처리) */
const STEP_VOICE: Partial<Record<KioskStep, () => { text: string; clips: string[] }>> = {
  review: VOICE.review,
  identify: VOICE.identify,
  pin: VOICE.pin,
  "pin-setup": VOICE.pinSetup,
};

/**
 * 키오스크 소리.
 * - 버튼을 누르면 '톡' 효과음. 버튼에 data-sound="add|remove|success|error|off"를 달면 그 소리로 바꾸거나 끈다.
 * - 화면이 바뀌면 그 화면에서 할 일을 음성으로 안내하고, 주문이 끝나면 주문번호를 읽어 준다.
 */
function useKioskSound(step: KioskStep, effects: boolean, voice: boolean) {
  const result = useAtomValue(orderResultAtom);
  const prev = useRef<KioskStep>(step);

  useEffect(() => {
    configureKioskSound({ effects, voice });
  }, [effects, voice]);

  useEffect(() => {
    preloadVoice();
    // click은 실제로 누른 경우에만 생긴다 (스크롤하려고 댄 손가락에는 소리를 내지 않는다)
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("button, [role='button'], a[href], [data-sound]");
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return;
      const wanted = el.getAttribute("data-sound");
      if (wanted === "off") return;
      playEffect(SOUND_EFFECTS.includes(wanted as SoundEffect) ? (wanted as SoundEffect) : "tap");
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      stopVoice();
    };
  }, []);

  useEffect(() => {
    const from = prev.current;
    prev.current = step;
    if (from === step) return;
    if (step === "attract") return stopVoice();
    if (step === "menu") {
      // 처음 시작할 때만 인사한다 (주문 확인에서 '더 담기'로 돌아올 때는 말하지 않음)
      if (from === "attract") void speak(VOICE.welcome());
      else stopVoice();
      return;
    }
    if (step === "done") {
      playEffect("success");
      if (result) void speak(VOICE.done(result.orderNo));
      return;
    }
    if (step === "error") {
      playEffect("error");
      void speak(VOICE.error());
      return;
    }
    const line = STEP_VOICE[step];
    if (line) void speak(line());
  }, [step, result]);
}

function FullscreenLoader() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <Loader2 className="size-10 animate-spin text-primary" />
    </div>
  );
}
