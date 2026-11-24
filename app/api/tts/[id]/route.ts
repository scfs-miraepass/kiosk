import { ApiError, handler, requireUser } from "@/lib/api";
import { readClip } from "@/lib/tts";
import { CLIP_ID } from "@/lib/tts/cache";

export const dynamic = "force-dynamic";

/**
 * 서버에서 만든 안내 음성 (직원 화면 전용 — 고객 이름이 들어 있다)
 * 아직 만드는 중이면 끝날 때까지 잠깐 기다렸다가 보낸다. id가 같으면 내용도 같아 브라우저 캐시를 허용한다.
 */
export const GET = handler<{ id: string }>(async (_req, { params }) => {
  await requireUser("staff");
  const { id } = await params;
  if (!CLIP_ID.test(id)) throw new ApiError("NOT_FOUND", "음성을 찾을 수 없어요", 404);
  const data = await readClip(id);
  if (!data) throw new ApiError("NOT_FOUND", "음성을 찾을 수 없어요", 404);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(data.length),
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
});
