import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// lib/db는 처음 쓸 때 DATABASE_PATH를 읽으므로 import 전에 테스트 전용 DB를 지정한다
vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? process.env.TEMP ?? "/tmp";
  process.env.DATABASE_PATH = `${tmp}/cafe-test-${process.pid}-${Date.now()}/cafe.db`;
  process.env.MIRAEPASS_MOCK = "1";
  process.env.MIRAEPASS_MOCK_LATENCY = "0";
  globalThis.__cafeDb = undefined;
});

// 영업시간과 무관하게 테스트하도록 항상 영업 중
vi.mock("@/lib/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings")>()),
  getStoreStatus: () => ({ open: true, reason: "open", message: "영업 중", todayHours: null, nextOpenAt: null }),
}));

import { ApiError } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { MiraepassError } from "@/lib/miraepass";
import { mockGateway } from "@/lib/miraepass/mock";
import { createOrder, getOrder, resolveUnknownPayment, retryRefund, transitionOrder } from "@/lib/orders";
import { recoverInterruptedPayments } from "@/lib/payment-recovery";
import type { SessionUser } from "@/lib/types";

const admin: SessionUser = { id: 9001, name: "관리자", role: "admin" };
const CUSTOMER = 2307; // mock 학생, 잔액 5200
let menuItemId: number;
let seq = 0;

beforeAll(() => {
  const cat = db.insert(schema.categories).values({ name: "테스트" }).returning().get();
  menuItemId = db.insert(schema.menuItems).values({ categoryId: cat.id, name: "아메리카노", price: 1000 }).returning().get().id;
});

afterEach(() => vi.restoreAllMocks());

const order = (key = `test-key-${++seq}`) =>
  createOrder({
    idempotencyKey: key,
    customerId: CUSTOMER,
    pin: "123456",
    items: [{ menuItemId, quantity: 1, optionItemIds: [] }],
    expectedTotal: 1000,
  });

const row = (id: number) => db.select().from(schema.orders).where(eq(schema.orders.id, id)).get()!;

async function apiError(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}

const uncertain = () => new MiraepassError("UNAVAILABLE", "timeout", undefined, true);

describe("주문 결제", () => {
  it("결제에 성공하면 주문번호를 부여하고, 같은 멱등키로 다시 요청해도 한 번만 차감한다", async () => {
    const deduct = vi.spyOn(mockGateway, "deduct");
    const first = await order("same-key-1");
    const again = await order("same-key-1");
    expect(again).toEqual(first);
    expect(deduct).toHaveBeenCalledTimes(1);
    expect(row(first.orderId)).toMatchObject({ status: "received", paymentStatus: "paid" });
  });

  it("차감이 확실히 실패하면 결제 실패로 남긴다", async () => {
    vi.spyOn(mockGateway, "deduct").mockRejectedValueOnce(new MiraepassError("INSUFFICIENT_POINT", "부족", 400));
    const e = await apiError(order());
    expect(e.code).toBe("INSUFFICIENT_POINT");
    const failed = db.select().from(schema.orders).where(eq(schema.orders.failReason, "INSUFFICIENT_POINT")).get()!;
    expect(failed).toMatchObject({ status: "failed", paymentStatus: "failed" });
  });

  it("차감 응답을 받지 못하면 결제 확인 필요로 남기고, 같은 키로 재시도해도 다시 차감하지 않는다", async () => {
    const deduct = vi.spyOn(mockGateway, "deduct").mockRejectedValueOnce(uncertain());
    const e = await apiError(order("unknown-key"));
    expect(e.code).toBe("PAYMENT_UNKNOWN");
    const id = e.extra!.orderId as number;
    expect(row(id)).toMatchObject({ status: "failed", paymentStatus: "unknown", orderNo: null });

    const retry = await apiError(order("unknown-key"));
    expect(retry.code).toBe("PAYMENT_UNKNOWN");
    expect(deduct).toHaveBeenCalledTimes(1);
  });
});

describe("결제 확인 필요 주문 처리", () => {
  async function unknownOrder() {
    vi.spyOn(mockGateway, "deduct").mockRejectedValueOnce(uncertain());
    return (await apiError(order())).extra!.orderId as number;
  }

  it("차감됨으로 확정하면 주문번호를 받아 접수 대기가 된다", async () => {
    const id = await unknownOrder();
    const o = resolveUnknownPayment(id, true, admin);
    expect(o).toMatchObject({ status: "received", paymentStatus: "paid" });
    expect(o.orderNo).toBeGreaterThan(0);
    // 두 번 확정할 수 없다
    expect(() => resolveUnknownPayment(id, true, admin)).toThrow(ApiError);
  });

  it("차감 안 됨으로 확정하면 결제 실패가 된다", async () => {
    const id = await unknownOrder();
    expect(resolveUnknownPayment(id, false, admin)).toMatchObject({ status: "failed", paymentStatus: "failed" });
  });
});

describe("환불", () => {
  it("취소하지 않은 주문은 환불할 수 없다", async () => {
    const { orderId } = await order();
    const e = await apiError(retryRefund(orderId, admin));
    expect(e.code).toBe("INVALID_TRANSITION");
    expect(row(orderId).paymentStatus).toBe("paid");
  });

  it("취소하면 환불한다", async () => {
    const { orderId } = await order();
    const { refundError } = await transitionOrder(orderId, "cancel", admin);
    expect(refundError).toBeUndefined();
    expect(row(orderId)).toMatchObject({ status: "cancelled", paymentStatus: "refunded" });
  });

  it("환불 재시도를 동시에 눌러도 한 번만 지급한다", async () => {
    const { orderId } = await order();
    vi.spyOn(mockGateway, "grant").mockRejectedValueOnce(new MiraepassError("UNAVAILABLE", "down", 503));
    const { refundError } = await transitionOrder(orderId, "cancel", admin);
    expect(refundError).toBeTruthy();
    expect(row(orderId).paymentStatus).toBe("refund_failed");

    const grant = vi.spyOn(mockGateway, "grant");
    grant.mockClear(); // 취소 때의 실패 호출은 세지 않는다
    const results = await Promise.allSettled([retryRefund(orderId, admin), retryRefund(orderId, admin)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(grant).toHaveBeenCalledTimes(1);
    expect(row(orderId).paymentStatus).toBe("refunded");
  });

  it("응답 없는 환불 실패는 내역 확인을 안내한다", async () => {
    const { orderId } = await order();
    vi.spyOn(mockGateway, "grant").mockRejectedValueOnce(uncertain());
    const { refundError } = await transitionOrder(orderId, "cancel", admin);
    expect(refundError).toContain("내역을 확인");
  });
});

describe("서버 재시작 복구", () => {
  it("결제 중·환불 중에 멈춘 주문을 확인 필요 상태로 바꾼다", async () => {
    const pending = db
      .insert(schema.orders)
      .values({ businessDate: "2026-01-01", idempotencyKey: "stuck-pending", customerType: "student", customerId: CUSTOMER, customerName: "박순천", total: 1000 })
      .returning()
      .get();
    const { orderId } = await order();
    await transitionOrder(orderId, "cancel", admin);
    db.update(schema.orders).set({ paymentStatus: "refunding" }).where(eq(schema.orders.id, orderId)).run();

    expect(recoverInterruptedPayments()).toEqual({ paymentUnknown: 1, refundInterrupted: 1 });
    expect(row(pending.id)).toMatchObject({ status: "failed", paymentStatus: "unknown" });
    expect(getOrder(orderId).paymentStatus).toBe("refund_failed");
  });
});

afterAll(() => {
  // Windows는 열려 있는 DB 파일을 지울 수 없다
  db.$client.close();
  fs.rmSync(path.dirname(process.env.DATABASE_PATH!), { recursive: true, force: true });
});
