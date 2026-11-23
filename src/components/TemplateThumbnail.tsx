import { useEffect, useRef, useState } from 'react';
import type { ResumeDocument, TemplateDefinition } from '../model';
import type { ThumbnailRequest } from '../pdf/thumbnailQueue';
import { canonicalCatalogId } from '../templateReferences';
import { usePdfInput } from '../pdf/usePdfInput';

function DocumentThumbnail({ resume }: { resume: ResumeDocument }) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ source: ResumeDocument; url: string }>();
  const [error, setError] = useState('');
  const paper = usePdfInput(visible ? resume : null);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => {
    if (!element.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '0px' });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setResult(undefined);
    if (!paper) return;
    let disposed = false, request: ThumbnailRequest | undefined;
    setError('');
    void import('../pdf/resumeThumbnail').then(async ({ requestResumeThumbnail, coverCacheKey }) => {
      if (disposed) return;
      const key = await coverCacheKey(paper);
      if (disposed) return;
      request = requestResumeThumbnail(key, paper);
      return request.promise;
    }).then(blob => {
      if (!blob || disposed) return;
      const url = URL.createObjectURL(blob);
      setResult({ source: paper, url });
    }).catch(reason => { if (!disposed && reason?.name !== 'AbortError') setError('封面暂时无法显示'); });
    return () => { disposed = true; request?.cancel(); };
  }, [paper]);
  const current = result?.source === paper ? result.url : undefined;
  return <div ref={element} className="resume-pdf-cover" aria-hidden="true" title={error || undefined} style={{ width: '100%', minHeight: '100%', aspectRatio: '210 / 297', background: '#fff', overflow: 'hidden' }}>
    {current && <img src={current} className="template-pdf-thumbnail" alt="" decoding="async"/>}
  </div>;
}

export default function TemplateThumbnail({ template, document: resume, legacyMarkdown = false, large = false }: { template: TemplateDefinition; document?: ResumeDocument; legacyMarkdown?: boolean; large?: boolean }) {
  if (resume) return <DocumentThumbnail resume={resume}/>;
  return <img className={`template-pdf-thumbnail ${large ? 'thumbnail-large' : ''}`} src={`${import.meta.env.BASE_URL}template-previews/${legacyMarkdown ? 'md-legacy-neat' : canonicalCatalogId(template.id)}.webp`} alt="" aria-hidden="true" loading="lazy" decoding="async"/>;
}
