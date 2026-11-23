import { zipSync } from 'fflate';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

function cleanName(name: string): string { return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100) || '我的简历'; }
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Mobile browsers may consume a download asynchronously after the click handler.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export function pdfFilename(title: string): string { return `${cleanName(title)}.pdf`; }
type PdfPicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;
export function pdfSavePicker(): PdfPicker | undefined {
  const picker = (window as Window & { showSaveFilePicker?: PdfPicker }).showSaveFilePicker;
  return typeof picker === 'function' ? picker.bind(window) : undefined;
}
export async function savePdfAs(blob: Blob, title: string, chooseFile: PdfPicker): Promise<void> {
  const file = await chooseFile({ suggestedName: pdfFilename(title), types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
  const writer = await file.createWritable();
  try {
    await writer.write(blob);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}
export async function downloadPngZip(blob: Blob, title: string, onProgress?: (completed: number, total: number) => void): Promise<void> {
  GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = getDocument({ data: await blob.arrayBuffer() });
  const pdf = await loadingTask.promise;
  const files: Record<string, Uint8Array> = {};
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      // A4 at 2x is readable without allocating a huge multipage bitmap on phones.
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('当前浏览器无法导出图片');
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片生成失败')), 'image/png'));
      files[`${cleanName(title)}-${String(number).padStart(2, '0')}.png`] = new Uint8Array(await image.arrayBuffer());
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      onProgress?.(number, pdf.numPages);
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    }
    const zip = zipSync(files, { level: 0 });
    saveBlob(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${cleanName(title)}-图片.zip`);
  } finally { await loadingTask.destroy(); }
}
export const downloadPngPages = downloadPngZip;
