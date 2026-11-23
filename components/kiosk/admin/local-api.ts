/**
 * 키오스크 기기의 로컬 제어 서비스(scripts/kiosk-device/miraepass-kiosk-control.py) 호출.
 * 클라우드 페이지가 키오스크 기기(라즈베리파이 등 리눅스)의 Chromium 안에서 열릴 때만 127.0.0.1로 닿는다.
 */
export const KIOSK_CONTROL_URL = "http://127.0.0.1:8765";

export class LocalApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * PIN 확인 후 로컬 서비스가 발급한 관리자 토큰. 설정 API는 이 토큰이 있어야 동작한다.
 * 메모리에만 두므로 새로고침하면 사라지고, 관리자 모드를 닫을 때 지운다.
 */
let adminToken: string | null = null;
export const setAdminToken = (token: string | null) => {
  adminToken = token;
};

export async function localApi<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${KIOSK_CONTROL_URL}${path}`, {
      ...rest,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(adminToken ? { "X-Kiosk-Admin-Token": adminToken } : {}),
        ...rest.headers,
      },
    });
  } catch {
    throw new LocalApiError(
      controller.signal.aborted ? "응답이 너무 오래 걸려요. 잠시 뒤 다시 시도해 주세요" : "키오스크 로컬 서비스에 연결할 수 없어요",
      controller.signal.aborted ? "TIMEOUT" : "UNREACHABLE",
    );
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new LocalApiError(json?.message ?? "로컬 서비스 요청에 실패했어요", json?.code ?? "INTERNAL");
  return json.data as T;
}

export const errorMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export type Health = { ok: boolean; hostname?: string; model?: string; version?: string; powerControl?: boolean };

type IpInfo = { addresses: string[]; gateway: string; dns: string[] };

export type EthernetStatus = IpInfo & {
  device: string | null;
  connected: boolean;
  state: string;
  connection: string | null;
  method: "auto" | "manual";
  config: { addresses: string[]; gateway: string; dns: string[] } | null;
};

export type WifiStatus = IpInfo & {
  device: string | null;
  connected: boolean;
  state: string;
  radio: string;
  ssid: string | null;
  /** nmcli 신호 세기 0~100 (%) */
  signal: number | null;
  /** 실제 수신 세기 (dBm, iw로 읽음). 읽을 수 없으면 null */
  dbm: number | null;
  /** "2.4GHz" | "5GHz" | "6GHz" */
  band: string | null;
  /** 연결 속도, 예: "270 Mbit/s" */
  rate: string | null;
};

export type NetworkStatus = {
  hostname: string;
  /** nmcli networking connectivity: full | limited | portal | none | unknown */
  connectivity: string;
  ethernet: EthernetStatus;
  wifi: WifiStatus;
};

export type WifiNetwork = {
  ssid: string;
  security: string;
  signal: number;
  active: boolean;
  enterprise: boolean;
  /** 가장 센 AP의 대역 */
  band: string | null;
  /** 같은 이름으로 잡힌 모든 대역 (예: ["2.4GHz", "5GHz"]) */
  bands: string[];
};

/** 신호 세기(%) → 막대 수·문구·색 */
export function signalLevel(signal: number) {
  if (signal >= 75) return { bars: 4, label: "매우 좋음", tone: "good" as const };
  if (signal >= 50) return { bars: 3, label: "좋음", tone: "good" as const };
  if (signal >= 30) return { bars: 2, label: "보통", tone: "fair" as const };
  return { bars: 1, label: "약함", tone: "weak" as const };
}

/** 이 값보다 약하면 결제 중 끊길 수 있다고 안내한다 */
export const WEAK_SIGNAL = 30;

/** nmcli 장치 상태를 화면용 한글로 */
export function deviceStateLabel(state: string, kind: "ethernet" | "wifi") {
  if (state === "connected") return "연결됨";
  if (state.startsWith("connecting")) return "연결 중";
  if (state === "disconnected") return "연결 안 됨";
  if (state === "unavailable") return kind === "ethernet" ? "케이블 없음" : "무선 꺼짐";
  if (state === "unmanaged") return "관리 안 됨";
  if (state === "not_found") return "장치 없음";
  return state || "알 수 없음";
}

/** xrandr 회전 방향 (left = 반시계 90°, right = 시계 90°) */
export type Rotation = "normal" | "left" | "right" | "inverted";

export type DisplayStatus = {
  /** 지금 화면에 적용된 방향 */
  rotation: Rotation;
  /** 저장된 방향 (재부팅해도 유지) */
  saved: Rotation;
  /** 바꾼 뒤 '유지' 확인을 기다리는 중이면, 남은 시간이 지나면 previous로 되돌아간다 */
  pending: { rotation: Rotation; previous: Rotation; secondsLeft: number } | null;
  available: boolean;
  /** 저장된 Chromium 확대·축소 비율 (기본 1.25). 바꾸면 키오스크 화면이 다시 시작돼 적용된다. */
  scale: number;
};

export type AudioOutput = {
  /** ALSA 카드 이름 (예: vc4hdmi0, Headphones) */
  id: string;
  label: string;
  kind: "hdmi" | "headphones" | "usb" | "other";
  /** HDMI 모니터 연결 여부. 알 수 없으면 null */
  connected: boolean | null;
};

export type AudioStatus = {
  /** alsa-utils(aplay·amixer)가 설치돼 있는지 */
  available: boolean;
  /** Chromium이 쓰는 ALSA 장치(miraepass)가 준비됐는지 */
  configured: boolean;
  /** 저장된 출력: "auto"(연결된 HDMI 우선) 또는 카드 이름 */
  output: string;
  /** 지금 실제로 쓰는 카드. 장치가 없으면 null */
  active: string | null;
  /** 저장된 출력이 빠져 있어(예: USB 스피커 분리) 다른 출력을 쓰는 중 */
  missing: boolean;
  outputs: AudioOutput[];
  /** 0~100 */
  volume: number;
  /** 볼륨 조절 장치(softvol)가 만들어졌는지 */
  volumeControl: boolean;
  /** 동작 중인 사운드 서버(pipewire·pulseaudio). 있으면 Chromium이 그쪽으로 소리를 낼 수 있다 */
  soundServer: string | null;
  /** 출력 변경 응답: 키오스크 화면을 다시 시작하는지 */
  restarting?: boolean;
  /** 볼륨 변경 응답: 바로 적용됐는지 */
  applied?: boolean;
};

export type SecurityStatus = {
  ssh: { installed: boolean; enabled: boolean; ports: number[] };
  firewall: { available: boolean; enabled: boolean; active: boolean; sshPorts: number[]; others: string[] };
};

export type UpdateState = "checking" | "downloading" | "installing" | "done" | "uptodate" | "failed";
export const UPDATE_TERMINAL_STATES: readonly UpdateState[] = ["done", "uptodate", "failed"];

export type UpdateStatus = {
  /** 펌웨어(기기 스크립트) 버전 */
  version: string;
  /** 업데이트를 받는 GitHub 저장소 (owner/repo) */
  repo: string;
  /** 업데이트가 지금 진행 중인지 */
  running: boolean;
  /** 자동 업데이트(매일 새벽) 켜짐 */
  auto: boolean;
  /** 다음 자동 업데이트 예정 시각 (systemd 표기) */
  nextRun: string;
  last: {
    state: UpdateState;
    message: string;
    manual: boolean;
    /** 관리자 모드에서 요청한 실행이면 그 요청 ID (자동 실행은 null) */
    requestId?: string | null;
    fromVersion?: string;
    toVersion?: string;
    updatedAt: number;
  } | null;
  log: string;
};

export type UpdateCheck = { current: string; latest: string; updateAvailable: boolean; repo: string };

/** 클라이언트(이 웹 앱) 버전. 빌드할 때 package.json에서 넣음 (next.config.ts). 펌웨어 버전과는 따로 올라간다. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

/** "1.1.1+a1b2c3d.dirty" → "1.1.1". 알 수 없으면 "" */
export function baseVersion(version?: string) {
  if (!version || version === "unknown") return "";
  return version.split("+")[0];
}

/** 펌웨어(기기 스크립트) 버전 표시: v1.1.1 (커밋 a1b2c3d, 수정본) */
export function versionLabel(version?: string) {
  const base = baseVersion(version);
  if (!base) return "알 수 없음";
  const build = version!.split("+")[1];
  if (!build) return `v${base}`;
  const [commit, dirty] = build.split(".");
  return `v${base} (커밋 ${commit}${dirty ? ", 수정본" : ""})`;
}
