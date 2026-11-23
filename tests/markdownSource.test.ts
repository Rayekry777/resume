import { describe, expect, it } from 'vitest';
import { analyzeMarkdownSource, appendMarkdownBlock, insertMarkdownProfileField, matchMarkdownLineEndings, moveMarkdownBlock, removeMarkdownBlock, replaceMarkdownField, replaceMarkdownText } from '../src/lib/markdownSource';
import { parseMarkdown } from '../src/lib/markdown';

describe('range-based Markdown editing', () => {
  it('edits one field without regenerating whitespace, custom metadata or nested URL parentheses', () => {
    const source = '\uFEFF@[name](示例)  \r\n\r\n:::education\r\n  @[school](原大学)  \r\n@[customField](保留(这些)内容)\r\n\r\n- **正文**  \r\n:::\r\n';
    const school = analyzeMarkdownSource(source).blocks[0].fields[0];
    const updated = replaceMarkdownField(source, school.location, '新大学（软件学院）');
    expect(updated).toBe(source.replace('原大学', '新大学（软件学院）'));
    const named = insertMarkdownProfileField(updated, 'github', 'https://example.com/a(b(c))');
    expect(parseMarkdown(named).document.profile.github).toBe('https://example.com/a(b(c))');
    expect(named).toContain('@[customField](保留(这些)内容)\r\n');
  });

  it('keeps metadata interspersed with body text when one body region changes', () => {
    const source = ':::project\n@[name](项目 A)\n\n第一段正文\n@[extra](不要删除)\n\n第二段正文\n:::\n';
    const region = analyzeMarkdownSource(source).blocks[0], part = region.textParts.find(value => value.text.includes('第一段'))!;
    const updated = replaceMarkdownText(source, part.location, '\n新的第一段\n');
    expect(updated).toBe(source.replace('\n第一段正文\n', '\n新的第一段\n'));
    expect(updated).toContain('@[extra](不要删除)'); expect(updated).toContain('第二段正文');
  });

  it('appends a module to the original source using its line endings', () => {
    const source = '@[name](示例)\r\n\r\n保留原始内容  ';
    const updated = appendMarkdownBlock(source, 'education', '教育经历', ['school', 'major', 'time']);
    expect(updated.startsWith(source)).toBe(true); expect(updated).toContain(':::education 教育经历\r\n@[school]()\r\n@[major]()\r\n@[time]()\r\n');
    expect(updated.replace(/\r\n/g, '')).not.toContain('\n'); expect(analyzeMarkdownSource(updated).blocks).toHaveLength(1);
  });

  it('moves and removes whole original blocks without dropping intervening custom text', () => {
    const first = ':::education\n@[school](大学)\n:::\n', second = ':::custom 自定义模块\n@[unknown](原样保留)\n正文  \n:::\n';
    const source = '前言\n\n' + first + '\n<!-- 中间注释 -->\n\n' + second + '\n结尾\n';
    expect(moveMarkdownBlock(source, 1, -1)).toBe('前言\n\n' + second + '\n<!-- 中间注释 -->\n\n' + first + '\n结尾\n');
    expect(removeMarkdownBlock(source, 0)).toBe(source.replace(first, '')); expect(moveMarkdownBlock(source, 0, -1)).toBe(source);
  });

  it('exposes ordinary Markdown headings as editable blocks and leaves fenced examples as raw text', () => {
    const source = '# 示例姓名\n\n## 个人简介\n普通 **Markdown**。\n\n```md\n:::project\n@[name](代码示例)\n:::\n```\n';
    const analysis = analyzeMarkdownSource(source);
    expect(analysis.blocks.map(block => block.title)).toEqual(['个人简介']); expect(analysis.profileFields).toHaveLength(0);
    const body = analysis.blocks[0].textParts[0];
    expect(replaceMarkdownText(source, body.location, body.text.replace('普通', '新的'))).toBe(source.replace('普通', '新的'));
  });

  it('keeps the BOM and separates lines when the final block with no newline moves to the top', () => {
    const source = '\uFEFF## 第一块\r\n一\r\n:::skill\r\n二\r\n:::';
    const moved = moveMarkdownBlock(source, 1, -1);
    expect(moved).toBe('\uFEFF:::skill\r\n二\r\n:::\r\n## 第一块\r\n一');
    expect(analyzeMarkdownSource(moved).blocks.map(block => block.type)).toEqual(['skill', 'heading']);
    expect(moveMarkdownBlock(moved, 0, 1)).toBe(source);
  });

  it('keeps unfinished syntax editable and gives an inserted body its own closing line', () => {
    const source = ':::skill\n@[name](Java)\n:::own-module 自定义\n@[unfinished](还在输入';
    const analysis = analyzeMarkdownSource(source);
    expect(analysis.blocks).toHaveLength(2); expect(analysis.blocks.every(block => !block.closed)).toBe(true);
    expect(analysis.blocks[1].textParts.some(part => part.text.includes('@[unfinished]'))).toBe(true);
    const empty = ':::summary\n:::正文不会当作关闭行\n:::\n';
    expect(analyzeMarkdownSource(empty).blocks).toHaveLength(2);
    const clean = ':::summary\n:::\n', part = analyzeMarkdownSource(clean).blocks[0].textParts[0];
    expect(replaceMarkdownText(clean, part.location, '简介')).toBe(':::summary\n简介\n:::\n');
  });

  it('adds profile fields without duplicating keys or moving a BOM', () => {
    const source = '\uFEFF@[name](示例)\r\n\r\n# 简介\r\n内容';
    const inserted = insertMarkdownProfileField(source, 'email', 'hello@example.com');
    expect(inserted).toBe('\uFEFF@[name](示例)\r\n@[email](hello@example.com)\r\n\r\n# 简介\r\n内容');
    expect(insertMarkdownProfileField(inserted, 'Name')).toBe(inserted);
    expect(matchMarkdownLineEndings('a\nb\n', source)).toBe('a\r\nb\r\n');
  });
});
