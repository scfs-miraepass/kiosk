import { z } from "zod";
import { handler, ok, parseBody, rateLimit, requireKiosk } from "@/lib/api";
import { INITIAL_KEYS, matchesInitials } from "@/lib/hangul";
import { miraepass } from "@/lib/miraepass";
import { mapMiraepassError } from "@/lib/orders";
import type { TeacherOption } from "@/lib/types";

/** 성의 초성 하나. 초성 없이 전체 명단을 내주지는 않는다 */
const Body = z.object({ initial: z.enum(INITIAL_KEYS) });

/**
 * 교사 이름 찾기: 교사 ID는 계정을 만든 순서대로 붙어서 본인도 모르는 경우가 많다.
 * 성의 초성으로 교사 목록을 주고, 키오스크는 이어서 누른 초성으로 이 목록을 화면에서 좁힌다.
 */
export const POST = handler(async (req) => {
  const token = requireKiosk(req);
  rateLimit(`teachers:${token}`, 60, 60_000);
  const { initial } = await parseBody(req, Body);

  let found;
  try {
    found = await miraepass().searchTeachers(initial);
  } catch (e) {
    throw mapMiraepassError(e);
  }

  // 검색은 부분 일치라 초성이 이름 중간에 있는 교사도 섞여 온다. 성의 초성이 같은 교사만 남긴다
  const teachers: TeacherOption[] = found
    .filter((u) => u.type === "teacher" && matchesInitials(u.name, initial))
    .map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id - b.id);
  return ok(teachers);
});
