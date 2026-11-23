import type { ResumeDocument } from '../model';
import type { RenderTask } from 'pdfjs-dist';
import { getPdfPhoto } from './photo';
import { createThumbnailQueue } from './thumbnailQueue';
import type { OpenPdf, PdfReader } from './pdfReader';

interface WorkerResult { type: 'result' | 'error'; generation: number; blob?: Blob; error?: string }
let worker: Worker | null = null, generation = 0;
let reader: PdfReader | undefined;
function disposeWorker() { worker?.terminate(); worker = null; }
function ensureActive(signal: AbortSignal) { if (signal.aborted) throw new DOMException('Thumbnail cancelled', 'AbortError'); }

async function generatePdf(resume: ResumeDocument, signal: AbortSignal): Promise<Blob> {
  const photoDataUrl = await getPdfPhoto(resume);
  ensureActive(signal);
  worker ??= new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module', name: 'resume-cover-pdf' });
  const instance = worker, current = ++generation;
  return new Promise<Blob>((resolve, reject) => {
    function cleanup() { instance.removeEventListener('message', message); instance.removeEventListener('error', fail); signal.removeEventListener('abort', abort); }
    function message(event: MessageEvent<WorkerResult>) {
      if (event.data.generation !== current) return;
      cleanup();
      if (event.data.type === 'result' && event.data.blob) resolve(event.data.blob);
      else reject(new Error(event.data.error || '封面生成失败'));
    }
    function fail() { cleanup(); disposeWorker(); reject(new Error('封面引擎未能启动')); }
    function abort() { cleanup(); disposeWorker(); reject(new DOMException('Thumbnail cancelled', 'AbortError')); }
    instance.addEventListener('message', message);
    instance.addEventListener('error', fail);
    signal.addEventListener('abort', abort, { once: true });
    const fontBaseUrl = new URL(`${import.meta.env.BASE_URL}fonts/`, window.location.href).href;
    try { instance.postMessage({ type: 'generate', generation: current, document: resume, photoDataUrl, fontBaseUrl }); }
    catch (error) { cleanup(); disposeWorker(); reject(error); }
  });
}

async function renderCover(resume: ResumeDocument, signal: AbortSignal): Promise<Blob> {
  const pdf = await generatePdf(resume, signal);
  ensureActive(signal);
  const { createPdfReader } = await import('./pdfReader');
  ensureActive(signal);
  let file: OpenPdf | undefined, rendering: RenderTask | undefined;
  const canvas = document.createElement('canvas');
  const abort = () => { rendering?.cancel(); void file?.release(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const data = await pdf.arrayBuffer();
    ensureActive(signal);
    reader ??= createPdfReader();
    file = reader.open(data);
    const document = await file.ready;
    ensureActive(signal);
    const page = await document.getPage(1);
    ensureActive(signal);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 420 / base.width });
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('当前浏览器无法生成封面');
    rendering = page.render({ canvas, canvasContext: context, viewport });
    await rendering.promise;
    ensureActive(signal);
    const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('封面生成失败')), 'image/webp', .88));
    ensureActive(signal);
    return image;
  } finally {
    signal.removeEventListener('abort', abort);
    canvas.width = 0; canvas.height = 0;
    await file?.release();
  }
}

// A single queue serves every visible card. It retains only small raster images
// in memory, never PDF blobs or a second persistent copy of a user's resume.
const covers = createThumbnailQueue(renderCover, { onIdle() {
  disposeWorker();
  void reader?.close();
  reader = undefined;
} });
export const requestResumeThumbnail = covers.request;

/** A bounded image cache should also have bounded keys, even for long resumes. */
export async function coverCacheKey(paper: ResumeDocument): Promise<string> {
  const contents = JSON.stringify(paper);
  if (!globalThis.crypto?.subtle) return contents;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contents));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
