import { useEffect, useRef, useState } from 'react';
import type { ResumeDocument } from '../model';
import { getAsset } from '../lib/storage';
import { normalizePdfPhoto } from './photo';
import { usePdfInput } from './usePdfInput';

export interface ResumePdfState { blob: Blob | null; previewBlob: Blob | null; loading: boolean; error: string | null; generation: number }
interface SourcedPdfState extends ResumePdfState { sourceDocument: ResumeDocument | null }
interface WorkerResult { type: 'result' | 'error'; generation: number; blob?: Blob; error?: string }
const EMPTY: ResumePdfState = { blob: null, previewBlob: null, loading: false, error: null, generation: 0 };

/** Debounces edits and rejects late worker replies so an older resume can never replace the current one. */
export function useResumePdf(resume: ResumeDocument | null): ResumePdfState {
  const document = usePdfInput(resume);
  const [state, setState] = useState<SourcedPdfState>({ ...EMPTY, sourceDocument: null });
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const requestSource = useRef<ResumeDocument | null>(document);
  const workerFailure = useRef<string | null>(null);
  const photos = useRef(new Map<string, string>());
  const enabled = document !== null;
  useEffect(() => {
    if (!enabled) return;
    workerFailure.current = null;
    let instance: Worker;
    try { instance = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module', name: 'resume-pdf' }); }
    catch {
      workerFailure.current = '排版引擎未能启动，请在浏览器中重新打开页面';
      setState(previous => ({ ...previous, blob: null, loading: false, error: workerFailure.current, sourceDocument: requestSource.current }));
      return;
    }
    worker.current = instance;
    instance.onmessage = (event: MessageEvent<WorkerResult>) => {
      const result = event.data;
      if (result.generation !== generation.current) return;
      if (result.type === 'result' && result.blob) setState({ sourceDocument: requestSource.current, blob: result.blob, previewBlob: result.blob, loading: false, error: null, generation: result.generation });
      else if (result.type === 'error') setState(previous => ({ ...previous, blob: null, loading: false, error: result.error || 'PDF 生成失败，请重试', generation: result.generation }));
    };
    instance.onerror = event => {
      console.error('PDF worker', event.message, event.filename, event.lineno);
      workerFailure.current = '排版引擎加载失败，请刷新页面重试';
      setState(previous => ({ ...previous, blob: null, loading: false, error: workerFailure.current }));
    };
    return () => { generation.current++; instance.terminate(); worker.current = null; };
  }, [enabled]);
  useEffect(() => {
    const current = ++generation.current;
    requestSource.current = document;
    if (!document) { photos.current.clear(); setState({ ...EMPTY, sourceDocument: null }); return; }
    if (workerFailure.current) {
      setState({ ...EMPTY, sourceDocument: document, error: workerFailure.current, generation: current });
      return;
    }
    setState(previous => ({ ...EMPTY, sourceDocument: document, loading: true, generation: current,
      previewBlob: previous.sourceDocument?.id === document.id ? previous.previewBlob : null }));
    const timeout = window.setTimeout(() => {
      void (async () => {
        let photoDataUrl: string | undefined;
        if (document.profile.photoId && document.layout.showPhoto) {
          const id = document.profile.photoId;
          photoDataUrl = photos.current.get(id);
          if (!photoDataUrl) {
            const asset = await getAsset(id);
            if (current !== generation.current) return;
            if (asset) {
              photoDataUrl = await normalizePdfPhoto(asset.blob);
              if (current !== generation.current) return;
              photos.current.set(id, photoDataUrl);
              if (photos.current.size > 8) photos.current.delete(photos.current.keys().next().value!);
            }
          }
        }
        if (current !== generation.current) return;
        if (workerFailure.current || !worker.current) throw new Error(workerFailure.current || '排版引擎未就绪，请刷新页面重试');
        const fontBaseUrl = new URL(`${import.meta.env.BASE_URL}fonts/`, window.location.href).href;
        worker.current?.postMessage({ type: 'generate', generation: current, document, photoDataUrl, fontBaseUrl });
      })().catch(error => {
        if (current === generation.current) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : '无法载入照片' }));
      });
    }, 280);
    return () => window.clearTimeout(timeout);
  }, [document]);
  if (!document) return EMPTY;
  // Effects run after paint. Bind availability to the source object during render
  // so even the first render of an edit cannot expose the previous PDF to export.
  if (state.sourceDocument !== document) return { ...EMPTY, loading: true, generation: state.generation,
    previewBlob: state.sourceDocument?.id === document.id ? state.previewBlob : null };
  return state;
}
