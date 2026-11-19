"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * 길게 누르기(ms 동안 손을 떼지 않음). 손님이 우연히 누르지 않을 관리용 숨은 동작에 쓴다.
 * 길게 누르기가 실행되면 손을 뗄 때 생기는 click은 막아서 원래 버튼 동작(예: 처음으로)이 같이 일어나지 않게 한다.
 * 손가락이 조금 움직여도 브라우저가 스크롤로 가져가며 취소하지 않도록 대상에 touch-action: none(`touch-none`)을 주는 것을 권장한다.
 */
export function useLongPress(onLongPress: () => void, ms = 5000) {
  const cb = useRef(onLongPress);
  useEffect(() => {
    cb.current = onLongPress;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  return useMemo(
    () => ({
      onPointerDown: () => {
        cancel();
        fired.current = false;
        timer.current = setTimeout(() => {
          fired.current = true;
          cb.current();
        }, ms);
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      // 터치로 길게 누르면 뜨는 메뉴(컨텍스트 메뉴)를 막는다
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      onClickCapture: (e: React.MouseEvent) => {
        if (!fired.current) return;
        fired.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
    [cancel, ms],
  );
}
