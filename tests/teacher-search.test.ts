import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.MIRAEPASS_MOCK = "1";
  process.env.MIRAEPASS_MOCK_LATENCY = "0";
  process.env.KIOSK_DEVICE_TOKEN = "test-token";
});

import { POST } from "@/app/api/customers/teachers/route";
import { resetRateLimit } from "@/lib/api";

beforeEach(() => resetRateLimit());

const search = async (body: unknown, token: string | null = "test-token") => {
  const req = new Request("http://local/api/customers/teachers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Kiosk-Token": token } : {}) },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({}) });
  return { status: res.status, json: await res.json() };
};

describe("POST /api/customers/teachers", () => {
  it("성의 초성이 같은 교사만 가나다순으로 돌려준다", async () => {
    const res = await search({ initial: "ㄱ" });
    expect(res.status).toBe(200);
    // 홍길동(이름 중간에 ㄱ)과 학생 김미래는 나오지 않는다
    expect(res.json.data.map((t: { name: string }) => t.name)).toEqual(["강바다", "권도윤", "김선생", "김하늘"]);
  });

  it("이름과 ID만 준다 (잔액 등은 주지 않는다)", async () => {
    const res = await search({ initial: "ㅎ" });
    expect(res.json.data).toEqual([
      { id: 4001, name: "홍길동" },
      { id: 4007, name: "황보람" },
    ]);
  });

  it("해당하는 교사가 없으면 빈 목록이다", async () => {
    expect((await search({ initial: "ㅍ" })).json.data).toEqual([]);
  });

  it.each([[{}], [{ initial: "" }], [{ initial: "ㄱㄴ" }], [{ initial: "ㄲ" }], [{ initial: "김" }], [{ initial: "a" }]])(
    "초성 하나가 아니면 받지 않는다: %j",
    async (body) => {
      expect((await search(body)).status).toBe(422);
    },
  );

  it("등록된 키오스크만 조회할 수 있다", async () => {
    expect((await search({ initial: "ㄱ" }, null)).json.code).toBe("KIOSK_UNREGISTERED");
    expect((await search({ initial: "ㄱ" }, "wrong")).status).toBe(401);
  });

  it("짧은 시간에 너무 많이 조회하면 막는다", async () => {
    for (let i = 0; i < 60; i++) expect((await search({ initial: "ㄱ" })).status).toBe(200);
    expect((await search({ initial: "ㄱ" })).status).toBe(429);
  });
});
