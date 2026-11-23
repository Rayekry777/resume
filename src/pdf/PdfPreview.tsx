import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { createPdfReader, type OpenPdf, type PdfReader } from './pdfReader';

export interface PdfPreviewProps { blob: Blob | null; loading: boolean; error?: string; onPageCount?: (count: number) => void; className?: string; scale?: number }

function PdfPage({ document, number, scale }: { document: PDFDocumentProxy; number: number; scale: number }): React.ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const raster = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(595);
  const [ratio, setRatio] = useState(297 / 210);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = container.current;
    const host = raster.current;
    if (!element) return;
    let timeout: number | undefined;
    const measure = () => { if (element.clientWidth > 0) setWidth(Math.max(180, element.clientWidth)); };
    measure();
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(measure, 100);
    });
    resize?.observe(element);
    const intersection = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(
      entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '350px 0px' });
    if (intersection) intersection.observe(element); else setVisible(true);
    return () => { window.clearTimeout(timeout); resize?.disconnect(); intersection?.disconnect(); if (host) clearRaster(host); };
  }, []);
  useEffect(() => {
    const host = raster.current;
    if (!host) return;
    if (!visible) { clearRaster(host); return; }
    let disposed = false;
    let task: RenderTask | undefined;
    let page: PDFPageProxy | undefined;
    let target: HTMLCanvasElement | undefined;
    setError('');
    void document.getPage(number).then(nextPage => {
      if (disposed) return;
      page = nextPage;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const viewport = page.getViewport({ scale: width / base.width });
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      target = window.document.createElement('canvas');
      target.width = Math.ceil(viewport.width * dpr);
      target.height = Math.ceil(viewport.height * dpr);
      target.style.cssText = 'display:block;width:100%;height:100%';
      target.setAttribute('aria-label', `第 ${number} 页内容`);
      const context = target.getContext('2d', { alpha: false });
      if (!context) throw new Error('无法创建页面预览');
      task = page.render({ canvas: target, canvasContext: context, viewport, transform: [dpr, 0, 0, dpr, 0, 0] });
      return task.promise.then(() => {
        if (disposed || !target) return;
        // Swap only the finished image. Typed edits and resizes leave the
        // previous complete page visible while PDF.js paints a new canvas.
        clearRaster(host);
        host.replaceChildren(target);
        target = undefined;
      });
    }).catch(reason => {
      if (!disposed && reason?.name !== 'RenderingCancelledException') setError('这一页暂时无法预览，请重新打开简历');
    }).finally(() => {
      if (target) { target.width = 0; target.height = 0; }
    });
    return () => { disposed = true; task?.cancel(); void page?.cleanup(); };
  }, [document, number, visible, width]);
  return <div className="pdf-page" ref={container} style={{ position: 'relative', width: `${scale * 100}%`, maxWidth: 'none', aspectRatio: `1 / ${ratio}`, background: '#fff', boxShadow: '0 3px 18px #29313d14', margin: '0 auto 22px', flexShrink: 0 }} aria-label={`简历第 ${number} 页`}>
    <div ref={raster} style={{ width: '100%', height: '100%' }} />
    {error && <p role="alert" style={{ position: 'absolute', inset: '40% 12px auto', fontSize: 13, color: '#9d4b50' }}>{error}</p>}
    <span style={{ position: 'absolute', bottom: 1, left: 'calc(100% + 5px)', fontSize: 10, color: '#9ba2ae' }} aria-hidden="true">{number}</span>
  </div>;
}

function clearRaster(host: HTMLDivElement) {
  const old = host.firstElementChild as HTMLCanvasElement | null;
  if (old) { old.remove(); old.width = 0; old.height = 0; }
}

export function PdfPreview({ blob, loading, error, onPageCount, className = '', scale = 1 }: PdfPreviewProps): React.ReactElement {
  const [loaded, setLoaded] = useState<{ document: PDFDocumentProxy; file: OpenPdf; blob: Blob } | null>(null);
  const document = loaded?.document ?? null;
  const [loadError, setLoadError] = useState('');
  const callback = useRef(onPageCount);
  callback.current = onPageCount;
  const reader = useRef<PdfReader | undefined>(undefined);
  useEffect(() => {
    const session = createPdfReader();
    reader.current = session;
    return () => { reader.current = undefined; void session.close(); };
  }, []);
  useEffect(() => () => { if (loaded) void loaded.file.release(); }, [loaded]);
  useEffect(() => {
    if (!blob) { setLoaded(null); setLoadError(''); callback.current?.(0); return; }
    let disposed = false;
    let handedToPreview = false;
    let file: OpenPdf | undefined;
    setLoadError('');
    void blob.arrayBuffer().then(data => {
      if (disposed || !reader.current) return;
      file = reader.current.open(data);
      return file.ready;
    }).then(nextDocument => {
      if (!nextDocument) return;
      if (disposed) return;
      handedToPreview = true;
      setLoaded({ document: nextDocument, file: file!, blob });
      callback.current?.(nextDocument.numPages);
    }).catch(reason => {
      void file?.release();
      if (!disposed) setLoadError(reason instanceof Error ? reason.message : '预览加载失败');
    });
    return () => { disposed = true; if (!handedToPreview) void file?.release(); };
  }, [blob]);
  const shownError = error || loadError;
  const updating = !shownError && (loading || (!!blob && loaded?.blob !== blob));
  return <div className={`pdf-preview ${className}`} aria-busy={updating} style={{ position: 'relative', width: '100%', minWidth: 0 }}>
    {shownError && <div role="alert" className="pdf-error" style={{ padding: 14, marginBottom: 14, color: '#9d4b50', background: '#fff3f2', borderRadius: 8 }}>排版遇到问题：{shownError}</div>}
    {!document && !shownError && <div className="pdf-placeholder" style={{ background: 'white', aspectRatio: '210 / 297', display: 'grid', placeItems: 'center', color: '#8a93a3', fontSize: 14 }}>{loading ? '正在排版你的简历…' : '简历预览'}</div>}
    {document && updating && <span role="status" style={{ position:'absolute', top:8, right:8, zIndex:1, padding:'3px 8px', borderRadius:4, background:'#f5f6fb', color:'#525b70', fontSize:12 }}>正在更新预览…</span>}
    {document && Array.from({ length: document.numPages }, (_, index) => <PdfPage key={index} document={document} number={index + 1} scale={scale} />)}
  </div>;
}

export default PdfPreview;
