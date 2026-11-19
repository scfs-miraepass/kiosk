/**
 * 키오스크(라즈베리파이 4B + Chromium) 공통 스타일.
 *
 * backdrop-filter(blur)는 뒤 화면이 한 프레임이라도 바뀌면 매 프레임 흐림을 다시 계산한다.
 * 라즈베리파이 GPU(VideoCore VI)에서는 이게 전체 화면 크기로 일어나면서 애니메이션이 끊기고 터치 반응이 늦어졌다.
 * 그래서 키오스크의 오버레이는 흐림 없이 반투명 단색으로만 어둡게 한다.
 */
export const KIOSK_OVERLAY = "bg-slate-900/45 supports-backdrop-filter:backdrop-blur-none";
