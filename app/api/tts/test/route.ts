import { ApiError, handler, requireUser } from "@/lib/api";
import { callText } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { readClip, requestClip } from "@/lib/tts";

export const dynamic = "force-dynamic";

/** 직원 화면 "음성 테스트": 현재 학생 호출 문구로 만든 예시 음성 (문장은 서버가 정해 아무 문장이나 만들 수 없다) */
export const GET = handler(async () => {
  await requireUser("staff");
  const voice = getSettings().voice;
  const text = callText(voice, { customerType: "student", customerName: "홍길동", grade: 3, orderNo: 12, menu: "아메리카노" });
  const id = requestClip(text, voice);
  const data = id ? await readClip(id) : null;
  if (!data) throw new ApiError("TTS_UNAVAILABLE", "서버 음성을 쓸 수 없어요", 503);
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "audio/wav", "Content-Length": String(data.length), "Cache-Control": "no-store" },
  });
});
