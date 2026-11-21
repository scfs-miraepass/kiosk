import type { Metadata, Viewport } from "next";
import { StaffServiceWorker } from "@/components/staff/install-app";

/**
 * 직원 화면은 PWA로 설치해 쓴다 (scope: /staff, 로그인 화면 포함).
 * 매니페스트·서비스 워커는 public에 두어 proxy의 로그인 검사를 거치지 않게 한다.
 */
export const metadata: Metadata = {
  manifest: "/staff.webmanifest",
  icons: { icon: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "미래카페 직원", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
};

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StaffServiceWorker />
      {children}
    </>
  );
}
