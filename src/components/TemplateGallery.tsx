import { useRef, useState } from 'react';
import type { TemplateDefinition } from '../model';
import { TEMPLATES, getTemplate } from '../templates';
import { ADDITIONAL_TEMPLATES, canonicalCatalogId } from '../markdownTemplates';
import TemplateThumbnail from './TemplateThumbnail';
import '../styles.reference-drawer.css';

const SWITCHING_TEMPLATE_IDS = [
  'frontend-pro', 'neat', 'elegant', 'operations', 'mono', 'minimal',
  'creative', 'engineering', 'professional', 'java-campus', 'organized', 'java-pro',
  'product', 'steady', 'graduate', 'java-intern', 'fresh', 'classic',
  'frontend-campus', 'modern', 'operations-campus', 'frontend-intern',
];
const SWITCHING_TEMPLATES = SWITCHING_TEMPLATE_IDS.flatMap(id => {
  const template = TEMPLATES.find(item => item.id === id);
  return template ? [template] : [];
});

const legacyMarkdown: TemplateDefinition = {
  ...getTemplate('neat'), name: '经典蓝色', tags: ['Markdown'],
};
const templates = [...SWITCHING_TEMPLATES, ...ADDITIONAL_TEMPLATES, legacyMarkdown];
type TemplateMode = 'visual' | 'markdown';
function designMode(template: TemplateDefinition): TemplateMode {
  return template === legacyMarkdown || template.id.startsWith('md-') ? 'markdown' : 'visual';
}

export default function TemplateGallery({ currentTemplateId, currentPresentation, onPreview, onUse }: {
  currentTemplateId: string;
  currentPresentation: TemplateMode;
  onPreview: (template: TemplateDefinition, mode: TemplateMode) => void;
  onUse: (id: string, mode: TemplateMode) => void;
}) {
  const currentIndex = templates.findIndex(template => template.id === canonicalCatalogId(currentTemplateId) &&
    (template.id !== 'neat' || designMode(template) === currentPresentation));
  const [page, setPage] = useState(Math.floor(Math.max(0,currentIndex) / 12) + 1);
  const drawerGallery = useRef<HTMLDivElement>(null);
  const pages = Math.ceil(templates.length / 12);
  function changePage(next: number) {
    setPage(next);
    const container = drawerGallery.current?.closest('.modal-content');
    if (container) container.scrollTop = 0;
  }
  return <div className="reference-drawer-gallery" ref={drawerGallery}>
    <div className="reference-drawer-grid">
      {templates.slice((page - 1) * 12, page * 12).map(template =>
        <article className="reference-drawer-card" key={`${designMode(template)}-${template.id}`} data-testid={`template-${template.id}`}>
          <button className="reference-drawer-cover" aria-label={`使用${template.name}`} aria-pressed={template === templates[currentIndex]} onClick={() => onUse(template.id, designMode(template))}>
            <TemplateThumbnail template={template} legacyMarkdown={template===legacyMarkdown}/>
            <span className="reference-drawer-cover-overlay" aria-hidden="true"><span>使用</span></span>
          </button>
          <div className="reference-drawer-caption">
            <h3><button aria-label={`预览${template.name}`} onClick={() => onPreview(template, designMode(template))}>{template.name}</button></h3>
            <div className="reference-drawer-tags">{template.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
          </div>
        </article>)}
    </div>
    {pages > 1 && <nav className="reference-drawer-pagination" aria-label="模板分页">
      {Array.from({length: pages}, (_, index) => index + 1).map(item =>
        <button key={item} className={page === item ? 'selected' : ''} aria-label={`第${item}页`}
          aria-current={page === item ? 'page' : undefined} onClick={() => changePage(item)}>{item}</button>)}
    </nav>}
  </div>;
}
