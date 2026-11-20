import path from "node:path";

export const UPLOAD_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * `/uploads/<파일명>?...` 요청 경로에서 서빙할 파일명과 MIME을 꺼낸다.
 * 디렉터리 이동(../)은 basename으로 막고, 잘못된 퍼센트 인코딩(%E0%A4%A 등)이나
 * 허용하지 않는 확장자면 null. (decodeURIComponent 예외가 요청 처리 밖으로 새면 서버가 멈춘다)
 */
export function parseUploadPath(url: string): { name: string; type: string } | null {
  const raw = url.split("?")[0].slice("/uploads/".length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const name = path.basename(decoded);
  const type = UPLOAD_MIME[path.extname(name).toLowerCase()];
  if (!name || !type) return null;
  return { name, type };
}
