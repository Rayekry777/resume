// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { waitForReact } from './waitForReact';
import { createTemplateResume } from '../src/markdownTemplateResume';
import { ADDITIONAL_TEMPLATES, canonicalCatalogId, MARKDOWN_TEMPLATES } from '../src/markdownTemplates';
import { TEMPLATES } from '../src/templates';
import { getEditorMode, getMarkdownSource } from '../src/lib/markdown';
import { getResume, setSetting } from '../src/lib/storage';
import { getPresentationMode, type ResumeDocument } from '../src/model';

vi.mock('../src/pwa/PwaStatus', () => ({ default: () => null }));
vi.mock('../src/components/TemplateThumbnail', () => ({ default: () => null }));
vi.mock('../src/components/ResumeEditor', () => ({
  default: ({document, onTemplates}: {document: ResumeDocument; onTemplates: () => void}) =>
    <section aria-label="已打开的简历"><span>{document.templateId}</span><button onClick={onTemplates}>选风格</button></section>,
}));

afterEach(() => vi.unstubAllGlobals());

function content(document: ResumeDocument) {
  return document.sections.map(({id: _id, items, ...section}) => ({
    ...section, items: items.map(({id: _itemId, ...item}) => item),
  }));
}

it('opens every design with the same content and layout in both editors', () => {
  for (const template of [...TEMPLATES, ...MARKDOWN_TEMPLATES]) {
    const form = createTemplateResume(template.id, true, 'visual');
    const markdown = createTemplateResume(template.id, true, 'markdown');
    const designId = canonicalCatalogId(template.id);
    expect([form.templateId, markdown.templateId]).toEqual([designId, designId]);
    expect([getEditorMode(form), getEditorMode(markdown)]).toEqual(['visual','markdown']);
    expect(markdown.markdownView).toBe('source');
    expect(getPresentationMode(markdown)).toBe(getPresentationMode(form));
    expect(markdown.profile).toEqual(form.profile);
    expect(markdown.layout).toEqual(form.layout);
    expect(content(markdown)).toEqual(content(form));
    expect(getMarkdownSource(markdown)).toContain(form.profile.name);
  }
});

it('offers either editor for regular templates in the shared library and keeps the Markdown entry on page one only', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('scrollTo',()=>{});
  history.replaceState(null,'','#/');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  async function click(element: Element | null | undefined) {
    expect(element).toBeTruthy();
    await act(async () => { (element as HTMLButtonElement).click(); });
  }
  const find = (text: string) => [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === text);
  try {
    await setSetting('favorites',['md-generous','elegant','md-graduate-steady']);
    await act(async () => root.render(<App/>));
    const specialCard = '[data-testid="create-markdown"]';
    await waitForReact(()=>expect(container.querySelector(specialCard)).toBeTruthy());
    expect(container.querySelector('.reference-filters summary')?.textContent).toContain('37 款模板');
    await click(find('收藏模板'));
    const favorites = [...container.querySelectorAll('.reference-saved-template .resume-card-title')].map(button => button.textContent);
    expect(favorites).toHaveLength(2);
    expect(favorites).toContain(TEMPLATES.find(template=>template.id==='elegant')!.name);
    expect(favorites).toContain(TEMPLATES.find(template=>template.id==='steady')!.name);
    await click(container.querySelector('[aria-label="下一页模板"]'));
    expect(container.querySelector(specialCard)).toBeNull();
    await click(container.querySelector('[aria-label="上一页模板"]'));
    await click(container.querySelector(specialCard));
    expect(find('Markdown 简历')?.getAttribute('aria-selected')).toBe('true');
    const front = TEMPLATES.find(template => template.id === 'frontend-pro')!;
    await click(container.querySelector(`button[aria-label="预览${front.name}"]`));
    expect(find('用表单编辑')).toBeTruthy();
    await click(find('用 Markdown 编辑'));
    await waitForReact(()=>expect(container.querySelector('[aria-label="已打开的简历"]')).toBeTruthy());
    const id = location.hash.split('/').pop()!;
    const saved = await getResume(id);
    expect(saved).toMatchObject({templateId:'frontend-pro',editorMode:'markdown',presentationMode:'visual',markdownView:'source'});
    expect(getMarkdownSource(saved!)).toContain(saved!.profile.title);
    await click(find('选风格'));
    const styleCards = new Set<string>();
    const pages = container.querySelectorAll('.reference-drawer-pagination button').length;
    for (let page = 1; page <= pages; page++) {
      await click(container.querySelector(`.reference-drawer-pagination button[aria-label="第${page}页"]`));
      container.querySelectorAll('.reference-drawer-card').forEach(card=>styleCards.add(card.getAttribute('data-testid')!));
    }
    for (const template of [...TEMPLATES,...MARKDOWN_TEMPLATES]) expect(styleCards.has('template-' + canonicalCatalogId(template.id))).toBe(true);
    expect(styleCards.size).toBe(37);
    const alternate = ADDITIONAL_TEMPLATES.at(-1)!;
    await click(container.querySelector(`.reference-drawer-card [aria-label="预览${alternate.name}"]`));
    await click(find('使用模板'));
    async function checkCurrentStyle(templateId: string, presentationMode: string) {
      await act(async () => {
        await vi.waitFor(async () => {
          const current = await getResume(id);
          expect(current).toMatchObject({templateId,presentationMode,editorMode:'markdown',markdownView:'source'});
          expect(current!.profile).toEqual(saved!.profile);
          expect(current!.sections).toEqual(saved!.sections);
          expect(current!.markdownSource).toBe(saved!.markdownSource);
        });
      });
    }
    await checkCurrentStyle(alternate.id, 'markdown');
    await click(find('选风格'));
    await click(container.querySelector('.reference-drawer-pagination button[aria-label="第1页"]'));
    await click(container.querySelector(`.reference-drawer-card [aria-label="使用${front.name}"]`));
    await checkCurrentStyle(front.id, 'visual');
  } finally {
    await act(async()=>root.unmount());
    container.remove();
    history.replaceState(null,'','#/');
  }
});
