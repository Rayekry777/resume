import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { type ResumeDocument, type RichNode, getPresentationMode } from '../src/model';
import { createResume, newItem, newSection } from '../src/sample';
import { exportBackup, importBackup } from '../src/lib/backup';
import { getResume, saveResume } from '../src/lib/storage';
import { analyzeMarkdownSource } from '../src/lib/markdownSource';
import { getMarkdownSource, getSourceStatus, parseMarkdown, readMarkdownFile, switchEditingView, updateMarkdownSource } from '../src/lib/markdown';
import { ResumePdf, prepareResumeWrapping, registerResumeFonts } from '../src/pdf/ResumePdf';
import { TEMPLATES } from '../src/templates';
import { MARKDOWN_TEMPLATES, canonicalCatalogId } from '../src/markdownTemplates';

function styledResume() {
  const document = createResume('neat', false);
  const first = newSection('custom'), second = newSection('custom'), empty = newSection('custom');
  first.title = second.title = empty.title = '项目';
  const paragraph: RichNode = {
    type: 'paragraph', attrs: { textAlign: 'center', indent: 2 },
    content: [{ type: 'text', text: '重点', marks: [{ type: 'underline' }, { type: 'textStyle', attrs: { color: '#ff0000', fontSize: '17pt' } }] }],
  };
  first.items = [{ ...newItem(), title: '经历甲', description: { type: 'doc', content: [paragraph, { type: 'paragraph', content: [{ type: 'text', text: '原有文字' }] }] } }];
  second.items = [{ ...newItem(), title: '经历乙', description: { type: 'doc', content: [structuredClone(paragraph)] } }];
  empty.items = [];
  document.sections = [first, empty, second];
  document.layout.marginLeft = 12;
  return document;
}

async function pdfCoordinates(document: ResumeDocument) {
  await prepareResumeWrapping(document);
  const pdf = await renderToBuffer(ResumePdf({ document }));
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false });
  try {
    const doc = await task.promise;
    return await Promise.all(Array.from({ length: doc.numPages }, async (_, index) => {
      const text = await (await doc.getPage(index + 1)).getTextContent();
      return text.items.flatMap(item => 'str' in item ? [{ str: item.str, transform: item.transform, width: item.width }] : []);
    }));
  } finally { await task.destroy(); }
}

describe('source and form views of one resume', () => {
  it('keeps the chosen paper and editor across a source edit and reload for every template', async () => {
    const nativeIds = new Set(MARKDOWN_TEMPLATES.map(template => template.id));
    for (const template of [...TEMPLATES, ...MARKDOWN_TEMPLATES]) {
      const original = nativeIds.has(template.id)
        ? switchEditingView(parseMarkdown(`@[template](${template.id})\n@[name](示例姓名)\n## 简介\nMixed 中文`).document)
        : createResume(template.id);
      const visual = { ...original, layout: { ...original.layout, marginLeft: 31.25 } };
      const sourceMode = switchEditingView(visual);
      expect(sourceMode.markdownView).toBe('source');
      expect(sourceMode.sections).toEqual(visual.sections);
      expect(sourceMode.layout).toEqual(visual.layout);
      const text = getMarkdownSource(sourceMode).replace(`@[name](${visual.profile.name})`, '@[name](更新姓名)');
      const edit = updateMarkdownSource(sourceMode, text);
      expect(edit.previewStale).toBe(false);
      const saved = await saveResume(edit.document);
      const reopened = (await getResume(saved.id))!;
      expect(reopened.profile.name).toBe('更新姓名');
      expect(reopened).toMatchObject({ editorMode: 'markdown', markdownView: 'source', templateId: canonicalCatalogId(template.id), markdownSource: text });
      expect(reopened.layout).toEqual(visual.layout);
      expect(getPresentationMode(reopened)).toBe(getPresentationMode(visual));
      const form = await saveResume(switchEditingView(reopened));
      expect((await getResume(form.id))?.editorMode).toBe('visual');
      expect(form.templateId).toBe(canonicalCatalogId(template.id));
      expect(form.sections).toEqual(reopened.sections);
      expect(form.layout).toEqual(reopened.layout);
    }
  });

  it('distinguishes the two classic designs when importing generated visual Markdown', () => {
    const form = createResume('neat', false);
    const imported = parseMarkdown(getMarkdownSource(switchEditingView(form))).document;
    expect(imported.editorMode).toBe('markdown');
    expect(getPresentationMode(imported)).toBe('visual');
    expect(imported.layout).toEqual(form.layout);
    expect(getPresentationMode(parseMarkdown('@[template](neat)').document)).toBe('markdown');
  });

  it('keeps identical PDF text coordinates going to either view and back', async () => {
    registerResumeFonts({ regular: resolve('public/fonts/Chinese-Regular.ttf'), bold: resolve('public/fonts/Chinese-Bold.ttf') });
    for (const document of [styledResume(), parseMarkdown('@[name](示例)\n:::project\n@[name](经历)\n正文\n:::').document]) {
      const coordinates = await pdfCoordinates(document);
      const otherView = switchEditingView(document);
      expect(getPresentationMode(otherView)).toBe(getPresentationMode(document));
      expect(otherView.sections).toEqual(document.sections);
      expect(otherView.layout).toEqual(document.layout);
      expect(await pdfCoordinates(otherView)).toEqual(coordinates);
      expect(await pdfCoordinates(switchEditingView(otherView))).toEqual(coordinates);
    }
  });

  it('preserves empty and same-named sections, IDs, and unaffected rich paragraphs after source edits', () => {
    const base = styledResume();
    const original = switchEditingView(base);
    const change = updateMarkdownSource(original, getMarkdownSource(original).replace('原有文字', '新文字'));
    expect(change.previewStale).toBe(false);
    expect(change.document.sections.map(section => section.id)).toEqual(base.sections.map(section => section.id));
    expect(change.document.sections.slice(1)).toEqual(base.sections.slice(1));
    const item = change.document.sections[0].items[0], before = base.sections[0].items[0];
    expect(item.id).toBe(before.id);
    expect(item.description.content?.[0]).toEqual(before.description.content?.[0]);
    expect(item.description.content?.[1].content?.[0].text).toBe('新文字');
    expect(change.document.layout).toEqual(base.layout);
    expect(getPresentationMode(change.document)).toBe('visual');
    const inParagraph = updateMarkdownSource(change.document, getMarkdownSource(change.document).replace('重点', '重点已更新'));
    const editedParagraph = inParagraph.document.sections[0].items[0].description.content![0];
    expect(editedParagraph.attrs).toEqual(before.description.content![0].attrs);
    expect(editedParagraph.content![0]).toEqual(before.description.content![0].content![0]);
    expect(editedParagraph.content!.map(node => node.text).join('')).toBe('重点已更新');
  });

  it('rechecks invalid drafts after saving, reopening and restoring a ZIP, then releases a corrected draft', async () => {
    const base = switchEditingView(styledResume());
    const source = getMarkdownSource(base);
    const broken = updateMarkdownSource(base, '@[profileExtra](invalid)\n' + source);
    const saved = await saveResume(broken.document);
    const reopened = (await getResume(saved.id))!;
    const restored = (await importBackup(await exportBackup([reopened]))).documents[0];
    for (const document of [broken.document, reopened, restored]) {
      expect(getSourceStatus(document).previewStale).toBe(true);
      expect(getMarkdownSource(document)).toBe(broken.document.markdownSource);
      expect(document.sections).toEqual(base.sections);
      const repaired = updateMarkdownSource(document, source);
      expect(getSourceStatus(repaired.document).previewStale).toBe(false);
      expect(repaired.document.sections).toEqual(base.sections);
    }
  });

  it('keeps BOM and CRLF from actual UTF-8 file bytes', async () => {
    const source = '\uFEFF@[name](测试)\r\n\r\n';
    expect(getMarkdownSource(parseMarkdown(await readMarkdownFile(new Blob([source]))).document)).toBe(source);
  });

  it('recovers a mixed-width metadata value on opening legacy Markdown and retains original source', async () => {
    const source = '\uFEFF@[name](示例)\r\n:::project\r\n@[name](示例(系统）)\r\n- 记录\r\n:::\r\n';
    const expected = parseMarkdown(source).document;
    expect(expected.sections[0].items[0].title).toBe('示例(系统）');
    expect(analyzeMarkdownSource(source).blocks[0].fields[0].value).toBe('示例(系统）');
    const broken = structuredClone(expected), item = broken.sections[0].items[0];
    item.title = '';
    item.description.content!.unshift({ type: 'paragraph', content: [{ type: 'text', text: '@[name](示例(系统）)' }] });
    const saved = await saveResume(broken), recovered = (await getResume(saved.id))!;
    expect(recovered.sections).toEqual(expected.sections);
    expect(getMarkdownSource(recovered)).toBe(source);
    expect(recovered.revision).toBe(saved.revision);
  });
});
