import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.DATABASE_PATH = `${tmp}/cafe-lookup-${process.pid}-${Date.now()}/cafe.db`;
  process.env.MIRAEPASS_MOCK = "1";
  process.env.MIRAEPASS_MOCK_LATENCY = "0";
  process.env.KIOSK_DEVICE_TOKEN = "test-token";
  globalThis.__cafeDb = undefined;
});

import { POST } from "@/app/api/customers/lookup/route";
import { resetRateLimit } from "@/lib/api";
import { db, schema } from "@/lib/db";

let latte: number;

beforeAll(() => {
  const cat = db.insert(schema.categories).values({ name: "테스트" }).returning().get();
  latte = db.insert(schema.menuItems).values({ categoryId: cat.id, name: "라떼", price: 2000 }).returning().get().id;
});
beforeEach(() => resetRateLimit());
afterAll(() => fs.rmSync(path.dirname(process.env.DATABASE_PATH!), { recursive: true, force: true }));

const lookup = async (body: unknown) => {
  const req = new Request("http://local/api/customers/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kiosk-Token": "test-token" },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({}) });
  return { status: res.status, json: await res.json() };
};

const cart = (quantity: number) => [{ menuItemId: latte, quantity, optionItemIds: [] }];

describe("POST /api/customers/lookup", () => {
  it("잔액 비교는 서버가 계산한 장바구니 합계로 한다", async () => {
    // 1215는 mock 잔액 800P
    expect((await lookup({ id: 1215, items: cart(1) })).json.data.sufficient).toBe(false);
    // 2307은 5200P: 라떼 2잔(4000P)은 충분, 3잔(6000P)은 부족
    expect((await lookup({ id: 2307, items: cart(2) })).json.data.sufficient).toBe(true);
    expect((await lookup({ id: 2307, items: cart(3) })).json.data.sufficient).toBe(false);
  });

  it("임의 금액(amount)으로는 조회할 수 없다", async () => {
    const res = await lookup({ id: 2307, amount: 5200 });
    expect(res.status).toBe(422);
  });

  it("같은 ID를 반복 조회하면 막는다", async () => {
    for (let i = 0; i < 10; i++) expect((await lookup({ id: 3412, items: cart(1) })).status).toBe(200);
    const res = await lookup({ id: 3412, items: cart(1) });
    expect(res.status).toBe(429);
    // 다른 ID는 영향 없음
    expect((await lookup({ id: 1101, items: cart(1) })).status).toBe(200);
  });
});
