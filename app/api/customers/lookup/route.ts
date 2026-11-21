import { z } from "zod";
import { ApiError, handler, ok, parseBody, rateLimit, requireKiosk } from "@/lib/api";
import { CartItemsBody } from "@/lib/cart-schema";
import { maskName } from "@/lib/format";
import { pinReadiness } from "@/lib/kiosk-pin";
import { getMenuMap } from "@/lib/menu";
import { miraepass } from "@/lib/miraepass";
import { mapMiraepassError } from "@/lib/orders";
import { PricingError, priceCart } from "@/lib/pricing";
import type { CustomerCandidate } from "@/lib/types";

/** MIRAEPASS ID 4자리: 학생은 학번(3학년 4반 12번 → 3412), 교사는 고유 번호 */
const Body = z.object({
  id: z.coerce.number().int().min(1000).max(9999),
  items: CartItemsBody,
});

/** 같은 ID 조회 제한: 한 사람이 ID를 잘못 누르는 정도는 넉넉히, 반복 조회로 잔액을 추정하는 것은 막는다 */
const PER_ID_LIMIT = 10;
const PER_ID_WINDOW_MS = 10 * 60_000;

export const POST = handler(async (req) => {
  const token = requireKiosk(req);
  rateLimit(`lookup:${token}`, 30, 60_000);
  const { id, items } = await parseBody(req, Body);
  rateLimit(`lookup-id:${id}`, PER_ID_LIMIT, PER_ID_WINDOW_MS);

  // 비교 금액은 클라이언트 값이 아니라 서버 메뉴 기준 장바구니 합계로 정한다.
  // 임의 금액을 받으면 금액을 바꿔 가며 조회해 잔액을 알아낼 수 있다.
  let total: number | null = null;
  try {
    total = priceCart(getMenuMap(), items).total;
  } catch (e) {
    // 품절·가격 변경 등은 결제 단계에서 안내하므로 여기서는 잔액 판단만 생략한다
    if (!(e instanceof PricingError)) throw e;
  }

  let user;
  try {
    user = await miraepass().findUser(id);
  } catch (e) {
    throw mapMiraepassError(e);
  }
  if (!user || user.type === "service") throw new ApiError("USER_NOT_FOUND", "해당 ID의 사용자를 찾을 수 없어요", 404);

  // 결제 비밀번호가 없으면 6자리를 다 입력한 뒤가 아니라 여기서 미리 알려 준다 (미가입·설정 불가는 예외)
  const readiness = await pinReadiness(user.id);

  const candidate: CustomerCandidate = {
    id: user.id,
    type: user.type,
    // 공용 기기이므로 이름은 가운데를 가리고, 잔액은 숫자 대신 충분/부족만 알려준다
    displayName: maskName(user.name),
    grade: user.grade,
    classNo: user.classNo,
    sufficient: user.point === null || total === null ? null : user.point >= total,
    needsPinSetup: readiness === "setup",
  };
  return ok(candidate);
});
