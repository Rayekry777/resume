import { describe, expect, it } from 'vitest';
import { syncFormMarkdown } from '../src/lib/formMarkdown';
import { parseMarkdown, switchEditingView, updateMarkdownSource } from '../src/lib/markdown';

const source = '\uFEFF@[name](小林)  @[mobile](123)\r\n\r\n:::education\r\n@[school](示例学校)\r\n原文 **不动**  \r\n:::\r\n\r\n:::skills\r\n- CSS\r\n:::';
const form = () => switchEditingView(parseMarkdown(source).document);

describe('form edits on imported Markdown', () => {
  it('patches only the selected field, retaining BOM, aliases, spacing and CRLF', () => {
    const before = form();
    const after = syncFormMarkdown(before, { ...before, profile: { ...before.profile, phone: '456' } });
    expect(after.markdownSource).toBe(source.replace('(123)', '(456)'));
    expect(updateMarkdownSource(after, after.markdownSource!).document.profile.phone).toBe('456');
  });
  it('keeps raw Markdown when a local photo is replaced', () => {
    const before = form();
    expect(syncFormMarkdown(before, { ...before, profile: { ...before.profile, photoId: 'new-local-portrait' } }).markdownSource).toBe(source);
  });
  it('keeps unchanged modules byte-for-byte when editing, reordering or removing another module', () => {
    const before = form();
    const [education, skill] = before.sections;
    const renamed = { ...skill, title: '工具', visible: false };
    const after = syncFormMarkdown(before, { ...before, sections: [renamed,education] });
    expect(after.markdownSource).toContain(':::education\r\n@[school](示例学校)\r\n原文 **不动**  \r\n:::\r\n');
    const parsed = updateMarkdownSource(after, after.markdownSource!).document;
    expect(parsed.sections.map(s => [s.title,s.id,s.visible])).toEqual(after.sections.map(s => [s.title,s.id,s.visible]));
    expect(parsed.sections[1].items[0].description).toEqual(education.items[0].description);
    const removed = syncFormMarkdown(before, { ...before, sections: [skill] });
    expect(removed.markdownSource).toBe(source.slice(0, source.indexOf(':::education')) + source.slice(source.indexOf(':::skills')));
  });
  it('preserves a plain Markdown name heading when adding a contact', () => {
    const before = switchEditingView(parseMarkdown('\uFEFF# 小林\r\n\r\n## 工作经历\r\n原文').document);
    const after = syncFormMarkdown(before, { ...before, profile: { ...before.profile, city: '上海', name: '小吴' } });
    expect(after.markdownSource).toBe('\uFEFF# 小吴\r\n@[city](上海)\r\n\r\n## 工作经历\r\n原文');
    expect(parseMarkdown(after.markdownSource!).document.profile).toMatchObject({name:'小吴',city:'上海'});
  });
});
