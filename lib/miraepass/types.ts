import type { CustomerType } from "../types";

export type MPUser = {
  id: number;
  type: CustomerType | "service";
  name: string;
  grade: number | null;
  classNo: number | null;
  point: number | null;
};

/**
 * 키오스크 결제 준비 상태
 * - ready: 결제 비밀번호가 있음
 * - unset: MIRAEPASS에 가입했지만(계정 비밀번호 있음) 결제 비밀번호가 없음
 * - unregistered: MIRAEPASS에 가입하지 않음 (계정 비밀번호도 없음)
 */
export type KioskPinStatus = "ready" | "unset" | "unregistered";

export type MPErrorCode =
  | "INSUFFICIENT_POINT"
  | "USER_NOT_FOUND"
  | "INVALID_CREDENTIALS"
  | "PIN_NOT_SET"
  | "PIN_ALREADY_SET"
  | "NOT_REGISTERED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "LIMIT_EXCEEDED"
  | "UNAVAILABLE";

export class MiraepassError extends Error {
  constructor(
    public code: MPErrorCode,
    message: string,
    public status?: number,
    /**
     * 요청이 MIRAEPASS에서 처리됐는지 알 수 없음 (응답 없음·타임아웃·5xx).
     * 포인트 차감에서 true면 실제로 빠졌을 수 있으므로 '실패'로 단정하면 안 된다.
     */
    public uncertain = false,
  ) {
    super(message);
    this.name = "MiraepassError";
  }
}

export interface MiraepassGateway {
  /** MIRAEPASS ID로 학생·교사 조회. 학생은 학번 4자리(3학년 4반 12번 → 3412), 교사는 고유 4자리 */
  findUser(id: number): Promise<MPUser | null>;
  /**
   * 이름 또는 초성으로 교사 검색 (ㅎㄱㄷ → 홍길동). 부분 일치라서 검색어가 이름 중간에 있는 교사도 나온다.
   * 필요한 범위로 거르는 것은 호출하는 쪽에서 한다
   */
  searchTeachers(query: string): Promise<MPUser[]>;
  /** 키오스크 결제 비밀번호(6자리 숫자) 확인. 설정하지 않았으면 PIN_NOT_SET */
  verifyKioskPin(id: number, pin: string): Promise<boolean>;
  /** 결제 비밀번호가 있는지, 없다면 가입은 했는지 */
  kioskPinStatus(id: number): Promise<KioskPinStatus>;
  /** 키오스크에서 결제 비밀번호를 처음 설정할 수 있는지. false면 결제 비밀번호가 없는 사용자에게 MIRAEPASS 앱에서 설정하도록 안내한다 */
  canSetKioskPin: boolean;
  /** 결제 비밀번호(6자리 숫자) 최초 설정. 이미 있으면 PIN_ALREADY_SET, 가입하지 않았으면 NOT_REGISTERED */
  setInitialKioskPin(id: number, pin: string): Promise<void>;
  /** 포인트 차감 → 남은 잔액 (서버가 잔액을 주지 않으면 null) */
  deduct(userId: number, amount: number, memo: string): Promise<number | null>;
  /** 포인트 지급(환불) */
  grant(userId: number, amount: number, memo: string): Promise<void>;
  /** 관리자/직원 로그인 확인. 세션은 즉시 폐기 */
  verifyCredentials(id: number, password: string): Promise<MPUser>;
}
