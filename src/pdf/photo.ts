import type { ResumeDocument } from '../model';
import { getAsset } from '../lib/storage';

/** Normalize every PDF photo through the same browser-only path. */
export async function normalizePdfPhoto(blob: Blob): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取照片，请重新上传'));
    reader.readAsDataURL(blob);
  });
  const image = new Image();
  image.src = source;
  try { await image.decode(); } catch { throw new Error('无法读取照片，请使用 PNG、JPEG 或 WebP 图片'); }
  if (['image/png', 'image/jpeg'].includes(blob.type) && Math.max(image.naturalWidth, image.naturalHeight) <= 800) return source;
  const ratio = Math.min(1, 800 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法处理照片');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL('image/png');
  canvas.width = 0;
  canvas.height = 0;
  return result;
}

export async function getPdfPhoto(document: ResumeDocument): Promise<string | undefined> {
  if (!document.profile.photoId || !document.layout.showPhoto) return undefined;
  const asset = await getAsset(document.profile.photoId);
  return asset ? normalizePdfPhoto(asset.blob) : undefined;
}
