import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

const publicFile = (url: string) => path.join(import.meta.dirname, "..", "public", url);
const manifest = JSON.parse(readFileSync(publicFile("staff.webmanifest"), "utf8")) as {
  start_url: string;
  scope: string;
  icons: { src: string; sizes: string; purpose?: string }[];
};
const sw = readFileSync(publicFile("staff-sw.js"), "utf8");

/** proxy matcher("/staff/:path*")가 잡는 경로인지 */
const protectedByProxy = (url: string) =>
  config.matcher.some((m) => new RegExp(`^${m.replace("/:path*", "(/.*)?")}$`).test(url));

describe("직원 화면 PWA", () => {
  it("시작 주소가 scope 안에 있고 직원 화면이다", () => {
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    expect(manifest.scope).toBe("/staff");
  });

  it("설치에 필요한 192·512 아이콘과 maskable 아이콘이 있다", () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) expect(existsSync(publicFile(icon.src))).toBe(true);
  });

  it("서비스 워커가 캐시하는 오프라인 페이지가 있다", () => {
    const offline = /OFFLINE_URL = "([^"]+)"/.exec(sw)?.[1];
    expect(offline).toBeTruthy();
    expect(existsSync(publicFile(offline!))).toBe(true);
  });

  it("매니페스트·서비스 워커·오프라인 페이지는 로그인 없이 받을 수 있다", () => {
    expect(protectedByProxy("/staff")).toBe(true);
    expect(protectedByProxy("/staff/login")).toBe(true);
    for (const url of ["/staff.webmanifest", "/staff-sw.js", "/staff-offline.html", ...manifest.icons.map((i) => i.src)]) {
      expect(protectedByProxy(url)).toBe(false);
    }
  });
});
