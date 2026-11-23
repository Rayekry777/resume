import { describe, expect, it } from 'vitest';
import { createResume } from '../src/sample';
import { applyResumeTemplate, matchesTemplate, MD_REFERENCE, resetResumeSpacing, templateCategories, templateLayout, templatePointPerPixel, TEMPLATES } from '../src/templates';
import { MARKDOWN_TEMPLATES, canonicalCatalogId } from '../src/markdownTemplates';
import { exportMarkdown, getMarkdownSource, parseMarkdown, switchEditingView } from '../src/lib/markdown';

describe('template selection and spacing', () => {
  it('uses the native Markdown paper when choosing a design from a converted visual resume', () => {
    const visual = createResume('neat');
    visual.profile.photoId = 'existing-photo';
    visual.layout.photoShape = 'round';
    const editing = switchEditingView(visual);
    expect(editing.presentationMode).toBe('visual');
    for (const template of MARKDOWN_TEMPLATES) {
      const themed = applyResumeTemplate(editing, template.id);
      const native = canonicalCatalogId(template.id) === template.id;
      expect(themed.presentationMode).toBe(native ? 'markdown' : 'visual');
      expect(themed.templateId).toBe(canonicalCatalogId(template.id));
      expect(themed.editorMode).toBe('markdown');
      expect(themed.profile).toBe(editing.profile);
      expect(themed.sections).toBe(editing.sections);
      expect(themed.markdownSource).toBe(editing.markdownSource);
      expect(themed.layout.photoShape).toBe('round');
      expect(templatePointPerPixel(template.id, 'markdown')).toBe(595.28 / (native ? 700 : 689));
      expect(switchEditingView(themed).presentationMode).toBe(themed.presentationMode);
    }
    const compatible = applyResumeTemplate(editing, 'neat', 'markdown');
    expect(compatible.presentationMode).toBe('markdown');
    expect(compatible.layout.fontSize).toBe(MD_REFERENCE.defaultLayout.fontSize);
  });

  it('downloads the explicitly selected design while preserving editable Markdown, BOM and CRLF', () => {
    const body = ':::project\r\n@[name](测试项目)\r\n```\r\n@[template](示例代码)\r\n```\r\n保留原文  \r\n:::';
    const source = '\uFEFF@[template](md-generous) @[name](示例)\r\n' + body;
    const initial = parseMarkdown(source).document;
    expect(initial.templateId).toBe('elegant');
    expect(exportMarkdown(initial)).toBe(source);
    expect(exportMarkdown(applyResumeTemplate(initial, 'elegant', 'visual'))).toBe(source);
    const next = applyResumeTemplate(initial, 'md-graduate-business');
    expect(getMarkdownSource(next)).toBe(source);
    expect(exportMarkdown(next)).toBe(source.replace('md-generous', 'md-graduate-business'));
    expect(parseMarkdown(exportMarkdown(next)).document.templateId).toBe(next.templateId);
    const classic = applyResumeTemplate(next, 'neat', 'visual');
    const downloaded = exportMarkdown(classic);
    expect(downloaded.startsWith('\uFEFF@[template](neat) @[name](示例)\r\n@[presentationMode](visual)\r\n')).toBe(true);
    expect(downloaded.endsWith(body)).toBe(true);
    expect(parseMarkdown(downloaded).document.layout).toEqual(classic.layout);
    const withoutMetadata = parseMarkdown('\uFEFF' + body).document;
    expect(exportMarkdown(withoutMetadata)).toBe('\uFEFF' + body);
    expect(exportMarkdown(applyResumeTemplate(withoutMetadata, 'md-graduate-business')))
      .toBe('\uFEFF@[template](md-graduate-business)\r\n' + body);
  });

  it('retains the current document while applying the same typography as a newly created template', () => {
    const doc = createResume('neat');
    doc.layout = { ...doc.layout, fontSize: 16, lineHeight: 2.5, marginRight: 12, showPhoto: false };
    const switched = applyResumeTemplate(doc, 'graduate');
    expect(switched.layout).toEqual({ ...createResume('graduate').layout, showPhoto: false });
    expect(switched.sections).toBe(doc.sections);
    expect(switched.profile).toBe(doc.profile);
    expect(switched.id).toBe(doc.id);
  });

  it('restores only the seven spacing fields, based on the page design independently of the active editor', () => {
    const doc = createResume('neat');
    doc.presentationMode = 'markdown';
    doc.editorMode = 'visual';
    doc.layout = {
      ...templateLayout('neat', 'markdown'), accent: '#983456', headerAlign: 'right', showPhoto: false,
      marginHorizontal: 29, marginRight: 17, marginLeft: 11, contentIndent: 7, sectionGap: 20, titleGap: 0, titleTopGap: 5, marginTop: 26,
    };
    const restored = resetResumeSpacing(doc);
    for (const key of ['marginTop','marginLeft','marginRight','contentIndent','sectionGap','titleTopGap','titleGap'] as const) {
      expect(restored[key]).toBe(MD_REFERENCE.defaultLayout[key]);
    }
    for (const key of ['marginHorizontal','accent','headerAlign','showPhoto','photoShape','fontSize','lineHeight'] as const) {
      expect(restored[key]).toBe(doc.layout[key]);
    }
    expect(restored.fontSize / MD_REFERENCE.pointPerPixel).toBeCloseTo(13);
    expect(restored.lineHeight * restored.fontSize / MD_REFERENCE.pointPerPixel).toBeCloseTo(20);
    expect(applyResumeTemplate(doc, 'neat').layout.titleGap).toBe(MD_REFERENCE.defaultLayout.titleGap);
  });

  it('lists actual occupations and stages, including both source Java cards', () => {
    for (const category of templateCategories) expect(TEMPLATES.some(t => matchesTemplate(t, category, ''))).toBe(true);
    const programmers = TEMPLATES.filter(t => matchesTemplate(t, '程序员', '')).map(t => t.id);
    expect(programmers).toEqual(expect.arrayContaining(['java-pro', 'product', 'frontend-campus']));
    expect(programmers).not.toContain('operations');
    expect(matchesTemplate(TEMPLATES.find(t => t.id === 'operations-campus')!, '校招', '运营')).toBe(true);
    expect(createResume('java-intern').profile.title).toContain('Java');
    expect(createResume('frontend-campus').profile.status).toBe('应届毕业生');
    expect(createResume('operations').profile.title).toContain('运营');
    expect(createResume('engineering').profile.title).toContain('嵌入式');
    expect(createResume('product').profile.title).toBe(createResume('java-pro').profile.title);
  });
});
