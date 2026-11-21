/**
 * 직원 화면(PWA) 서비스 워커. scope: /staff
 *
 * 주문 처리는 실시간 연결이 필수라 화면·API를 캐시하지 않는다.
 * 서버에 닿지 않을 때 빈 오류 화면 대신 안내 페이지만 보여 준다.
 * 오프라인 페이지를 바꾸면 CACHE 버전을 올린다.
 */
const CACHE = "staff-offline-v1";
const OFFLINE_URL = "/staff-offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("staff-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
