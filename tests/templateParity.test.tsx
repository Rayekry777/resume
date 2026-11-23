import React from 'react';
import { beforeAll, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { resolve, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createResume, newItem, newSection, richText, bulletText } from '../src/sample';
import { applyResumeTemplate, templateLayout, TEMPLATES } from '../src/templates';
import { exportMarkdown, getMarkdownSource, parseMarkdown, updateMarkdownSource } from '../src/lib/markdown';
import { getTemplateReference } from '../src/templateReferences';
import { prepareResumeWrapping, registerResumeFonts, ResumePdf } from '../src/pdf/ResumePdf';

beforeAll(() => {
  const fonts = resolve('public/fonts');
  registerResumeFonts({ regular: join(fonts,'Chinese-Regular.ttf'), bold: join(fonts,'Chinese-Bold.ttf'),
    italic: join(fonts,'Chinese-Italic.woff'), boldItalic: join(fonts,'Chinese-BoldItalic.woff') });
});

it('switches the same mixed-language resume through all 22 templates and preserves every body line within A4', async () => {
  const base = createResume('neat', false);
  base.profile.name = '验收样本'; base.profile.email = 'example@example.com';
  const section = (type: 'education'|'project'|'summary', title: string, body: string[]) => ({
    ...newSection(type), items: [newItem({title, description: type === 'project' ? bulletText(body) : richText(body.join('\n'))})],
  });
  const notes = Array.from({length:18}, (_,i) => `阶段 ${String(i + 1).padStart(2,'0')}。完成 TypeScript 模块和 SQL 指标比对，验证 A/B 实验记录、中文标点与边界值。`);
  const left = '统计学与数据分析', right = '原型设计与验证';
  base.sections = [section('education','学校样本',[left]), section('project','项目样本',[right,...notes]),
    section('summary','个人简介',['持续维护开源组件。'])];
  const expected = [base.profile.name, base.profile.email, ...base.sections.map(s => s.title),
    '学校样本','项目样本', left, right, ...notes,'持续维护开源组件。'];
  const report = ['# 22 个模板同稿验收','',
    '在每个入口应用同一份虚构简历，采用编辑器使用的模板参数、字体加载和浏览器 PDF 排版组件。'
    +'正文含中文、英文、数字和跨页列表。脚本提取每页文字、检查 A4 边界，并在双栏模板中检查教育正文在左栏、项目正文在右栏。'
    +'以下结果用于模板间回归，原站同稿几何还原情况见逐页对照。','',
    '| 入口 | 模板标识 | PDF页数 | 正文完整 | 空白页 | 越界字串 | 栏位置 |',
    '|---|---|---|---|---|---|---|'];
  for (const template of TEMPLATES) {
    const document = applyResumeTemplate(base, template.id);
    expect(document.sections).toEqual(base.sections);
    await prepareResumeWrapping(document);
    const buffer = await renderToBuffer(<ResumePdf document={document}/>);
    const loading = getDocument({data:new Uint8Array(buffer), useSystemFonts:false});
    const pdf = await loading.promise;
    try {
      const textParts: string[] = [];
      const columns = getTemplateReference(template.id).columns;
      const columnLocations = new Map<string,number>();
      for (let i=1; i<=pdf.numPages; i++) {
        const page = await pdf.getPage(i), size = page.getViewport({scale:1});
        const items = (await page.getTextContent()).items.filter(item => 'str' in item && item.str.trim().length > 0);
        expect(items.length, template.id+' 出现空白页').toBeGreaterThan(0);
        for (const item of items) {
          if (!('str' in item)) continue;
          const x = item.transform[4], y = item.transform[5];
          expect(x, template.id+' 文字左界').toBeGreaterThanOrEqual(-.5);
          expect(x+item.width, template.id+' 文字右界').toBeLessThanOrEqual(size.width+.5);
          expect(y, template.id+' 文字下界').toBeGreaterThanOrEqual(0);
          expect(y+item.height, template.id+' 文字上界').toBeLessThanOrEqual(size.height+.5);
          textParts.push(item.str);
          for (const anchor of [left,right]) {
            if (item.str.includes(anchor)) columnLocations.set(anchor, x/size.width);
          }
        }
      }
      const removeSpacing = (text: string) => text.replace(/[\s\u00ad\u200b]/g,'');
      const text = removeSpacing(textParts.join(''));
      for (const part of expected) expect(text,template.id).toContain(removeSpacing(part));
      if (columns) {
        expect(columnLocations.get(left), template.id+' 教育左栏').toBeLessThan(columns.leftRatio);
        expect(columnLocations.get(right), template.id+' 项目右栏').toBeGreaterThanOrEqual(columns.leftRatio);
      }
      report.push(`| ${template.name} | ${template.id} | ${pdf.numPages} | 通过 | 0 | 0 | ${columns?'双栏通过':'单栏'} |`);
    } finally { await loading.destroy(); }
  }
  if (process.env.RESUME_PARITY_REPORT_DIR) {
    await mkdir(process.env.RESUME_PARITY_REPORT_DIR,{recursive:true});
    await writeFile(join(process.env.RESUME_PARITY_REPORT_DIR,'模板验收.md'),report.join('\n')+'\n','utf8');
  }
}, 90000);

it('imports the requested Markdown design and switches PDF columns without changing source or photo', async () => {
  const source = '\uFEFF' + [
    '@[name](示例姓名)', '@[template](graduate)', '',
    ':::education', '@[school](教育样本)', '学习 TypeScript 与 SQL。', ':::', '',
    ':::project', '@[name](项目样本)', '@[url](https://example.com/work)',
    '- **实际成果**：完成 mixed-language 项目验收。  ', ':::', '',
  ].join('\r\n');
  const imported = parseMarkdown(source).document;
  expect(imported.templateId).toBe('graduate');
  expect(imported.layout).toEqual(templateLayout('graduate', 'markdown'));
  imported.profile.photoId = 'local-photo';
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=';

  const projectPositions: number[] = [];
  for (const document of [imported, applyResumeTemplate(imported, 'neat')]) {
    expect(getMarkdownSource(document)).toBe(source);
    expect(parseMarkdown(exportMarkdown(document)).document.templateId).toBe(document.templateId);
    expect(document.profile.photoId).toBe('local-photo');
    expect(document.sections).toEqual(imported.sections);
    const edit = updateMarkdownSource(document, source.replace('实际成果', '开发成果'));
    expect(edit.previewStale).toBe(false);
    expect(edit.document.layout).toEqual(document.layout);
    expect(edit.document.templateId).toBe(document.templateId);
    await prepareResumeWrapping(edit.document);
    const buffer = await renderToBuffer(<ResumePdf document={edit.document} photoDataUrl={photo}/>);
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      expect(pdf.numPages).toBe(1);
      const page = await pdf.getPage(1);
      const items = (await page.getTextContent()).items.filter(item => 'str' in item);
      expect(items.map(item => item.str).join('').replace(/\s+/g, '')).toContain('开发成果');
      const project = items.find(item => item.str.includes('项目样本'));
      expect(project).toBeDefined();
      projectPositions.push(project!.transform[4]);
      expect((await page.getOperatorList()).fnArray).toContain(OPS.paintImageXObject);
      expect((await page.getAnnotations()).some(a => a.url === 'https://example.com/work')).toBe(true);
    } finally { await task.destroy(); }
  }
  // Graduate places the project in its right-hand column; the native
  // Markdown design begins the same project inside the single text column.
  expect(projectPositions[0]).toBeGreaterThan(595 * .3);
  expect(projectPositions[1]).toBeLessThan(595 * .3);
});
