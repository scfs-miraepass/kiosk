import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? process.env.TEMP ?? "/tmp";
  process.env.DATABASE_PATH = `${tmp}/cafe-pin-setup-${process.pid}-${Date.now()}/cafe.db`;
  process.env.MIRAEPASS_MOCK = "1";
  process.env.MIRAEPASS_MOCK_LATENCY = "0";
  process.env.KIOSK_DEVICE_TOKEN = "test-token";
  globalThis.__cafeDb = undefined;
});

import { POST } from "@/app/api/customers/pin/route";
import { resetRateLimit } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { mockGateway } from "@/lib/miraepass/mock";

beforeEach(() => resetRateLimit());
afterAll(() => {
  // Windows는 열려 있는 DB 파일을 지울 수 없다
  db.$client.close();
  fs.rmSync(path.dirname(process.env.DATABASE_PATH!), { recursive: true, force: true });
});

const setup = async (body: unknown, token: string | null = "test-token") => {
  const req = new Request("http://local/api/customers/pin", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Kiosk-Token": token } : {}) },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({}) });
  return { status: res.status, json: await res.json() };
};

const pinActions = () => db.select().from(schema.staffActions).where(eq(schema.staffActions.action, "kiosk_pin_set")).all();

describe("POST /api/customers/pin", () => {
  it("이미 결제 비밀번호가 있으면 바꿀 수 없다", async () => {
    const res = await setup({ id: 2307, pin: "999999" });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("PIN_ALREADY_SET");
    // 기존 비밀번호 그대로
    await expect(mockGateway.verifyKioskPin(2307, "123456")).resolves.toBe(true);
    await expect(mockGateway.verifyKioskPin(2307, "999999")).resolves.toBe(false);
  });

  it("MIRAEPASS에 가입하지 않은 사용자는 만들 수 없다", async () => {
    const res = await setup({ id: 3106, pin: "246810" });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("NOT_REGISTERED");
    expect(await mockGateway.kioskPinStatus(3106)).toBe("unregistered");
  });

  it("없는 사용자는 404", async () => {
    expect((await setup({ id: 1999, pin: "246810" })).status).toBe(404);
  });

  it.each([[{ id: 3105 }], [{ id: 3105, pin: "12345" }], [{ id: 3105, pin: "1234567" }], [{ id: 3105, pin: "12a456" }], [{ id: 31, pin: "246810" }]])(
    "6자리 숫자가 아니면 받지 않는다: %j",
    async (body) => {
      expect((await setup(body)).status).toBe(422);
      expect(await mockGateway.kioskPinStatus(3105)).toBe("unset");
    },
  );

  it("등록된 키오스크만 만들 수 있다", async () => {
    expect((await setup({ id: 3105, pin: "246810" }, null)).json.code).toBe("KIOSK_UNREGISTERED");
    expect(await mockGateway.kioskPinStatus(3105)).toBe("unset");
  });

  it("키오스크에서 만들 수 없는 환경(MIRAEPASS에 최초 설정 API 없음)에서는 거절한다", async () => {
    mockGateway.canSetKioskPin = false;
    try {
      const res = await setup({ id: 3105, pin: "246810" });
      expect(res.status).toBe(409);
      expect(res.json.code).toBe("PIN_NOT_SET");
      expect(await mockGateway.kioskPinStatus(3105)).toBe("unset");
    } finally {
      mockGateway.canSetKioskPin = true;
    }
  });

  it("결제 비밀번호가 없는 가입자는 만들 수 있고, 만든 비밀번호로 결제 검증이 된다", async () => {
    expect(pinActions()).toHaveLength(0);
    const res = await setup({ id: 3105, pin: "246810" });
    expect(res.status).toBe(201);
    expect(await mockGateway.kioskPinStatus(3105)).toBe("ready");
    await expect(mockGateway.verifyKioskPin(3105, "246810")).resolves.toBe(true);
    // 누구 것을 만들었는지 기록이 남는다
    expect(pinActions()).toMatchObject([{ actorId: 3105, actorName: "kiosk", detail: "한미설", orderId: null }]);

    // 한 번 만든 뒤에는 다시 만들 수 없다
    const again = await setup({ id: 3105, pin: "111111" });
    expect(again.json.code).toBe("PIN_ALREADY_SET");
    await expect(mockGateway.verifyKioskPin(3105, "246810")).resolves.toBe(true);
    expect(pinActions()).toHaveLength(1);
  });

  it("같은 ID로 반복해서 시도하면 막는다", async () => {
    for (let i = 0; i < 5; i++) expect((await setup({ id: 2307, pin: "999999" })).status).toBe(409);
    expect((await setup({ id: 2307, pin: "999999" })).status).toBe(429);
  });
});
