"use client";

import { Download, Share, SquarePlus } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Chrome·Edge·삼성 인터넷의 설치 이벤트 (표준 타입에 없음) */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * beforeinstallprompt는 페이지 로드 직후 한 번만 오므로 컴포넌트가 마운트되기 전에 받아 둔다.
 * 이 모듈은 직원 레이아웃에서 불러오므로 /staff 화면이 열릴 때 바로 등록된다.
 */
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** 직원 화면용 서비스 워커 등록 (HTTPS 또는 localhost에서만 가능) */
export function StaffServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker
      .register("/staff-sw.js", { scope: "/staff", updateViaCache: "none" })
      .catch((e) => console.warn("서비스 워커 등록 실패", e));
  }, []);
  return null;
}

type Platform = "ios" | "other";

/** 홈 화면 앱으로 실행 중인지 (iOS는 navigator.standalone) */
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS 13+는 데스크톱 Safari로 보이므로 터치 지원으로 구분
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "other";
}

/**
 * 상단 바의 "앱 설치" 버튼. 이미 앱으로 실행 중이면 보이지 않는다.
 * - Chrome 계열: 브라우저 설치 창을 띄움
 * - iOS Safari 등 설치 창을 띄울 수 없는 경우: 홈 화면에 추가하는 방법을 안내
 */
export function InstallAppButton() {
  const prompt = useSyncExternalStore(subscribe, () => deferred, () => null);
  const [env, setEnv] = useState<{ standalone: boolean; platform: Platform; secure: boolean } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const update = () => setEnv({ standalone: isStandalone(), platform: detectPlatform(), secure: window.isSecureContext });
    update();
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!env || env.standalone) return null;

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    // 한 번 쓴 이벤트는 다시 쓸 수 없다. 거절했다면 브라우저가 나중에 새 이벤트를 보낸다
    deferred = null;
    emit();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (v && prompt) return void install();
        setOpen(v);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="lg" aria-label="앱 설치">
          <Download /> <span className="hidden lg:inline">앱 설치</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="font-bold">홈 화면에 주문 처리 앱 추가</p>
        {env.platform === "ios" ? (
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <span className="font-bold text-foreground">1.</span> Safari 아래(아이패드는 위)의
              <Share className="size-4 shrink-0 text-primary" /> 공유 버튼
            </li>
            <li className="flex items-center gap-2">
              <span className="font-bold text-foreground">2.</span>
              <SquarePlus className="size-4 shrink-0 text-primary" /> 홈 화면에 추가
            </li>
            <li className="flex items-center gap-2">
              <span className="font-bold text-foreground">3.</span> 홈 화면의 &lsquo;미래카페 직원&rsquo; 아이콘으로 실행
            </li>
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">
            브라우저 메뉴(⋮)에서 <b className="text-foreground">앱 설치</b> 또는{" "}
            <b className="text-foreground">홈 화면에 추가</b>를 눌러 주세요.
          </p>
        )}
        {!env.secure && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            지금은 HTTPS가 아닌 주소로 접속해 있어서 바로가기로만 추가될 수 있어요. 앱으로 설치하려면 HTTPS 주소로 접속해 주세요.
          </p>
        )}
        <p className="text-xs text-muted-foreground">앱에서 처음 열 때 한 번 더 로그인해야 할 수 있어요.</p>
      </PopoverContent>
    </Popover>
  );
}
