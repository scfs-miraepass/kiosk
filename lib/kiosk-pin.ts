import { ApiError } from "./api";
import { miraepass } from "./miraepass";
import { mapMiraepassError } from "./orders";

/**
 * 결제 비밀번호 준비 상태 (고객 조회와 비밀번호 만들기에서 함께 사용).
 * - ready: 결제 비밀번호가 있다
 * - setup: 아직 없고, 키오스크에서 지금 만들 수 있다
 *
 * 결제할 수 없는 경우는 예외로 알린다.
 * - NOT_REGISTERED: MIRAEPASS에 가입하지 않았다 (계정 비밀번호도 없다)
 * - PIN_NOT_SET: 결제 비밀번호가 없는데 키오스크에서 만들 수도 없다 (MIRAEPASS에 최초 설정 API가 없을 때)
 */
export async function pinReadiness(customerId: number): Promise<"ready" | "setup"> {
  const gateway = miraepass();
  let status;
  try {
    status = await gateway.kioskPinStatus(customerId);
  } catch (e) {
    throw mapMiraepassError(e);
  }
  if (status === "ready") return "ready";
  if (status === "unregistered") {
    throw new ApiError("NOT_REGISTERED", "MIRAEPASS에 가입되어 있지 않아 이용할 수 없어요. MIRAEPASS 앱에서 먼저 로그인해 주세요", 409);
  }
  if (!gateway.canSetKioskPin) {
    throw new ApiError("PIN_NOT_SET", "키오스크 비밀번호가 설정되지 않았어요. MIRAEPASS에서 먼저 설정해 주세요", 409);
  }
  return "setup";
}
