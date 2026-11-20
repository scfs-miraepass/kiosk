import { eq } from "drizzle-orm";
import { db, schema } from "./db";

/**
 * 서버 시작 시 호출. 이전 프로세스가 결제·환불 도중 종료돼 중간 상태에 멈춘 주문을 정리한다.
 * 진행 중이던 요청은 프로세스와 함께 사라졌으므로 이 시점의 중간 상태는 모두 '중단됨'이다.
 *
 * - pending_payment: 차감 요청을 보냈는지, 성공했는지 알 수 없다 → 결제 확인 필요(unknown)
 * - refunding: 지급 요청 결과를 알 수 없다 → refund_failed (관리자가 MIRAEPASS 내역 확인 후 재시도)
 */
export function recoverInterruptedPayments(): { paymentUnknown: number; refundInterrupted: number } {
  return db.transaction((tx) => {
    const pending = tx
      .update(schema.orders)
      .set({ status: "failed", paymentStatus: "unknown", failReason: "PAYMENT_UNKNOWN" })
      .where(eq(schema.orders.status, "pending_payment"))
      .returning({ id: schema.orders.id })
      .all();
    const refunding = tx
      .update(schema.orders)
      .set({ paymentStatus: "refund_failed" })
      .where(eq(schema.orders.paymentStatus, "refunding"))
      .returning({ id: schema.orders.id })
      .all();
    const log = (orderId: number, action: string, detail: string) =>
      tx.insert(schema.staffActions).values({ orderId, actorId: null, actorName: "system", action, detail }).run();
    for (const { id } of pending) log(id, "payment_unknown", "결제 처리 중 서버가 재시작됐어요");
    for (const { id } of refunding) {
      log(id, "refund_failed", "환불 처리 중 서버가 재시작됐어요. MIRAEPASS 포인트 내역을 확인한 뒤 재시도해 주세요");
    }
    return { paymentUnknown: pending.length, refundInterrupted: refunding.length };
  });
}
