import React from 'react';
import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { prepareResumeWrapping, registerResumeFonts, ResumePdf, safePdfLink } from '../src/pdf/ResumePdf';
import { createResume, newItem, newSection, richText } from '../src/sample';
import { MD_REFERENCE, TEMPLATES } from '../src/templates';
import { getTemplateReference, TEMPLATE_REFERENCES } from '../src/templateReferences';
import { type RichNode } from '../src/model';

// The original PDF's 80px portrait measures 68.895pt.
const ordinaryPrintPx = 68.895 / 80;
const ordinaryPrintScale = ordinaryPrintPx / (595.28 / 689);

beforeAll(() => {
  const regular = path.resolve('public/fonts/Chinese-Regular.ttf');
  const bold = path.resolve('public/fonts/Chinese-Bold.ttf');
  const italic = path.resolve('public/fonts/Chinese-Italic.woff');
  const boldItalic = path.resolve('public/fonts/Chinese-BoldItalic.woff');
  expect(existsSync(regular), '离线中文常规字体必须随项目提供').toBe(true);
  expect(existsSync(bold), '离线中文粗体字体必须随项目提供').toBe(true);
  expect(existsSync(italic), '离线中文斜体字体必须随项目提供').toBe(true);
  expect(existsSync(boldItalic), '离线中文粗斜体字体必须随项目提供').toBe(true);
  registerResumeFonts({ regular, bold, italic, boldItalic });
});

describe('browser-independent resume PDF layout', () => {
  it('matches the measured blue template geometry and reserves the original photo area', async () => {
    const document = createResume('neat');
    // The original paper is 689 CSS px wide; normalize these measurements to A4.
    expect(document.layout.fontSize).toBeCloseTo(10.367721);
    expect(document.layout.lineHeight).toBeCloseTo(22 / 12);
    expect(document.layout.marginTop).toBeCloseTo(25.919303);
    expect(document.layout.marginHorizontal).toBeCloseTo(25.919303);
    expect(document.layout.sectionGap).toBeCloseTo(1.727954);
    expect(document.layout.titleGap).toBeCloseTo(10.367721);
    expect(createResume('neat', false).layout).toEqual(document.layout);
    expect(getTemplateReference('classic').profile.kind).toBe('sidebar');
    const photoDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=';
    const headingBaselines: number[] = [];
    for (const photo of [undefined, photoDataUrl]) {
      const buffer = await renderToBuffer(<ResumePdf document={document} photoDataUrl={photo} />);
      const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
      try {
        const pdf = await loadingTask.promise;
        const content = await (await pdf.getPage(1)).getTextContent();
        const item = (text: string) => {
          const found = content.items.find(candidate => 'str' in candidate && candidate.str === text);
          if (!found || !('transform' in found)) throw new Error(`PDF缺少文字: ${text}`);
          return found;
        };
        const name = item('林一然');
        const phone = item('138 0000 0000');
        const position = item('产品设计师');
        const heading = item('教育经历');
        const school = item('同济大学');
        expect(name.height).toBeCloseTo(22 * ordinaryPrintPx, 4); // 22px name
        expect(name.transform[4]).toBeCloseTo(30 * ordinaryPrintPx, 4); // 30px paper padding
        expect(phone.height).toBeCloseTo(12 * ordinaryPrintPx, 4); // 12px details
        expect(phone.transform[4] - name.transform[4]).toBeCloseTo(16 * ordinaryPrintPx, 4); // 12px icon + 4px gap
        expect(phone.transform[5] - position.transform[5]).toBeCloseTo(22 * ordinaryPrintPx, 4); // 22px detail row
        expect(heading.height).toBeCloseTo(18 * ordinaryPrintPx, 4); // 18px section heading
        expect(heading.transform[4] - name.transform[4]).toBeCloseTo(18 * ordinaryPrintPx, 4); // 18px heading padding
        expect(school.height).toBeCloseTo(16 * ordinaryPrintPx, 4); // 16px school
        expect(school.transform[4]).toBeCloseTo(name.transform[4], 4);
        headingBaselines.push(heading.transform[5]);
      } finally { await loadingTask.destroy(); }
    }
    // The 96px avatar container adds 22px to the natural 74px two-row profile.
    expect(headingBaselines[0] - headingBaselines[1]).toBeCloseTo(22 * ordinaryPrintPx, 4);

    document.sections = [{ ...newSection('project'), items: [
      newItem({ title: '项目标题甲', startDate: '2024.01', endDate: '2024.02', description: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '正文第一段' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正文第二段' }] },
        { type: 'bulletList', content: ['列表第一项', '列表第二项'].map(text => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) },
      ] } }),
      newItem({ title: '项目标题乙', description: richText('后续项目正文') }),
    ] }];
    const buffer = await renderToBuffer(<ResumePdf document={document} />);
    const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
    try {
      const pdf = await loadingTask.promise;
      const content = await (await pdf.getPage(1)).getTextContent();
      const item = (text: string) => {
        const found = content.items.find(candidate => 'str' in candidate && candidate.str === text);
        if (!found || !('transform' in found)) throw new Error(`PDF缺少文字: ${text}`);
        return found;
      };
      const first = item('正文第一段');
      const second = item('正文第二段');
      const listFirst = item('列表第一项');
      const listSecond = item('列表第二项');
      expect(item('项目标题甲').height).toBeCloseTo(15 * ordinaryPrintPx, 4); // 15px project title
      expect(first.transform[5] - second.transform[5]).toBeCloseTo(22 * ordinaryPrintPx, 4); // p margin:0; line-height:22px
      expect(second.transform[5] - listFirst.transform[5]).toBeCloseTo(22 * ordinaryPrintPx, 4);
      expect(listFirst.transform[5] - listSecond.transform[5]).toBeCloseTo(22 * ordinaryPrintPx, 4);
      expect(listFirst.transform[4] - first.transform[4]).toBeCloseTo(20 * ordinaryPrintPx, 4); // 13px list padding + 7px item margin
      expect(item('项目标题甲').transform[5] - item('项目标题乙').transform[5]).toBeCloseTo(118 * ordinaryPrintPx, 4); // five 22px rows + 8px item padding
    } finally { await loadingTask.destroy(); }
  }, 30_000);

  it('exports the 22 source cards as readable Chinese PDFs without an added page footer', async () => {
    expect(TEMPLATES).toHaveLength(22);
    expect(new Set(TEMPLATES.map(template => getTemplateReference(template.id))).size).toBe(21);
    expect(getTemplateReference('product')).toBe(getTemplateReference('java-pro'));
    expect(Object.keys(TEMPLATE_REFERENCES)).toHaveLength(22);
    for (const template of TEMPLATES) {
      const document = createResume(template.id);
      await prepareResumeWrapping(document);
      if (process.env.RESUME_PREVIEW_DIR) {
        mkdirSync(process.env.RESUME_PREVIEW_DIR, { recursive: true });
        const cover = await renderToBuffer(<ResumePdf document={document} />);
        writeFileSync(path.join(process.env.RESUME_PREVIEW_DIR, `${template.id}.pdf`), cover);
      }
      document.profile.extraFields = [{ key: 'highestDegree', label: '学历', value: '硕士' }];
      const buffer = await renderToBuffer(<ResumePdf document={document} />);
      const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
      const pdf = await loadingTask.promise;
      try {
        expect(pdf.numPages, template.name).toBeGreaterThan(0);
        const firstPage = await pdf.getPage(1);
        const content = await firstPage.getTextContent();
        const text = content.items.map(item => 'str' in item ? item.str : '').join('');
        expect(text, template.name).toContain('林一然');
        expect(text, `${template.name}保留迁移的学历信息`).toContain('硕士');
        expect(text, template.name).toContain('教育经历');
        expect(text, template.name).toContain('同济大学');
        expect(text, template.name).not.toContain('undefined');
        const footer = content.items.find(item => 'str' in item && /^1\s*\/\s*\d+$/.test(item.str));
        expect(footer, `${template.name}未增加原站没有的页码`).toBeUndefined();
        const pages = [text];
        for (let page = 2; page <= pdf.numPages; page++) {
          const continuation = await (await pdf.getPage(page)).getTextContent();
          pages.push(continuation.items.map(item => 'str' in item ? item.str : '').join(''));
        }
        const wholeText = pages.join('').replace(/\s+/g, '');
        const checkAllLines = (node: RichNode) => {
          if (node.text) expect(wholeText, `${template.name}分页不能裁掉经历正文`).toContain(node.text.replace(/\s+/g, ''));
          node.content?.forEach(checkAllLines);
        };
        for (const section of document.sections) for (const item of section.items) checkAllLines(item.description);
      } finally { await loadingTask.destroy(); }
    }
  }, 120_000);

  it('uses the measured name, heading, photo reservation and two-column coordinates', async () => {
    const k = 595.28 / 689;
    const photoDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=';
    const cases = [
      { id:'frontend-pro', nameX:30, titleX:30, nameSize:22, titleSize:18 },
      { id:'operations', nameX:40, titleX:40, nameSize:22, titleSize:18 },
      { id:'java-pro', nameX:39, titleX:39, nameSize:22, titleSize:18 },
      { id:'elegant', nameX:57, titleX:57, nameSize:27, titleSize:18 },
      { id:'steady', nameX:145, titleX:59, nameSize:20, titleSize:18 },
      { id:'modern', nameX:20, titleX:66, nameSize:22, titleSize:16 },
      { id:'professional', nameX:35, titleX:61, nameSize:22, titleSize:18 },
      { id:'organized', nameX:5, titleX:228.7, nameSize:22, titleSize:18 },
      { id:'graduate', nameCenter:113.35, titleX:228.7, nameSize:22, titleSize:18 },
      { id:'classic', nameCenter:105.85, titleX:216.7, nameSize:22, titleSize:18 },
      { id:'fresh', nameX:20, titleX:216.7, nameSize:22, titleSize:18 },
      { id:'minimal', nameCenter:392.5, titleX:32, nameSize:22, titleSize:18 },
      { id:'creative', nameCenter:304.5, titleX:42, nameSize:22, titleSize:18 },
    ];
    for (const expected of cases) {
      const document = createResume(expected.id, false);
      document.layout = { ...document.layout, ...getTemplateReference(expected.id).defaultLayout };
      document.profile = { ...document.profile, name:'实测模板姓名', phone:'13800000000', email:'a@b.cn' };
      document.sections = [{ ...newSection('project'), title:'模块坐标', items:[newItem({ title:'项目坐标', description:richText('正文坐标') })] }];
      const buffer = await renderToBuffer(<ResumePdf document={document} photoDataUrl={photoDataUrl} />);
      const task = getDocument({ data:new Uint8Array(buffer), useSystemFonts:false });
      try {
        const page = await (await task.promise).getPage(1), content = await page.getTextContent();
        const item = (text:string) => {
          const found = content.items.find(value => 'str' in value && value.str === text);
          if (!found || !('transform' in found)) throw new Error(`${expected.id}缺少文字: ${text}`);
          return found;
        };
        const name = item('实测模板姓名'), title = item('模块坐标');
        expect(name.height, expected.id).toBeCloseTo(expected.nameSize * k, 4);
        expect(title.height, expected.id).toBeCloseTo(expected.titleSize * k, 4);
        if ('nameX' in expected) expect(name.transform[4], expected.id).toBeCloseTo(expected.nameX! * k, 2);
        else expect(name.transform[4] + name.width / 2, expected.id).toBeCloseTo(expected.nameCenter! * k, 2);
        expect(title.transform[4], expected.id).toBeCloseTo(expected.titleX * k, 2);
        expect(item('正文坐标').transform[4], expected.id).toBeLessThan(595.28 - 15);
        const operators = await page.getOperatorList();
        const stack:string[] = [];
        let fill = '#000000', headingColor = '', projectColor = '';
        for (let index = 0; index < operators.fnArray.length; index++) {
          const op = operators.fnArray[index], args = operators.argsArray[index];
          if (op === OPS.save) stack.push(fill);
          else if (op === OPS.restore) fill = stack.pop() ?? '#000000';
          else if (op === OPS.setFillRGBColor) fill = String(args[0]);
          else if (op === OPS.showText) {
            const text = (args[0] as ({unicode?:string} | number)[]).map(glyph => typeof glyph === 'number' ? '' : glyph.unicode ?? '').join('');
            if (text === '模块坐标') headingColor = fill;
            if (text === '项目坐标') projectColor = fill;
          }
        }
        const reference = getTemplateReference(expected.id);
        expect(headingColor, expected.id).toBe(reference.heading.kind === 'icon' || reference.heading.kind === 'plain' ? reference.heading.color : ['tab','capsule'].includes(reference.heading.kind) ? '#ffffff' : reference.accent);
        if (expected.id === 'professional') {
          expect(headingColor).toBe('#000000');
          expect(projectColor).toBe('#a05fca');
          expect(item('项目坐标').height).toBeCloseTo(14 * k, 4);
        }
      } finally { await task.destroy(); }
    }
  }, 60_000);

  it('keeps long rich text across pages on all four sidebar templates and the single-column design', async () => {
    const paragraphs = Array.from({length:45}, (_, index) => `模板段落${String(index).padStart(3,'0')}：负责系统架构设计和持续交付，保留跨页的完整中文内容。`);
    for (const templateId of ['elegant', 'organized', 'graduate', 'classic', 'fresh']) {
      const document = createResume(templateId, false);
      document.layout = { ...document.layout, ...getTemplateReference(templateId).defaultLayout };
      document.profile.name = '跨页完整性';
      document.sections = [{ ...newSection('experience'), items:[newItem({ title:'长项目', description:richText(paragraphs.join('\n')) })] }];
      const buffer = await renderToBuffer(<ResumePdf document={document} />);
      const task = getDocument({ data:new Uint8Array(buffer), useSystemFonts:false });
      try {
        const pdf = await task.promise;
        expect(pdf.numPages, templateId).toBeGreaterThan(1);
        const pages:string[] = [];
        for (let page = 1; page <= pdf.numPages; page++) {
          const content = await (await pdf.getPage(page)).getTextContent();
          pages.push(content.items.map(item => 'str' in item ? item.str : '').join(''));
        }
        const text = pages.join('').replace(/\s+/g, '');
        for (const paragraph of paragraphs) expect(text, templateId).toContain(paragraph);
      } finally { await task.destroy(); }
    }
  }, 60_000);

  it('renders the selected 8px font and 28px line spacing at the exact paper scale', async () => {
    const k = 595.28 / 689;
    const document = createResume('neat', false);
    document.layout = { ...document.layout, fontSize: 8*k, lineHeight: 28/8 };
    document.sections = [{ ...newSection('custom'), items: [newItem({ description: richText('第一行原文\n第二行原文') })] }];
    const buffer = await renderToBuffer(<ResumePdf document={document} />);
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts:false });
    try {
      const pdf = await task.promise;
      const content = await (await pdf.getPage(1)).getTextContent();
      const lines = content.items.flatMap(item => 'str' in item && item.str.includes('行原文') ? [item] : []);
      expect(lines).toHaveLength(2);
      expect(lines[0].height).toBeCloseTo(8 * ordinaryPrintPx, 4);
      expect(lines[0].transform[5] - lines[1].transform[5]).toBeCloseTo(28 * ordinaryPrintPx, 4);
    } finally { await task.destroy(); }
  });

  it('keeps leading punctuation after a bold run, the third contact row and embedded code metrics', async () => {
    const document = createResume('neat', false);
    document.profile = { ...document.profile, phone:'11111111', status:'应届毕业生', extraFields:[{ key:'highestDegree', label:'学历', value:'本科' }] };
    document.layout.lineHeight = 23 / 12;
    document.sections = [{ ...newSection('skill'), items:[newItem({ description:{ type:'doc', content:[{
      type:'paragraph', content:[{ type:'text', text:'标签', marks:[{type:'bold'}] }, { type:'text',text:'：后续正文' },
        { type:'text',text:'TokenStream',marks:[{type:'code'}, {type:'italic'}] }],
    }] } })] }];
    const output = await renderToBuffer(<ResumePdf document={document} />);
    const task = getDocument({ data:new Uint8Array(output), useSystemFonts:false });
    try {
      const content = await (await (await task.promise).getPage(1)).getTextContent();
      const text = content.items.flatMap(item => 'str' in item ? [item] : []);
      expect(text.map(item => item.str).join('').replace(/\s+/g,'')).toContain('标签：后续正文TokenStream');
      const position = (name:string) => text.find(item => item.str === name)!;
      expect(position('应届毕业生').transform[5] - position('本科').transform[5]).toBeCloseTo(23 * ordinaryPrintPx, 4);
      expect(position('TokenStream').width).toBeCloseTo(11 * 12 * ordinaryPrintPx * 0.6, 0);
    } finally { await task.destroy(); }
  });

  it('uses the independent Markdown typography, black headings and inline field order', async () => {
    const document = createResume('neat', false);
    document.editorMode = 'markdown';
    document.layout = { ...document.layout, ...MD_REFERENCE.defaultLayout };
    document.profile = { ...document.profile, name: '源码排版', phone: '13800000000', email: 'a@b.cn', status: '在职', title: '工程师', github: 'github.com/u' };
    document.sections = [{ ...newSection('project'), title: '黑色模块标题', items: [newItem({ title: '首项公司', subtitle: '其次职位', location: '上海', startDate: '2024.01', endDate: '2024.02', description: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '正文十三像素' }] },
      { type: 'bulletList', content: ['列表第一项', '列表第二项'].map(text => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) },
    ] } })] }];
    const buffer = await renderToBuffer(<ResumePdf document={document} />);
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
    try {
      const page = await (await task.promise).getPage(1), content = await page.getTextContent();
      const item = (text: string) => {
        const found = content.items.find(candidate => 'str' in candidate && candidate.str === text);
        if (!found || !('transform' in found)) throw new Error(`PDF缺少文字: ${text}`);
        return found;
      };
      const printPoint = 68.895 / 80; // Scale measured on the source PDF's 80px portrait.
      expect(item('源码排版').height).toBeCloseTo(20 * printPoint, 4);
      expect(item('黑色模块标题').height).toBeCloseTo(17 * printPoint, 4); // 17px heading
      expect(item('正文十三像素').height).toBeCloseTo(13 * printPoint, 4);
      expect(item('列表第一项').height).toBeCloseTo(12 * printPoint, 4); // list uses 12px
      expect(item('列表第一项').transform[5] - item('列表第二项').transform[5]).toBeCloseTo(22 * printPoint, 4); // 20px line + collapsed 2px margin
      const chips = ['首项公司', '其次职位', '上海', '2024.01 — 2024.02'].map(item);
      for (let index = 1; index < chips.length; index++) {
        expect(chips[index].transform[4]).toBeGreaterThan(chips[index - 1].transform[4]);
        expect(chips[index].transform[5]).toBeCloseTo(chips[0].transform[5], 4);
      }
      expect(chips.at(-1)!.transform[4] + chips.at(-1)!.width).toBeLessThan(500);
      const contacts = ['13800000000', 'a@b.cn', '在职', '工程师', 'github.com/u'].map(item);
      for (const contact of contacts) expect(contact.transform[5]).toBeCloseTo(contacts[0].transform[5], 4);

      const operators = await page.getOperatorList();
      let fill = '#000000';
      const stack: string[] = [];
      const textColors = new Map<string, string>();
      const fillColors = new Set<string>();
      for (let index = 0; index < operators.fnArray.length; index++) {
        const op = operators.fnArray[index], args = operators.argsArray[index];
        if (op === OPS.save) stack.push(fill);
        else if (op === OPS.restore) fill = stack.pop() ?? '#000000';
        else if (op === OPS.setFillRGBColor) { fill = String(args[0]); fillColors.add(fill); }
        else if (op === OPS.showText) {
          const text = (args[0] as ({ unicode?: string } | number)[]).map(glyph => typeof glyph === 'number' ? '' : glyph.unicode ?? '').join('');
          textColors.set(text, fill);
        }
      }
      expect(textColors.get('黑色模块标题')).toBe('#262626');
      // Chromium paints a solid black disc for an unordered list. The heading uses a blue stripe.
      expect(fillColors.has('#000000')).toBe(true);
      expect([...fillColors].filter(value => !['#ffffff', '#000000', '#262626', '#4672f1', '#e8e8e8', '#8c8c8c', '#9299a4'].includes(value))).toEqual([]);
    } finally { await task.destroy(); }
  }, 30_000);

  it('applies independent page margins and module-only indentation to actual PDF coordinates', async () => {
    const document = createResume('neat', false);
    document.profile.name = '页边距坐标';
    document.sections = [{ ...newSection('project'), title: '模块坐标', items: [newItem({ title: '条目坐标', startDate: '2024.01', endDate: '2024.02', description: richText('正文坐标') })] }];
    const inspect = async () => {
      const buffer = await renderToBuffer(<ResumePdf document={document} />);
      const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
      try {
        const page = await (await task.promise).getPage(1), content = await page.getTextContent();
        const item = (text: string) => {
          const found = content.items.find(candidate => 'str' in candidate && candidate.str === text);
          if (!found || !('transform' in found)) throw new Error(`PDF缺少文字: ${text}`);
          return { x: found.transform[4], y: found.transform[5], right: found.transform[4] + found.width };
        };
        return { name: item('页边距坐标'), heading: item('模块坐标'), title: item('条目坐标'), body: item('正文坐标'), date: item('2024.01 — 2024.02') };
      } finally { await task.destroy(); }
    };
    document.layout = { ...document.layout, marginTop: 20, marginLeft: 20, marginRight: 20, contentIndent: 0, titleTopGap: 0 };
    const base = await inspect();
    document.layout = { ...document.layout, marginLeft: 40, marginRight: 55, contentIndent: 18, titleTopGap: 14 };
    const changed = await inspect();
    expect(changed.name.x - base.name.x).toBeCloseTo(20 * ordinaryPrintScale, 4);
    expect(changed.heading.x - base.heading.x).toBeCloseTo(20 * ordinaryPrintScale, 4);
    expect(changed.body.x - base.body.x).toBeCloseTo(38 * ordinaryPrintScale, 4);
    expect(changed.title.x - base.title.x).toBeCloseTo(38 * ordinaryPrintScale, 4);
    expect(changed.date.right).toBeCloseTo(689 * ordinaryPrintPx - 55 * ordinaryPrintScale, 4);
    expect(changed.date.right - base.date.right).toBeCloseTo(-35 * ordinaryPrintScale, 4);
    expect(changed.name.y).toBeCloseTo(base.name.y, 4);
    expect(base.heading.y - changed.heading.y).toBeCloseTo(14 * ordinaryPrintScale, 4);
    for (const field of ['marginLeft', 'marginRight', 'contentIndent', 'titleTopGap'] as const) delete document.layout[field];
    document.layout.marginHorizontal = 34;
    const legacy = await inspect();
    expect(legacy.name.x).toBeCloseTo(34 * ordinaryPrintScale, 4);
    expect(legacy.body.x).toBeCloseTo(34 * ordinaryPrintScale, 4);
    expect(base.heading.y - legacy.heading.y).toBeCloseTo(12 * ordinaryPrintPx, 4);
  }, 30_000);

  it('starts continued ordinary project text at its safe Chinese ink ascent and keeps the first page header intact', async () => {
    const document = createResume('neat', false);
    const section = newSection('project');
    document.sections = [section];
    const paragraphs = Array.from({ length: 65 }, (_, index) => `跨页内容${index}`);
    async function measure(lastParagraph: string) {
      section.items = [newItem({ title: '项目首行', description: richText([...paragraphs, lastParagraph].join('\n')) })];
      await prepareResumeWrapping(document);
      const buffer = await renderToBuffer(<ResumePdf document={document} />);
      const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
      try {
        const pdf = await task.promise;
        expect(pdf.numPages).toBe(2);
        const positions: number[] = [];
        for (const number of [1, 2]) {
          const page = await pdf.getPage(number);
          const text = await page.getTextContent();
          const first = text.items.find(item => 'str' in item && (number === 1 ? item.str === '项目首行' : item.str.startsWith('跨页内容')));
          if (!first || !('transform' in first)) throw Error('Missing project line');
          positions.push(page.view[3] - first.transform[5]);
        }
        return positions;
      } finally { await task.destroy(); }
    }
    const cjk = await measure('最后一行');
    // Combining marks can stack above the nominal ink top; reserve full ascent.
    const combining = await measure('最后一行 A\u0301');
    const size = document.layout.fontSize * ordinaryPrintScale;
    expect(cjk[0]).toBeCloseTo(combining[0], 3);
    expect(cjk[1]).toBeCloseTo(.88 * size, 2);
    expect(combining[1]).toBeCloseTo(1.16 * size, 2);
  }, 30_000);

  it('keeps every long Chinese paragraph across automatic pages and respects explicit page breaks', async () => {
    const document = createResume('neat', false);
    document.profile.name = '中文分页验证';
    const introduction = newSection('summary');
    introduction.title = '第一页简介';
    introduction.items = [newItem({ description: richText('这一段应当保留在第一页。') })];
    const longSection = newSection('experience');
    longSection.title = '强制新页经历';
    longSection.pageBreakBefore = true;
    const paragraphs = Array.from({ length: 80 }, (_, index) => `段落编号${String(index).padStart(3, '0')}：负责产品架构设计与持续交付，验证中英文混排 SpringBoot 与数据库系统，保持跨页内容完整。`);
    longSection.items = [newItem({ title: '长内容项目', description: richText(paragraphs.join('\n')) })];
    document.sections = [introduction, longSection];
    const buffer = await renderToBuffer(<ResumePdf document={document} />);
    const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
    const pdf = await loadingTask.promise;
    try {
      expect(pdf.numPages).toBeGreaterThan(2);
      expect(pdf.numPages).toBeLessThan(8);
      const texts: string[] = [];
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        texts.push(content.items.map(item => 'str' in item ? item.str : '').join(''));
      }
      expect(texts[0]).toContain('第一页简介');
      expect(texts[0]).not.toContain('强制新页经历');
      expect(texts[1]).toContain('强制新页经历');
      const allText = texts.join('');
      for (const paragraph of paragraphs) expect(allText).toContain(paragraph);
      expect(allText).not.toContain('�');
      expect((await pdf.getMetadata()).info).toMatchObject({ Title: document.title, Creator: '简历' });
    } finally { await loadingTask.destroy(); }
  }, 60_000);

  it('preserves nested lists, strong text, color, hyperlinks and a photo in the exported PDF', async () => {
    const document = createResume('creative', false);
    document.profile.photoId = 'test-photo';
    document.sections = [{ ...newSection('project'), items: [newItem({ title: '富文本测试', description: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '加粗中文', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#bb3355' } }] }, { type: 'text', text: '项目链接', marks: [{ type: 'link', attrs: { href: 'https://example.com/project' } }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: '无缩进基线' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '中文斜体', marks: [{ type: 'italic' }] }, { type: 'text', text: '中文粗斜体', marks: [{ type: 'bold' }, { type: 'italic' }] }] },
      { type: 'paragraph', attrs: { indent: 3 }, content: [{ type: 'text', text: '大号缩进', marks: [{ type: 'textStyle', attrs: { fontSize: '20pt' } }] }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '外层条目' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '嵌套条目' }] }] }] }] }] },
    ] } })] }];
    const photoDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=';
    const buffer = await renderToBuffer(<ResumePdf document={document} photoDataUrl={photoDataUrl} />);
    const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
    const pdf = await loadingTask.promise;
    try {
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str : '').join('');
      expect(text).toContain('加粗中文');
      expect(text).toContain('3.');
      expect(text).toContain('外层条目');
      expect(text).toContain('嵌套条目');
      expect(text).toContain('中文斜体');
      expect(text).toContain('中文粗斜体');
      const baseText = content.items.find(item => 'str' in item && item.str === '无缩进基线');
      const largeText = content.items.find(item => 'str' in item && item.str === '大号缩进');
      expect(baseText && 'transform' in baseText).toBe(true);
      expect(largeText && 'transform' in largeText).toBe(true);
      if (baseText && largeText && 'transform' in baseText && 'transform' in largeText) {
        expect(largeText.height).toBeCloseTo(20);
        expect(largeText.transform[4] - baseText.transform[4]).toBeCloseTo(45);
      }
      const annotations = await page.getAnnotations();
      expect(annotations.some(annotation => annotation.url === 'https://example.com/project')).toBe(true);
      expect(buffer.toString('latin1')).toContain('/Subtype /Image');
    } finally { await loadingTask.destroy(); }
    expect(safePdfLink('javascript:alert(1)')).toBeUndefined();
  }, 30_000);
});
