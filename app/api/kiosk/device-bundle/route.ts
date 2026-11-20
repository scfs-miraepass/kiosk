import { handler, ok } from "@/lib/api";
import { getDeviceBundle } from "@/lib/device-bundle";

export const dynamic = "force-dynamic";

/**
 * 키오스크 기기 스크립트 묶음. 기기의 로컬 서비스(miraepass-kiosk-control)가 업데이트할 때 받는다.
 * ?meta=1 이면 버전과 해시만 돌려준다 (업데이트 확인용).
 * 스크립트는 저장소에 공개된 내용과 같고 비밀 값이 없으므로 인증 없이 제공한다.
 */
export const GET = handler(async (req) => {
  const bundle = getDeviceBundle();
  if (new URL(req.url).searchParams.get("meta") === "1") {
    return ok({ version: bundle.version, hash: bundle.hash });
  }
  return ok(bundle);
});
