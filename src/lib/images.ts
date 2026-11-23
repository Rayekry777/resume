import type { ResumeAsset } from '../model';

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export type SupportedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export function sniffImageType(bytes: Uint8Array): SupportedImageType | undefined {
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return undefined;
}

export async function validateImageBlob(blob: Blob): Promise<SupportedImageType> {
  if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('照片不能为空且不能超过 12 MB');
  const type = sniffImageType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
  if (!type) throw new Error('请选择 JPG、PNG 或 WebP 图片，不支持 SVG 或其他文件');
  return type;
}

async function decodeImage(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const image = await createImageBitmap(blob);
    return { source: image, width: image.width, height: image.height, close: () => image.close() };
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = objectUrl; await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(objectUrl) };
  } catch { URL.revokeObjectURL(objectUrl); throw new Error('无法读取这张照片，请换一张 JPG 或 PNG 图片'); }
}

/** Decode only a user-provided Blob and reduce it to a compact local portrait. */
export async function processPhoto(file: File | Blob): Promise<ResumeAsset> {
  await validateImageBlob(file);
  let image: Awaited<ReturnType<typeof decodeImage>>;
  try { image = await decodeImage(file); } catch { throw new Error('照片格式损坏或浏览器无法解码，请换一张图片'); }
  try {
    if (!image.width || !image.height || image.width * image.height > 40_000_000) throw new Error('照片分辨率过大，请选择小于 4000 万像素的图片');
    const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
    let blob: Blob;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法处理图片');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); context.drawImage(image.source, 0, 0, width, height);
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
    } else {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器无法处理图片');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); context.drawImage(image.source, 0, 0, width, height);
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('照片压缩失败')), 'image/jpeg', 0.88));
    }
    const originalName = 'name' in file && typeof file.name === 'string' ? file.name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') : '照片';
    return { id: crypto.randomUUID(), name: `${originalName.slice(0, 100) || '照片'}.jpg`, blob, createdAt: Date.now() };
  } finally { image.close(); }
}

export const prepareImage = processPhoto;
