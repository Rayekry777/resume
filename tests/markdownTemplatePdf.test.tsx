import React from 'react';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, expect, it } from 'vitest';
import { getMarkdownSource, updateMarkdownSource } from '../src/lib/markdown';
import { createMarkdownTemplateResume, createTemplateResume } from '../src/markdownTemplateResume';
import { canonicalCatalogId, getMarkdownDesign, MARKDOWN_TEMPLATES, previewPoint } from '../src/markdownTemplates';
import type { ResumeDocument, RichNode } from '../src/model';
import { prepareResumeWrapping, registerResumeFonts, ResumePdf } from '../src/pdf/ResumePdf';

beforeAll(() => {
  const font = (filename: string) => resolve('public/fonts', filename);
  registerResumeFonts({
    regular: font('Chinese-Regular.ttf'), bold: font('Chinese-Bold.ttf'),
    italic: font('Chinese-Italic.woff'), boldItalic: font('Chinese-BoldItalic.woff'),
  });
});

const compact = (value: string) => value.replace(/\s+/gu, '');
const localPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=';

async function inspectPages(document: ResumeDocument, cover?: string, photo?: string) {
  await prepareResumeWrapping(document);
  const buffer = await renderToBuffer(<ResumePdf document={document} photoDataUrl={photo} />);
  if (cover && process.env.RESUME_MD_PREVIEW_DIR) {
    await mkdir(process.env.RESUME_MD_PREVIEW_DIR, { recursive: true });
    await writeFile(join(process.env.RESUME_MD_PREVIEW_DIR, cover + '.pdf'), buffer);
  }
  const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    const lines: string[] = [];
    const positions: number[][] = [];
    const columns: string[][] = [[], []];
    const links: string[] = [];
    const sidebar = getMarkdownDesign(document.templateId)?.sidebar;
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const { width, height } = page.getViewport({ scale: 1 });
      const split = sidebar?.edge === 'right' ? width - previewPoint(sidebar.width) : previewPoint(sidebar?.width ?? 0);
      const diagnostic = `${document.templateId} 第 ${index} 页`;
      expect(width, diagnostic).toBeCloseTo(595.28, 1);
      expect(height, diagnostic).toBeCloseTo(841.89, 1);
      if (photo && index === 1) {
        const { fnArray } = await page.getOperatorList();
        expect(fnArray.some(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject),
          diagnostic + ' 缺少本地照片').toBe(true);
      }
      const text = (await page.getTextContent()).items;
      expect(text.some(item => 'str' in item && item.str.trim()), diagnostic + ' 空白页').toBe(true);
      for (const item of text) {
        if (!('str' in item) || !item.str.trim()) continue;
        const x = item.transform[4], baseline = item.transform[5];
        expect(x, diagnostic + ' 左边界').toBeGreaterThanOrEqual(-1);
        expect(x + item.width, diagnostic + ' 右边界').toBeLessThanOrEqual(width + 1);
        expect(baseline, diagnostic + ' 下边界').toBeGreaterThanOrEqual(-1);
        expect(baseline, diagnostic + ' 上边界').toBeLessThanOrEqual(height + 1);
        lines.push(item.str);
        positions.push([index, x, baseline, item.width, item.height]);
        columns[sidebar && x >= split ? 1 : 0].push(item.str);
      }
      links.push(...(await page.getAnnotations()).flatMap(annotation => annotation.url ? [annotation.url] : []));
    }
    return { text: compact(lines.join('')), columns: columns.map(words => compact(words.join(''))), positions, pages: pdf.numPages, links };
  } finally {
    await loading.destroy();
  }
}

it('renders each Markdown cover from its actual editable sample with complete searchable content', async () => {
  const ids = MARKDOWN_TEMPLATES.map(template => template.id);
  expect(new Set(ids).size).toBe(17);
  const covers = ['md-legacy-neat', ...ids.filter(id => id === canonicalCatalogId(id))];
  expect(covers).toHaveLength(16);
  const source = getMarkdownSource(createMarkdownTemplateResume('neat'));
  for (const id of ['neat', ...ids]) {
    const canonicalId = canonicalCatalogId(id);
    const document = createMarkdownTemplateResume(id);
    expect(document.templateId).toBe(canonicalId);
    expect(getMarkdownSource(document).replace(/^@\[template\]\([^\n]*\)\r?\n/u, '')).toBe(source);
    const coverId = id === 'neat' ? 'md-legacy-neat' : id;
    const pdf = await inspectPages(document, covers.includes(coverId) ? coverId : undefined);
    const assertText = (value: string) => expect(pdf.text, id).toContain(compact(value));
    function assertBody(node: RichNode) {
      if (node.text) assertText(node.text);
      node.content?.forEach(assertBody);
    }
    assertText(document.profile.name);
    assertText(document.profile.email);
    if (document.profile.github) expect(pdf.links, id).toContain(document.profile.github);
    for (const section of document.sections) {
      assertText(section.title);
      for (const item of section.items) {
        assertText(item.title);
        assertBody(item.description);
      }
    }
  }
  if (process.env.RESUME_MD_PREVIEW_DIR) {
    await writeFile(join(process.env.RESUME_MD_PREVIEW_DIR, 'covers.json'), JSON.stringify(covers));
  }
}, 120_000);

it.each(MARKDOWN_TEMPLATES)('keeps Markdown paragraphs, links and photos across A4 pages in $id', async template => {
  const notes = Array.from({ length: 54 }, (_, index) =>
    `第 ${index + 1} 次验证，记录 TypeScript 接口、SQL 指标和线上反馈，检查跨页排版。`);
  const base = createMarkdownTemplateResume(template.id);
  expect(base.templateId).toBe(canonicalCatalogId(template.id));
  const source = getMarkdownSource(base) + '\n:::custom 验证记录\n' + notes.join('\n\n') +
    '\n\n[查看记录](https://example.com/records)\n:::\n';
  const result = updateMarkdownSource(base, source);
  expect(result.previewStale, template.id).toBe(false);
  const pdf = await inspectPages(result.document, undefined, localPhoto);
  expect(pdf.pages, template.id).toBeGreaterThan(1);
  // A paragraph can continue on the next page with the other column painted between its two parts.
  expect(pdf.columns.some(column => column.includes(compact(notes.join('')))), template.id).toBe(true);
  expect(pdf.links, template.id).toContain('https://example.com/records');
}, 30_000);

it.each([['md-generous', 'elegant'], ['md-graduate-steady', 'steady']])(
  'opens the %s catalog entry with the same PDF text, positions and links as %s', async (alias, canonical) => {
    const fromEntry = createTemplateResume(alias, true, 'markdown');
    const fromLibrary = createTemplateResume(canonical, true, 'markdown');
    expect(fromEntry.templateId).toBe(canonical);
    const canonicalPdf = await inspectPages(fromLibrary, undefined, localPhoto);
    expect(await inspectPages(fromEntry, undefined, localPhoto)).toEqual(canonicalPdf);
  },
);

it('keeps the first contact below the dark masthead with a square photo and zero top margin', async () => {
  const document = createMarkdownTemplateResume('md-graduate-business');
  document.layout = { ...document.layout, marginTop: 0, photoShape: 'square' };
  await prepareResumeWrapping(document);
  const buffer = await renderToBuffer(<ResumePdf document={document} photoDataUrl={localPhoto} />);
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
  try {
    const page = await (await task.promise).getPage(1);
    const phone = (await page.getTextContent()).items.find(item => 'str' in item && item.str === document.profile.phone);
    expect(phone).toBeDefined();
    if (!phone || !('transform' in phone)) throw new Error('电话号码缺少文字坐标');
    const phoneTop = page.getViewport({ scale: 1 }).height - phone.transform[5] - phone.height;
    expect(phoneTop).toBeGreaterThan(previewPoint(130));
  } finally { await task.destroy(); }
});
