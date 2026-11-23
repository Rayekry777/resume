import { GlobalWorkerOptions, getDocument, PDFWorker } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

/** An editor, or one batch of covers, shares a parser until its last task closes. */
export function createPdfReader() {
  let closed = false;
  let worker: PDFWorker | undefined;
  const documents = new Set<() => Promise<void>>();
  return {
    open(data: ArrayBuffer) {
      if (closed) throw new Error('PDF 预览已关闭');
      worker ??= new PDFWorker();
      const task = getDocument({ data, worker });
      let closing: Promise<void> | undefined;
      function release() {
        // PDF.js needs its live worker to acknowledge each document's disposal.
        closing ??= task.destroy().catch(() => undefined).finally(() => documents.delete(release));
        return closing;
      }
      documents.add(release);
      return { ready: task.promise, release };
    },
    async close() {
      closed = true;
      await Promise.all(Array.from(documents, release => release()));
      worker?.destroy();
      worker = undefined;
    },
  };
}
export type PdfReader = ReturnType<typeof createPdfReader>;
export type OpenPdf = ReturnType<PdfReader['open']>;
