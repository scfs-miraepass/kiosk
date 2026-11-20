/**
 * 키오스크 기기의 로컬 제어 서비스(scripts/pi-kiosk/miraepass-pi-control.py) 호출.
 * 클라우드 페이지가 키오스크 기기(라즈베리파이 등 리눅스)의 Chromium 안에서 열릴 때만 127.0.0.1로 닿는다.
 */
export const PI_CONTROL_URL = "http://127.0.0.1:8765";

export class LocalApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function localApi<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${PI_CONTROL_URL}${path}`, {
      ...rest,
      cache: "no-store",
      signal: controller.signal,
      headers: rest.body ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
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
  signal: number | null;
};

export type NetworkStatus = {
  hostname: string;
  /** nmcli networking connectivity: full | limited | portal | none | unknown */
  connectivity: string;
  ethernet: EthernetStatus;
  wifi: WifiStatus;
};

export type WifiNetwork = { ssid: string; security: string; signal: number; active: boolean; enterprise: boolean };

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
