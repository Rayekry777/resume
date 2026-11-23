import { pdf } from '@react-pdf/renderer';
import type { ResumeDocument } from '../model';
import { prepareResumeWrapping, registerResumeFonts, ResumePdf } from './ResumePdf';

interface GenerateRequest { type: 'generate'; generation: number; document: ResumeDocument; photoDataUrl?: string; fontBaseUrl: string }
const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let queued: GenerateRequest | null = null;
let running = false;

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queued) {
      const request = queued;
      queued = null;
      try {
        registerResumeFonts({
          regular: new URL('Chinese-Regular.ttf', request.fontBaseUrl).href,
          bold: new URL('Chinese-Bold.ttf', request.fontBaseUrl).href,
          italic: new URL('Chinese-Italic.woff', request.fontBaseUrl).href,
          boldItalic: new URL('Chinese-BoldItalic.woff', request.fontBaseUrl).href,
        });
        await prepareResumeWrapping(request.document);
        const blob = await pdf(ResumePdf({ document: request.document, photoDataUrl: request.photoDataUrl })).toBlob();
        workerScope.postMessage({ type: 'result', generation: request.generation, blob });
      } catch (error) {
        workerScope.postMessage({ type: 'error', generation: request.generation, error: error instanceof Error ? error.message : 'PDF 生成失败' });
      }
    }
  } finally { running = false; }
}
workerScope.onmessage = (event: MessageEvent<GenerateRequest>) => {
  if (event.data?.type !== 'generate') return;
  queued = event.data;
  void drain();
};
