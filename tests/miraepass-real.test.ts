import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MiraepassError } from "@/lib/miraepass";
import { realGateway } from "@/lib/miraepass/real";

/**
 * 실제 MIRAEPASS 클라이언트가 응답을 못 받은 차감(타임아웃·5xx)을
 * '결과 불명(uncertain)'으로, 서버가 거절한 차감은 확실한 실패로 구분하는지 확인한다.
 */
type Mode = "ok" | "hang" | "500" | "400";
let mode: Mode = "ok";
let deductCalls = 0;
let searchUrl: URL | null = null;
let server: Server;

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/auth/login") {
      return json(
        res,
        200,
        { success: true, data: { id: 5001, type: "service", name: "카페", grade: null, number: null } },
        { "Set-Cookie": "session_id=test; Path=/" },
      );
    }
    if (req.url === "/point/deduct") {
      deductCalls++;
      if (mode === "hang") return; // 응답하지 않음 → 클라이언트 타임아웃
      if (mode === "500") return json(res, 500, { success: false, message: "boom" });
      if (mode === "400") return json(res, 400, { success: false, message: "포인트 부족" });
      return json(res, 200, { success: true, data: 4200 });
    }
    if (req.url?.startsWith("/search?")) {
      searchUrl = new URL(req.url, "http://local");
      const user = (id: number | null, type: string, name: string) => ({ id, type, name, grade: null, number: null, point: 1000 });
      return json(res, 200, {
        success: true,
        data: [user(4001, "teacher", "홍길동"), user(4002, "teacher", "김선생"), user(1101, "student", "김미래"), user(null, "teacher", "미등록")],
      });
    }
    json(res, 404, { success: false });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  process.env.MIRAEPASS_API_URL = `http://127.0.0.1:${port}/`;
  process.env.MIRAEPASS_SERVICE_ID = "5001";
  process.env.MIRAEPASS_SERVICE_PASSWORD = "pw";
  process.env.MIRAEPASS_TIMEOUT_MS = "300";
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  deductCalls = 0;
});

async function deductError(): Promise<MiraepassError> {
  const e = await realGateway.deduct(1101, 800, "test").then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(MiraepassError);
  return e as MiraepassError;
}

describe("realGateway.deduct", () => {
  it("성공하면 남은 잔액을 돌려준다", async () => {
    mode = "ok";
    await expect(realGateway.deduct(1101, 800, "test")).resolves.toBe(4200);
  });

  it("응답이 없으면 제한 시간 뒤 결과 불명으로 실패하고, 자동 재시도하지 않는다", async () => {
    mode = "hang";
    const started = Date.now();
    const e = await deductError();
    expect(e).toMatchObject({ code: "UNAVAILABLE", uncertain: true });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(deductCalls).toBe(1);
  });

  it("5xx 응답은 결과 불명이다", async () => {
    mode = "500";
    expect(await deductError()).toMatchObject({ code: "UNAVAILABLE", uncertain: true });
  });

  it("서버가 거절한 요청(4xx)은 확실한 실패다", async () => {
    mode = "400";
    expect(await deductError()).toMatchObject({ code: "INSUFFICIENT_POINT", uncertain: false });
  });
});

describe("realGateway.searchTeachers", () => {
  it("검색어를 교사 유형으로 검색하고 ID가 있는 교사만 돌려준다", async () => {
    const found = await realGateway.searchTeachers("ㄱ");
    expect(searchUrl?.searchParams.get("q")).toBe("ㄱ");
    expect(searchUrl?.searchParams.getAll("t")).toEqual(["teacher"]);
    // 서버가 다른 유형을 섞어 보내도 교사만 남긴다
    expect(found.map((u) => [u.id, u.name])).toEqual([
      [4001, "홍길동"],
      [4002, "김선생"],
    ]);
  });
});
