/** 클라이언트·서버가 함께 쓰는 DTO 타입 (DB 의존성 없음) */

export type CustomerType = "student" | "teacher";

export type OrderStatus =
  | "pending_payment"
  | "failed"
  | "received"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

/**
 * unknown: 차감 요청의 응답을 받지 못해(타임아웃·네트워크 오류·5xx) 실제로 빠졌는지 알 수 없음. 관리자가 확인 후 확정한다
 * refunding: 환불 요청 진행 중 (중복 환불 방지용 선점 상태)
 */
export type PaymentStatus = "unpaid" | "paid" | "failed" | "unknown" | "refunded" | "refunding" | "refund_failed";

export type MenuOptionItemDTO = {
  id: number;
  name: string;
  extraPrice: number;
  isDefault: boolean;
};

export type MenuOptionGroupDTO = {
  id: number;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  items: MenuOptionItemDTO[];
};

export type MenuItemDTO = {
  id: number;
  categoryId: number;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
  isSoldOut: boolean;
  badge: "NEW" | "BEST" | null;
  sort: number;
  optionGroups: MenuOptionGroupDTO[];
};

export type CategoryDTO = {
  id: number;
  name: string;
  emoji: string;
  sort: number;
  isActive: boolean;
  items: MenuItemDTO[];
};

export type OptionSnapshot = { group: string; item: string; extra: number };

export type OrderItemDTO = {
  id: number;
  menuItemId: number | null;
  name: string;
  unitPrice: number;
  quantity: number;
  options: OptionSnapshot[];
};

export type OrderDTO = {
  id: number;
  /** 결제 실패 주문은 0 */
  orderNo: number;
  businessDate: string;
  customerType: CustomerType;
  customerId: number;
  customerName: string;
  customerGrade: number | null;
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  balanceAfter: number | null;
  failReason: string | null;
  cancelReason: string | null;
  createdAt: string;
  paidAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  items: OrderItemDTO[];
};

export type CustomerCandidate = {
  id: number;
  type: CustomerType;
  displayName: string;
  grade: number | null;
  classNo: number | null;
  /** 잔액 조회가 불가능하면 null */
  sufficient: boolean | null;
  /** 결제 비밀번호가 아직 없어서 키오스크에서 먼저 만들어야 함 */
  needsPinSetup: boolean;
};

/** 키오스크의 교사 이름 찾기 목록 한 줄. ID는 고른 뒤 조회에만 쓰고 화면에 보여 주지 않는다 */
export type TeacherOption = {
  id: number;
  name: string;
};

export type CartLineInput = {
  menuItemId: number;
  quantity: number;
  optionItemIds: number[];
};

export type CreateOrderInput = {
  idempotencyKey: string;
  /** MIRAEPASS ID (학생: 학번 4자리, 교사: 고유 4자리) */
  customerId: number;
  /** 키오스크 결제 비밀번호 6자리. 서버에서 MIRAEPASS로 검증 후 바로 버린다 */
  pin: string;
  items: CartLineInput[];
  expectedTotal: number;
};

export type CreateOrderResult = {
  orderId: number;
  orderNo: number;
  total: number;
  balanceAfter: number | null;
};

export type DayHours = { open: string; close: string; closed: boolean };

export type StoreHours = Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", DayHours>;

export type VoiceSettings = {
  newOrder: string;
  callStudent: string;
  callTeacher: string;
  rate: number;
};

export type KioskSettings = {
  idleSeconds: number;
  doneSeconds: number;
  shufflePinPad: boolean;
  /** 버튼·담기·완료 효과음 */
  soundEffects: boolean;
  /** 화면별 음성 안내 (녹음 파일 → 브라우저 한국어 음성) */
  voiceGuide: boolean;
};

export type ManualClosed = { closed: boolean; message: string };

export type AppSettings = {
  storeHours: StoreHours;
  manualClosed: ManualClosed;
  voice: VoiceSettings;
  kiosk: KioskSettings;
};

export type StoreStatus = {
  open: boolean;
  reason: "open" | "manual" | "hours" | "holiday";
  message: string;
  todayHours: DayHours | null;
  nextOpenAt: string | null;
};

export type SessionUser = {
  id: number;
  name: string;
  role: "admin" | "staff";
};

export type ApiErrorCode =
  | "INSUFFICIENT_POINT"
  | "USER_NOT_FOUND"
  | "STORE_CLOSED"
  | "ITEM_SOLD_OUT"
  | "ITEM_UNAVAILABLE"
  | "INVALID_OPTIONS"
  | "PRICE_CHANGED"
  | "PAYMENT_UNAVAILABLE"
  /** 차감 결과를 알 수 없음. 다시 결제하면 이중 차감될 수 있으므로 키오스크는 재시도하지 않는다 */
  | "PAYMENT_UNKNOWN"
  | "INVALID_TRANSITION"
  | "REFUND_FAILED"
  | "UNAUTHORIZED"
  /** 키오스크 기기 토큰이 없거나 서버 토큰과 다름 (키오스크는 저장된 토큰을 지우고 등록 화면으로) */
  | "KIOSK_UNREGISTERED"
  | "FORBIDDEN"
  | "INVALID_CREDENTIALS"
  | "INVALID_PIN"
  | "PIN_NOT_SET"
  /** 결제 비밀번호를 만들려는데 이미 있음 (키오스크는 일반 결제 화면으로) */
  | "PIN_ALREADY_SET"
  /** MIRAEPASS에 가입하지 않은 사용자 (계정 비밀번호 없음) */
  | "NOT_REGISTERED"
  | "PIN_LOCKED"
  | "NOT_FOUND"
  /** 서버 TTS를 쓸 수 없음 (모델 없음·로딩 실패) */
  | "TTS_UNAVAILABLE"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "INTERNAL";

export type OrderCallPayload = {
  orderId: number;
  orderNo: number;
  customerName: string;
  customerType: CustomerType;
  grade: number | null;
  menu: string;
  /** 서버에서 만든 호출 음성 (/api/tts/...). TTS를 쓸 수 없으면 null */
  voiceUrl: string | null;
};

export type ServerToClientEvents = {
  /** voiceUrl: 서버에서 만든 새 주문 안내 음성. TTS를 쓸 수 없으면 null */
  "order:new": (order: OrderDTO, voiceUrl: string | null) => void;
  "order:updated": (order: OrderDTO) => void;
  "order:call": (payload: OrderCallPayload) => void;
  "menu:changed": () => void;
  "store:changed": (status: StoreStatus) => void;
  "settings:changed": () => void;
};

export type ClientToServerEvents = Record<string, never>;

export type StatsResponse = {
  range: { from: string; to: string };
  kpi: {
    revenue: number;
    orders: number;
    avgTicket: number;
    cancelled: number;
    refundFailed: number;
    /** 차감 결과를 확인해야 하는 주문 (기간 무관) */
    paymentUnknown: number;
  };
  daily: { date: string; revenue: number; orders: number }[];
  hourly: { hour: number; orders: number }[];
  topMenus: { name: string; quantity: number; revenue: number }[];
  customerMix: { type: CustomerType; orders: number; revenue: number }[];
};
