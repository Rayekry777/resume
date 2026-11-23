import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResume } from '../src/sample';
import { exportMarkdown, exportStructuredMarkdown, getEditorMode, getMarkdownSource, parseMarkdown, repairLegacyMarkdownProjection, updateMarkdownSource } from '../src/lib/markdown';

afterEach(() => vi.unstubAllGlobals());
describe('original-site Markdown migration', () => {
  it('imports profile and typed sections without requesting a remote avatar', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const source = `@[name](示例姓名)\n@[phone](13800000000)\n@[email](hello@example.com)\n@[avatar](https://example.com/photo(1).jpeg)\n@[status](应届毕业生)\n@[position](后端开发)\n@[github](https://github.com/example)\n\n:::education\n@[school](示例大学)\n@[major](软件工程)\n@[degree](全日制本科)\n@[degreeType](CET4)\n@[time](2023.09-2027.07)\n:::\n\n:::skill\n@[name](Java后端)\n- **后端技术：** 熟练掌握 Java（集合、JUC）\n- **数据库：** 熟练使用 MySQL\n:::\n\n:::project\n@[name](示例项目)\n@[url](https://example.com/repo(foo(bar)))\n- **项目描述：** 一段描述\n1. **亮点：** 一段文字\n:::`;
    const { document, warnings } = parseMarkdown(source);
    expect(document.profile.name).toBe('示例姓名'); expect(document.profile.title).toBe('后端开发'); expect(document.profile.photoId).toBeUndefined();
    expect(document.sections.map(section => section.type)).toEqual(['education', 'skill', 'project']);
    expect(document.sections[0].items[0]).toMatchObject({ title: '示例大学', subtitle: '软件工程 · 全日制本科 · CET4', startDate: '2023.09', endDate: '2027.07' });
    expect(document.sections[2].items[0].url).toBe('https://example.com/repo(foo(bar))');
    const skill = document.sections[1].items[0].description;
    expect(skill.content?.[0].type).toBe('bulletList'); expect(JSON.stringify(skill)).toContain('bold'); expect(warnings.some(warning => warning.includes('头像'))).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a source date separator through import, older projections and structured export', () => {
    for (const separator of ['-', ' ~ ', ' 至 ']) {
      const range = '2023.09' + separator + '2027.07';
      const { document } = parseMarkdown(':::education\n@[school](示例大学)\n@[time](' + range + ')\n:::');
      const item = document.sections[0].items[0];
      expect(item.dateSeparator).toBe(separator);
      expect(exportStructuredMarkdown(document)).toContain('@[time](' + range + ')');
      delete item.dateSeparator;
      expect(repairLegacyMarkdownProjection(document).sections[0].items[0].dateSeparator).toBe(separator);
      item.endDate = '2028.07';
      expect(repairLegacyMarkdownProjection(document).sections[0].items[0]).toEqual(item);
    }
  });

  it('round-trips all text metadata, sections and list content', () => {
    const original = createResume(); original.title = '用于岗位 A 的简历'; original.sections[0].pageBreakBefore = true; original.sections[1].visible = false;
    original.sections[2].items[0].url = 'https://example.com/project(foo)';
    const imported = parseMarkdown(exportMarkdown(original)).document;
    expect(imported.title).toBe(original.title); expect(imported.profile).toEqual(original.profile);
    expect(imported.sections).toHaveLength(original.sections.length);
    for (const [index, section] of imported.sections.entries()) {
      const expected = original.sections[index];
      expect(section.type).toBe(expected.type); expect(section.title).toBe(expected.title); expect(section.visible).toBe(expected.visible); expect(section.pageBreakBefore).toBe(expected.pageBreakBefore); expect(section.items).toHaveLength(expected.items.length);
      for (const [itemIndex, item] of section.items.entries()) expect({ ...item, id: '' }).toEqual({ ...expected.items[itemIndex], id: '' });
    }
  });

  it('supports ordinary Markdown headings and retains unknown metadata', () => {
    const result = parseMarkdown('# 林同学\n\n## 项目经历\n### 本地工具\n@[technology](TypeScript)\n- 无需后端\n\n## 自我评价\n保持好奇。');
    expect(result.document.profile.name).toBe('林同学'); expect(result.document.sections[0].type).toBe('project'); expect(result.document.sections[0].items[0].title).toBe('本地工具');
    expect(JSON.stringify(result.document.sections)).toContain('technology：TypeScript'); expect(result.warnings.some(warning => warning.includes('元信息'))).toBe(true);
  });

  it('retains raw HTML as inert text, strips unsafe link protocols and never loads images', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = parseMarkdown('@[name](示例)\n@[website](javascript:alert(1))\n:::summary\n<script>alert(1)</script>\n[点击](javascript:alert(1))\n![头像](https://example.com/track.png)\n:::');
    expect(result.document.profile.website).toBe('');
    const text = JSON.stringify(result.document.sections);
    expect(text).toContain('<script>alert(1)</script>'); expect(text).not.toContain('"type":"image"'); expect(text).not.toContain('"href":"javascript:'); expect(text).not.toContain('track.png'); expect(fetch).not.toHaveBeenCalled();
  });

  it('does not treat prototype property names as known sections or profile fields', () => {
    const result = parseMarkdown('@[constructor](原样保留)\n:::constructor\n@[name](自定义经历)\n内容\n:::');
    expect(result.document.sections.every(section => ['summary', 'custom'].includes(section.type))).toBe(true);
    expect(JSON.stringify(result.document.sections)).toContain('原样保留');
  });

  it('keeps directives inside code fences and escaped metadata as literal content', () => {
    const source = [':::skill', '\\@[name](literal)', '~~~~md', '~~~', ':::project', '@[name](snippet)', ':::', '~~~~', ':::'].join('\n');
    const { document } = parseMarkdown(source);
    expect(document.sections.map(s => s.type)).toEqual(['skill']);
    const [item] = document.sections[0].items;
    expect(item.title).toBe('');
    expect(item.description.content?.[0].content?.[0].text).toBe('@[name](literal)');
    expect(item.description.content?.[1]).toMatchObject({ type: 'codeBlock', content: [{ text: '~~~\n:::project\n@[name](snippet)\n:::' }] });
  });

  it('bounds oversized input and handles unmatched metadata parentheses as text', () => {
    expect(() => parseMarkdown('a'.repeat(2_000_001))).toThrow('过大');
    const result = parseMarkdown(':::summary\n@[unknown](未闭合\n');
    expect(JSON.stringify(result.document.sections)).toContain('@[unknown](未闭合'); expect(result.warnings.some(warning => warning.includes('未闭合'))).toBe(true);
  });

  it('retains original source including BOM, CRLF, spaces and blank lines without regeneration', () => {
    const source = '\uFEFF@[name](示例姓名)  \r\n\r\n\r\n:::project\r\n@[name](项目 A)\r\n\r\n- **原有格式**  \r\n:::\r\n';
    const { document } = parseMarkdown(source);
    expect(getEditorMode(document)).toBe('markdown'); expect(document.markdownSource).toBe(source); expect(getMarkdownSource(document)).toBe(source); expect(exportMarkdown(document)).toBe(source);
    const generated = exportStructuredMarkdown(document);
    expect(generated).not.toBe(source); expect(document.markdownSource).toBe(source);
    // A visual conversion/export must remain an explicit choice, not overwrite saved source.
    const visual = { ...document, editorMode: 'visual' as const, profile: { ...document.profile, name: '表单修改后的姓名' } };
    expect(exportStructuredMarkdown(visual)).toContain('表单修改后的姓名'); expect(getMarkdownSource(visual)).toBe(source); expect(exportMarkdown(visual)).toBe(source);
  });

  it('updates source deterministically while preserving identity, local photo and document presentation', () => {
    const base = createResume('mono'); base.title = '岗位 A'; base.profile.photoId = 'local-photo'; base.layout.accent = '#123456'; base.layout.marginTop = 55;
    base.sections[2].visible = false; base.sections[2].pageBreakBefore = true;
    const before = structuredClone(base);
    const source = '@[documentTitle](不应重命名现有文档)\n@[template](neat)\n@[name](新的姓名)\n@[avatar](https://example.com/photo.png)\n:::project\n@[name](新的项目)\n- 新的描述\n:::';
    const first = updateMarkdownSource(base, source), second = updateMarkdownSource(base, source);
    expect(first).toEqual(second); expect(base).toEqual(before);
    expect(first.document).toMatchObject({ id: base.id, title: base.title, createdAt: base.createdAt, updatedAt: base.updatedAt, revision: base.revision, templateId: base.templateId, editorMode: 'markdown', markdownSource: source });
    expect(first.document.profile.name).toBe('新的姓名'); expect(first.document.profile.photoId).toBe('local-photo'); expect(first.document.layout).toEqual(base.layout);
    expect(first.document.sections[0]).toMatchObject({ id: base.sections[2].id, visible: false, pageBreakBefore: true });
    expect(first.document.sections[0].items[0].id).toBe(base.sections[2].items[0].id); expect(first.document.sections[0].items[0].title).toBe('新的项目');
    expect(first.warnings.some(warning => warning.includes('头像'))).toBe(false);
  });

  it('lets source remain empty or incomplete and derives text only when no original source exists', () => {
    const legacy = createResume(); expect(getEditorMode(legacy)).toBe('visual'); expect(getMarkdownSource(legacy)).toBe(exportStructuredMarkdown(legacy));
    const empty = updateMarkdownSource(legacy, '').document; expect(getMarkdownSource(empty)).toBe(''); expect(exportMarkdown(empty)).toBe('');
    const incomplete = ':::education\n@[school](还在输入';
    const parsed = updateMarkdownSource(empty, incomplete);
    expect(parsed.document.markdownSource).toBe(incomplete); expect(parsed.warnings.some(warning => warning.includes('未闭合'))).toBe(true);
    expect(exportMarkdown(parsed.document)).toBe(incomplete);
  });

  it('keeps temporarily unparsable source and the previous valid preview without mutating either', () => {
    const base = createResume(), before = structuredClone(base), source = `@[name](${'张'.repeat(2001)})\n`;
    const result = updateMarkdownSource(base, source);
    expect(result.previewStale).toBe(true); expect(result.document.markdownSource).toBe(source); expect(result.document.profile).toEqual(base.profile); expect(result.document.sections).toEqual(base.sections);
    expect(result.warnings[0]).toContain('源码已保留'); expect(base).toEqual(before); expect(exportMarkdown(result.document)).toBe(source);
  });
});
