import { z } from "zod";
import { ApiError, handler, parseBody, requireUser } from "@/lib/api";
import { synthPreview } from "@/lib/tts";

export const dynamic = "force-dynamic";

const Body = z.object({
  text: z.string().trim().min(1).max(100),
  rate: z.number().min(0.5).max(2),
});

/** 관리자 설정 화면의 음성 미리 듣기 (저장 전 문구·속도, 캐시하지 않음) */
export const POST = handler(async (req) => {
  await requireUser("admin");
  const { text, rate } = await parseBody(req, Body);
  const data = await synthPreview(text, rate);
  if (!data) throw new ApiError("TTS_UNAVAILABLE", "서버 음성을 쓸 수 없어요", 503);
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "audio/wav", "Content-Length": String(data.length), "Cache-Control": "no-store" },
  });
});
