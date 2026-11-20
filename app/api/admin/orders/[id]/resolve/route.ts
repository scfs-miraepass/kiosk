import { z } from "zod";
import { handler, idParam, ok, parseBody, requireUser } from "@/lib/api";
import { resolveUnknownPayment } from "@/lib/orders";

/** 결제 결과를 알 수 없던 주문 확정: MIRAEPASS 포인트 내역에서 차감 여부를 확인한 관리자가 호출 */
export const POST = handler<{ id: string }>(async (req, { params }) => {
  const user = await requireUser("admin");
  const id = idParam((await params).id);
  const { paid } = await parseBody(req, z.object({ paid: z.boolean() }));
  return ok(resolveUnknownPayment(id, paid, user));
});
