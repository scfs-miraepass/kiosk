/**
 * 메뉴 이미지를 올리기 전에 브라우저에서 줄인다.
 *
 * 키오스크(라즈베리파이 4B)는 메뉴 화면에 들어갈 때마다 이미지를 디코딩하는데,
 * 휴대폰 원본 사진(4000px, 수 MB)은 장당 디코딩에 수백 ms·수십 MB 메모리가 들어 화면 전환이 끊긴다.
 * 카드에 보이는 크기는 최대 500px 남짓이므로 긴 변 MAX_EDGE로 줄여 WebP로 저장한다.
 * 움직이는 GIF는 프레임이 사라지므로 그대로 두고, 줄여도 더 작아지지 않으면 원본을 쓴다.
 */
const MAX_EDGE = 800;
const QUALITY = 0.82;

export async function resizeImageForUpload(file: File): Promise<File> {
  if (file.type === "image/gif" || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));
    // WebP 인코딩을 지원하지 않는 브라우저는 PNG를 돌려주므로 그때는 원본 유지
    if (!blob || blob.type !== "image/webp" || (scale === 1 && blob.size >= file.size)) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
