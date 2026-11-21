import { z } from "zod";
import { ApiError, handler, ok, parseBody, rateLimit, requireKiosk } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { pinReadiness } from "@/lib/kiosk-pin";
import { miraepass } from "@/lib/miraepass";
import { mapMiraepassError } from "@/lib/orders";

const Body = z.object({
  id: z.number().int().min(1000).max(9999),
  pin: z.string().regex(/^\d{6}$/, "결제 비밀번호는 6자리 숫자예요"),
});

/** 같은 ID로 만들기를 반복해서 시도하지 못하게 한다 (정상이라면 한 번이면 끝난다) */
const PER_ID_LIMIT = 5;
const PER_ID_WINDOW_MS = 10 * 60_000;

/**
 * 결제 비밀번호 만들기: 학생은 학교에서 휴대폰을 쓸 수 없어 MIRAEPASS 앱에서 미리 설정하지 못한 경우가 많다.
 * 가입은 했지만 결제 비밀번호가 없는 사용자만 키오스크에서 처음 한 번 만들 수 있다.
 * 이미 있는 비밀번호는 여기서 바꿀 수 없다 (MIRAEPASS 앱에서 변경하거나 담당자가 초기화).
 */
export const POST = handler(async (req) => {
  const token = requireKiosk(req);
  rateLimit(`pin-setup:${token}`, 10, 60_000);
  const { id, pin } = await parseBody(req, Body);
  rateLimit(`pin-setup-id:${id}`, PER_ID_LIMIT, PER_ID_WINDOW_MS);

  const gateway = miraepass();
  let user;
  try {
    user = await gateway.findUser(id);
  } catch (e) {
    throw mapMiraepassError(e);
  }
  if (!user || user.type === "service") throw new ApiError("USER_NOT_FOUND", "해당 ID의 사용자를 찾을 수 없어요", 404);

  if ((await pinReadiness(user.id)) === "ready") {
    throw new ApiError("PIN_ALREADY_SET", "결제 비밀번호가 이미 설정되어 있어요", 409);
  }
  try {
    await gateway.setInitialKioskPin(user.id, pin);
  } catch (e) {
    throw mapMiraepassError(e);
  }

  // 본인 확인 없이 만들 수 있으므로, 누구 것을 언제 만들었는지 남겨 둔다
  db.insert(schema.staffActions)
    .values({ orderId: null, actorId: user.id, actorName: "kiosk", action: "kiosk_pin_set", detail: user.name })
    .run();
  console.info(`[kiosk] 결제 비밀번호를 만들었어요: ${user.name}(${user.id})`);
  return ok({ set: true }, { status: 201 });
});
