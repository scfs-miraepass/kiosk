import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getSession } from "./session";
import type { ApiErrorCode, SessionUser } from "./types";

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status = 400,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const ok = <T>(data: T, init?: ResponseInit) => NextResponse.json({ success: true, data }, init);

export function fail(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { success: false, code: error.code, message: error.message, ...error.extra },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { success: false, code: "VALIDATION", message: "요청 값이 올바르지 않아요", issues: error.issues },
      { status: 422 },
    );
  }
  console.error("[api] unhandled", error);
  return NextResponse.json({ success: false, code: "INTERNAL", message: "서버 오류가 발생했어요" }, { status: 500 });
}

type Ctx<P> = { params: Promise<P> };

/** try/catch + 에러 직렬화를 감싼 Route Handler */
export function handler<P = Record<string, string>>(fn: (req: Request, ctx: Ctx<P>) => Promise<Response>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return fail(e);
    }
  };
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const json = await req.json().catch(() => {
    throw new ApiError("VALIDATION", "JSON 본문이 필요해요", 400);
  });
  return schema.parse(json);
}

export async function requireUser(role: SessionUser["role"] = "staff"): Promise<SessionUser> {
  const session = await getSession();
  const user = session.user;
  if (!user) throw new ApiError("UNAUTHORIZED", "로그인이 필요해요", 401);
  if (role === "admin" && user.role !== "admin") throw new ApiError("FORBIDDEN", "관리자 권한이 필요해요", 403);
  return user;
}

export function requireKiosk(req: Request) {
  const expected = process.env.KIOSK_DEVICE_TOKEN;
  const token = req.headers.get("x-kiosk-token");
  // 비밀번호 오류(INVALID_PIN)도 401이라, 키오스크가 토큰 문제만 구분할 수 있도록 전용 코드를 쓴다
  if (!expected || token !== expected) throw new ApiError("KIOSK_UNREGISTERED", "등록되지 않은 키오스크예요", 401);
  return token;
}

type Bucket = { count: number; reset: number };

declare global {
  var __rateLimit: { buckets: Map<string, Bucket>; lastSweep: number } | undefined;
}
/** 라우트 번들마다 따로 생기지 않도록 globalThis에 둔다 (pin-guard와 같은 방식) */
const limiter = (globalThis.__rateLimit ??= { buckets: new Map(), lastSweep: 0 });
const SWEEP_INTERVAL_MS = 60_000;

/** 아주 단순한 메모리 rate limit (키오스크 조회 남용 방지). 서버를 다시 시작하면 초기화된다 */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const { buckets } = limiter;
  // 만료된 키를 주기적으로 지운다. 지우지 않으면 로그인 ID처럼 임의 값이 키가 될 때 계속 쌓인다
  if (now - limiter.lastSweep >= SWEEP_INTERVAL_MS) {
    limiter.lastSweep = now;
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  if (++b.count > limit) throw new ApiError("RATE_LIMITED", "잠시 후 다시 시도해 주세요", 429);
}

/** 테스트용 */
export function rateLimitSize() {
  return limiter.buckets.size;
}

/** 테스트용 */
export function resetRateLimit() {
  limiter.buckets.clear();
  limiter.lastSweep = 0;
}

export const idParam = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError("NOT_FOUND", "잘못된 ID예요", 404);
  return n;
};
