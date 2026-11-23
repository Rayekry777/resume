import { SECTION_LABELS, getPresentationMode } from '../model';
import type { ResumeDocument, ResumeItem, ResumeProfile, ResumeSection, RichNode, SectionType } from '../model';
import { getTemplate, templateLayout } from '../templates';
import { closesMarkdownFence, markdownFence, markdownFieldParentheses } from './markdownDelimiters';
import { withMarkdownTemplate } from './markdownSource';
import { safeLink, sanitizeLinkText, sanitizeRichText, validateProfileExtraFields, validateResumeDocument } from './storage';

export interface MarkdownImportResult { document: ResumeDocument; warnings: string[] }
export interface MarkdownUpdateResult extends MarkdownImportResult { previewStale: boolean }
type SourceStatus = Pick<MarkdownUpdateResult, 'warnings' | 'previewStale'>;
const checkedSources = new WeakMap<ResumeDocument, SourceStatus>();
const sectionAliases: Record<string, SectionType> = {
  education: 'education', experience: 'experience', work: 'experience', internship: 'experience', project: 'project', projects: 'project', skill: 'skill', skills: 'skill', award: 'award', awards: 'award', research: 'research', portfolio: 'portfolio', summary: 'summary', introduction: 'summary', custom: 'custom',
  '教育经历': 'education', '教育背景': 'education', '工作经历': 'experience', '实习经历': 'experience', '项目经历': 'project', '项目经验': 'project', '专业技能': 'skill', '技能清单': 'skill', '个人技能': 'skill', '荣誉奖项': 'award', '获奖经历': 'award', '研究经历': 'research', '作品集': 'portfolio', '个人简介': 'summary', '自我评价': 'summary',
};

export function markdownSectionType(raw: string): SectionType {
  const key = raw.toLowerCase();
  return Object.hasOwn(sectionAliases, key) ? sectionAliases[key] : 'custom';
}

function parentheses(input: string): Map<number, number> {
  const matches = new Map<number, number>(), stack: number[] = [];
  for (let index = 0; index < input.length; index++) {
    if (input[index] === '\\') { index++; continue; }
    if (input[index] === '(') stack.push(index);
    if (input[index] === ')' && stack.length) matches.set(stack.pop()!, index);
  }
  return matches;
}
function unescapeValue(value: string): string { return value.replace(/\\([\\()[\]])/g, '$1'); }
export function escapeValue(value: string): string { return value.replace(/\\/g, '\\\\').replace(/[()]/g, char => `\\${char}`).replace(/\r?\n/g, ' '); }
function readFields(line: string): { fields: [string, string][]; remainder: string } {
  const fields: [string, string][] = [];
  const ends = markdownFieldParentheses(line);
  let remainder = '', cursor = 0;
  const matcher = /@\[([a-zA-Z][\w-]*)\]\(/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(line))) {
    let slashes = 0;
    for (let pos = match.index - 1; pos >= 0 && line[pos] === '\\'; pos--) slashes++;
    if (slashes % 2) continue;
    const end = ends.get(matcher.lastIndex - 1) ?? -1;
    if (end < 0) break;
    remainder += line.slice(cursor, match.index);
    fields.push([match[1], unescapeValue(line.slice(matcher.lastIndex, end))]); cursor = end + 1; matcher.lastIndex = cursor;
  }
  return { fields, remainder: remainder + line.slice(cursor) };
}

function inlineMarkdown(source: string, warnings: Set<string>, depth = 0): RichNode[] {
  if (depth > 8) return [{ type: 'text', text: source }];
  const nodes: RichNode[] = [];
  const ends = parentheses(source);
  const fieldEnds = source.includes('\\@[') ? markdownFieldParentheses(source) : undefined;
  let nextLabelEnd = source.indexOf('](');
  let buffer = '';
  const flush = () => { if (buffer) { nodes.push({ type: 'text', text: buffer }); buffer = ''; } };
  for (let index = 0; index < source.length;) {
    if (fieldEnds && source.startsWith('\\@[', index)) {
      const open = source.indexOf('](', index + 3);
      const end = fieldEnds.get(open + 1);
      if (open > index && end !== undefined && /^[a-zA-Z][\w-]*$/.test(source.slice(index + 3, open))) {
        buffer += source.slice(index + 1, end + 1); index = end + 1; continue;
      }
    }
    if (source[index] === '\\' && index + 1 < source.length) { buffer += source[index + 1]; index += 2; continue; }
    const image = source.startsWith('![', index), linkStart = image ? index + 1 : index;
    if (source[linkStart] === '[') {
      if (nextLabelEnd <= linkStart) nextLabelEnd = source.indexOf('](', linkStart + 1);
      const labelEnd = nextLabelEnd;
      if (labelEnd >= 0) {
        const end = ends.get(labelEnd + 1) ?? -1;
        if (end >= 0) {
          flush();
          const label = source.slice(linkStart + 1, labelEnd), href = safeLink(unescapeValue(source.slice(labelEnd + 2, end)));
          if (image) { warnings.add('Markdown 中的图片未加载，请在编辑器中选择本地照片；照片请使用 ZIP 备份迁移'); nodes.push({ type: 'text', text: label ? `[图片：${label}]` : '[图片]' }); }
          else { const children = inlineMarkdown(label, warnings, depth + 1); for (const child of children) { if (href && child.type === 'text') child.marks = [...child.marks ?? [], { type: 'link', attrs: { href } }]; nodes.push(child); } if (!href) warnings.add('已移除不受支持的链接协议'); }
          index = end + 1; continue;
        }
      }
    }
    let formatted = false;
    for (const [token, type] of [['**', 'bold'], ['__', 'bold'], ['~~', 'strike'], ['`', 'code'], ['*', 'italic'], ['_', 'italic']] as const) {
      if (!source.startsWith(token, index)) continue;
      const end = source.indexOf(token, index + token.length);
      if (end <= index + token.length) continue;
      flush();
      const children = type === 'code' ? [{ type: 'text', text: source.slice(index + token.length, end) } as RichNode] : inlineMarkdown(source.slice(index + token.length, end), warnings, depth + 1);
      for (const child of children) { if (child.type === 'text') child.marks = [...child.marks ?? [], { type }]; nodes.push(child); }
      index = end + token.length; formatted = true; break;
    }
    if (!formatted) { buffer += source[index]; index++; }
  }
  flush(); return nodes;
}

function parseBody(lines: string[], warnings: Set<string>): RichNode {
  const content: RichNode[] = [];
  let paragraph: string[] = [], list: RichNode | undefined;
  const flushParagraph = () => {
    if (paragraph.length) { content.push({ type: 'paragraph', content: paragraph.flatMap((line, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...inlineMarkdown(line, warnings)]) }); paragraph = []; }
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) { flushParagraph(); list = undefined; continue; }
    const fence = markdownFence(line);
    if (fence) {
      flushParagraph(); list = undefined; const code: string[] = [];
      while (++index < lines.length && !closesMarkdownFence(lines[index], fence)) code.push(lines[index]);
      content.push({ type: 'codeBlock', content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] }); continue;
    }
    const bullet = line.match(/^\s*[-+*]\s+(.+)$/), ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (bullet || ordered) {
      flushParagraph(); const type = bullet ? 'bulletList' : 'orderedList';
      if (!list || list.type !== type) { list = { type, ...(ordered ? { attrs: { start: Number(ordered[1]) || 1 } } : {}), content: [] }; content.push(list); }
      list.content!.push({ type: 'listItem', content: [{ type: 'paragraph', content: inlineMarkdown(bullet ? bullet[1] : ordered![2], warnings) }] }); continue;
    }
    list = undefined;
    const heading = line.match(/^(#{1,6})\s+(.+)$/), quote = line.match(/^>\s?(.*)$/);
    if (heading) { flushParagraph(); content.push({ type: 'heading', attrs: { level: heading[1].length }, content: inlineMarkdown(heading[2], warnings) }); }
    else if (quote) { flushParagraph(); content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: inlineMarkdown(quote[1], warnings) }] }); }
    else if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { flushParagraph(); content.push({ type: 'horizontalRule' }); }
    else paragraph.push(line);
  }
  flushParagraph(); return sanitizeRichText({ type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] });
}

// Keep attributes without a Markdown spelling when the author edits text in
// a paragraph. Markdown-supported marks (bold, links, etc.) come from source.
function preserveInlineStyle(previous: RichNode, edited: RichNode): RichNode {
  if (previous.type !== edited.type || !['paragraph', 'heading'].includes(edited.type)) return edited;
  const children = previous.content ?? [];
  const flattened = (nodes: RichNode[]) => nodes.map(node => node.type === 'hardBreak' ? '\n' : node.text ?? '').join('');
  const before = flattened(children), after = flattened(edited.content ?? []);
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  // An unrelated replacement paragraph should not inherit styles simply because
  // it occupies the same index. For a whole replacement preserve only its own source.
  if (!prefix && !suffix) return edited;
  type Range = { start: number; end: number; marks: NonNullable<RichNode['marks']> };
  const ranges: Range[] = [];
  let offset = 0;
  for (const child of children) {
    const end = offset + (child.type === 'hardBreak' ? 1 : (child.text ?? '').length);
    const marks = child.marks?.filter(mark => mark.type === 'underline' || mark.type === 'textStyle');
    if (marks?.length) {
      if (offset < prefix) ranges.push({ start: offset, end: Math.min(end, prefix), marks });
      if (end > before.length - suffix) {
        const delta = after.length - before.length;
        ranges.push({ start: Math.max(offset, before.length - suffix) + delta, end: end + delta, marks });
      }
    }
    offset = end;
  }
  let cursor = 0, rangeIndex = 0;
  const content: RichNode[] = [];
  for (const child of edited.content ?? []) {
    if (child.type !== 'text' || !child.text) {
      content.push(child);
      if (child.type === 'hardBreak') cursor++;
      continue;
    }
    const start = cursor, end = start + child.text.length;
    while (cursor < end) {
      while (ranges[rangeIndex] && ranges[rangeIndex].end <= cursor) rangeIndex++;
      const range = ranges[rangeIndex];
      const within = range && range.start <= cursor;
      const stop = Math.min(end, within ? range.end : range?.start ?? end);
      content.push({ ...child, text: child.text.slice(cursor - start, stop - start), ...(within ? { marks: [...child.marks ?? [], ...range.marks] } : {}) });
      cursor = stop;
    }
  }
  const attrs = { ...previous.attrs, ...edited.attrs };
  return { ...edited, content, ...(Object.keys(attrs).length ? { attrs } : {}) };
}

// Reuse original rich nodes wherever their editable source is unchanged.
function parseProjectedBody(lines: string[], original: RichNode, warnings: Set<string>): RichNode {
  const source = lines.join('\n').replace(/^\n+|\n+$/g, '');
  if (exportBody(original).replace(/^\n+|\n+$/g, '') === source) return original;
  const parsed = parseBody(lines, warnings);
  const originalNodes = new Map<string, RichNode[]>();
  for (const node of original.content ?? []) {
    // Compare the parser's own projection; rich marks which have no spelling
    // are intentionally absent from this key but remain on the retained node.
    const projected = parseBody(exportBody(node).split('\n'), new Set()).content ?? [];
    if (projected.length !== 1) continue;
    const key = JSON.stringify(projected[0]);
    if (!originalNodes.has(key)) originalNodes.set(key, []);
    originalNodes.get(key)!.push(node);
  }
  const edited = parsed.content ?? [];
  const matched = edited.map(node => originalNodes.get(JSON.stringify(node))?.shift());
  const surviving = new Set(matched);
  return { ...parsed, content: edited.map((node, index) => {
    if (matched[index]) return matched[index]!;
    const previous = original.content?.[index];
    return previous && !surviving.has(previous) ? preserveInlineStyle(previous, node) : node;
  }) };
}

/** Parse with no clock, randomness or storage access, so source updates are deterministic. */
function parseSource(source: string, base: ResumeDocument, preserveDocumentSettings: boolean): MarkdownImportResult {
  if (typeof source !== 'string' || source.length > 2_000_000) throw new Error('Markdown 文件过大，最多支持 2 MB 文本');
  const warnings = new Set<string>();
  const document: ResumeDocument = { ...base, profile: { name: '', title: '', email: '', phone: '', city: '', website: '', github: '', status: '', ...(base.profile.photoId ? { photoId: base.profile.photoId } : {}) }, sections: [], layout: { ...base.layout }, editorMode: 'markdown', markdownSource: source };
  // Legacy source can predate imported extra fields. Editing that source must retain them.
  if (preserveDocumentSettings && base.profile.extraFields) document.profile.extraFields = base.profile.extraFields.map(field => ({ ...field }));
  let section: ResumeSection | undefined, item: ResumeItem | undefined, fenced = false, codeFence: string | undefined, explicitTitle = false, explicitExtraFields = false;
  const bodies = new Map<string, string[]>();
  const previousSections = preserveDocumentSettings ? base.sections : [];
  const reservedIds = new Set(previousSections.flatMap(entry => [entry.id, ...entry.items.map(value => value.id)]));
  const usedIds = new Set<string>(), matchedSections = new Set<string>();
  const previousBySection = new Map<string, ResumeSection>();
  const previousItems = new Map(previousSections.flatMap(entry => entry.items.map(value => [value.id, value] as const)));
  const taggedItems = new Set<string>();
  let idSequence = 0;
  const allocateId = (kind: 'section' | 'item') => {
    let id: string;
    do { id = `${base.id.slice(0, 140)}-md-${kind}-${++idSequence}`; } while (usedIds.has(id) || reservedIds.has(id));
    usedIds.add(id); return id;
  };
  const newEntry = (itemId?: string) => {
    if (!section) return;
    const previous = previousBySection.get(section.id)?.items[section.items.length];
    const candidate = itemId ?? previous?.id;
    const id = candidate && !usedIds.has(candidate) ? candidate : allocateId('item'); usedIds.add(id);
    if (itemId) taggedItems.add(id);
    item = { id, title: '', subtitle: '', location: '', startDate: '', endDate: '', url: '', description: { type: 'doc', content: [{ type: 'paragraph' }] } };
    section.items.push(item); bodies.set(item.id, []);
  };
  const startSection = (rawType: string, label?: string, sectionId?: string, itemId?: string) => {
    const type = markdownSectionType(rawType);
    const sectionTitle = label?.trim() || (type === 'custom' ? rawType : SECTION_LABELS[type]);
    section = document.sections.find(entry => sectionId ? entry.id === sectionId : entry.type === type && entry.title === sectionTitle);
    if (!section) {
      if (document.sections.length >= 80) throw new Error('Markdown 模块过多');
      const previous = sectionId ? previousSections.find(entry => entry.id === sectionId) : previousSections.find(entry => !matchedSections.has(entry.id) && entry.type === type && entry.title === sectionTitle) ?? previousSections.find(entry => !matchedSections.has(entry.id) && entry.type === type);
      const id = sectionId ?? previous?.id ?? allocateId('section'); usedIds.add(id);
      if (previous) { matchedSections.add(previous.id); previousBySection.set(id, previous); }
      section = { id, type, title: sectionTitle, visible: previous?.visible ?? true, pageBreakBefore: previous?.pageBreakBefore ?? false, items: [] }; document.sections.push(section);
    }
    item = undefined;
    if (!sectionId || itemId) newEntry(itemId);
  };
  const appendBody = (line: string) => {
    if (!section) startSection('summary');
    if (!item && !line.trim()) return;
    if (!item) newEntry();
    bodies.get(item!.id)!.push(line);
  };
  const applyField = (key: string, value: string) => {
    const field = key.toLowerCase();
    if (['avatar', 'photo', 'photoid'].includes(field)) { if (value && !document.profile.photoId) warnings.add('请选择本地头像。'); return; }
    if (!section) {
      const aliases: Record<string, keyof Omit<ResumeProfile, 'photoId' | 'extraFields'>> = { name: 'name', position: 'title', title: 'title', email: 'email', phone: 'phone', mobile: 'phone', city: 'city', address: 'city', website: 'website', github: 'github', status: 'status' };
      const profileKey = Object.hasOwn(aliases, field) ? aliases[field] : undefined;
      if (profileKey) { document.profile[profileKey] = ['website', 'github'].includes(profileKey) ? sanitizeLinkText(value) : value; if (value && ['website', 'github'].includes(profileKey) && !document.profile[profileKey]) warnings.add('已移除不受支持的链接协议'); return; }
      if (field === 'documenttitle') { if (!preserveDocumentSettings) document.title = value; explicitTitle = true; return; }
      if (field === 'template') {
        if (!preserveDocumentSettings) document.templateId = getTemplate(value).id;
        return;
      }
      if (field === 'presentationmode') {
        if (!preserveDocumentSettings && (value === 'visual' || value === 'markdown')) document.presentationMode = value;
        return;
      }
      if (field === 'profileextra') {
        let extra: unknown;
        try { extra = JSON.parse(value); } catch { throw new Error('简历附加信息 JSON 格式无效'); }
        document.profile.extraFields = validateProfileExtraFields([...(explicitExtraFields ? document.profile.extraFields ?? [] : []), extra]);
        explicitExtraFields = true; return;
      }
      appendBody(`${key}：${value}`); warnings.add('部分自定义元信息已保留为正文'); return;
    }
    if (field === 'sectionid' || field === 'itemid') return;
    if (field === 'sectionvisible') { section.visible = value !== 'false'; return; }
    if (field === 'pagebreakbefore') { section.pageBreakBefore = value === 'true'; return; }
    if (!item) newEntry();
    if (['name', 'school', 'company', 'organization', 'title'].includes(field)) { if (item!.title) newEntry(); item!.title = value; }
    else if (['subtitle', 'major', 'degree', 'degreetype', 'position', 'role', 'department', 'job'].includes(field)) item!.subtitle = [item!.subtitle, value].filter(Boolean).join(' · ');
    else if (['location', 'city', 'address'].includes(field)) item!.location = value;
    else if (['startdate', 'start'].includes(field)) item!.startDate = value;
    else if (['enddate', 'end'].includes(field)) item!.endDate = value;
    else if (['url', 'link', 'website', 'github'].includes(field)) { item!.url = sanitizeLinkText(value); if (value && !item!.url) warnings.add('已移除不受支持的链接协议'); }
    else if (['time', 'date', 'duration'].includes(field)) {
      const range = value.match(/^(\d{4}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?)([ \t]*(?:至|到|--|—|–|~|～|-)[ \t]*)(.+)$/);
      if (range) { item!.startDate = range[1]; item!.dateSeparator = range[2]; item!.endDate = range[3]; } else item!.startDate = value;
    } else { appendBody(`${key}：${value}`); warnings.add('部分自定义元信息已保留为正文'); }
  };
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 30000) throw new Error('Markdown 行数过多');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (codeFence) {
      appendBody(line);
      if (closesMarkdownFence(line, codeFence)) codeFence = undefined;
      continue;
    }
    const marker = markdownFence(line);
    if (marker) { codeFence = marker; appendBody(line); continue; }
    const directive = line.match(/^\s*:::\s*([\w\u4e00-\u9fff-]+)(?:\s+(.+))?\s*$/);
    if (directive) {
      if (fenced) warnings.add('发现未闭合的模块，已按新模块继续导入');
      const metadata = new Map(readFields(lines[lineIndex + 1] ?? '').fields);
      startSection(directive[1], directive[2], metadata.get('sectionId'), metadata.get('itemId'));
      fenced = true; continue;
    }
    if (/^\s*:::\s*$/.test(line)) { section = undefined; item = undefined; fenced = false; continue; }
    const fields = readFields(line);
    if (fields.fields.length) { for (const [key, value] of fields.fields) applyField(key, value); if (fields.remainder.trim()) appendBody(fields.remainder); continue; }
    const moduleHeading = line.match(/^##\s+(.+)$/), itemHeading = line.match(/^###\s+(.+)$/), mainHeading = line.match(/^#\s+(.+)$/);
    if (moduleHeading && !fenced) { startSection(moduleHeading[1]); continue; }
    if (itemHeading && section && !fenced) { if (item && (item.title || bodies.get(item.id)?.some(body => body.trim()))) newEntry(); item!.title = itemHeading[1]; continue; }
    if (mainHeading && !document.profile.name && !section) { document.profile.name = mainHeading[1]; continue; }
    if (line.trim() || section) appendBody(line);
  }
  if (fenced) warnings.add('最后一个模块未闭合，已保留其中内容');
  for (const entry of document.sections) {
    for (const value of entry.items) {
      const lines = bodies.get(value.id) ?? [];
      const previous = taggedItems.has(value.id) ? previousItems.get(value.id) : undefined;
      value.description = previous ? parseProjectedBody(lines, previous.description, warnings) : parseBody(lines, warnings);
    }
  }
  if (!preserveDocumentSettings && document.profile.name && base.title === '导入的简历' && !explicitTitle) document.title = `${document.profile.name}的简历`;
  if (!document.sections.length) warnings.add('未识别到经历模块，可在编辑器中添加');
  if (document.sections.reduce((count, entry) => count + entry.items.length, 0) > 1000) throw new Error('Markdown 条目过多');
  if (!preserveDocumentSettings) document.layout = templateLayout(document.templateId, getPresentationMode(document));
  return { document: validateResumeDocument(document), warnings: [...warnings] };
}

/** Import a new source document; the exact input survives local saves and ZIP backups. */
export function parseMarkdown(source: string, title = '导入的简历'): MarkdownImportResult {
  const now = Date.now();
  const base: ResumeDocument = { id: crypto.randomUUID(), schemaVersion: 1, title, createdAt: now, updatedAt: now, revision: 0, templateId: 'neat', profile: { name: '', title: '', email: '', phone: '', city: '', website: '', github: '', status: '' }, sections: [], layout: templateLayout('neat', 'markdown') };
  return parseSource(source, base, false);
}

/** Merge source-derived content into a document without touching identity, photo or layout. */
export function updateMarkdownSource(document: ResumeDocument, source: string): MarkdownUpdateResult {
  if (typeof source !== 'string' || source.length > 2_000_000) throw new Error('Markdown 文件过大，最多支持 2 MB 文本');
  const base = validateResumeDocument(document);
  let result: MarkdownUpdateResult;
  try { result = { ...parseSource(source, base, true), previewStale: false }; }
  catch (error) {
    // Source is the editable document. A temporarily unparsable draft must still
    // be saveable; retain the last valid structured projection for the preview.
    result = { document: { ...base, editorMode: 'markdown', markdownSource: source }, warnings: [`源码已保留，预览为上次有效版本。请修正后导出 PDF 或图片。${error instanceof Error ? error.message : ''}`], previewStale: true };
  }
  checkedSources.set(result.document, { warnings: result.warnings, previewStale: result.previewStale });
  return result;
}

/** A timestamp-only save wrapper retains the validity of the parsed source. */
export function carrySourceStatus(from: ResumeDocument, to: ResumeDocument): ResumeDocument {
  const status = checkedSources.get(from);
  if (status && from.markdownSource === to.markdownSource && from.profile === to.profile && from.sections === to.sections && from.layout === to.layout) {
    checkedSources.set(to, status);
  }
  return to;
}

/** Check persisted source too; an invalid draft can survive reload, import and history restore. */
export function getSourceStatus(document: ResumeDocument): SourceStatus {
  if (document.markdownSource === undefined) return { warnings: [], previewStale: false };
  const cached = checkedSources.get(document);
  if (cached) return cached;
  const { warnings, previewStale } = updateMarkdownSource(document, document.markdownSource);
  const result = { warnings, previewStale };
  checkedSources.set(document, result);
  return result;
}

/** Restore fields older parsers lost, using the original Markdown as evidence.
 * Keep any structured content that no longer agrees with the saved source. */
export function repairLegacyMarkdownProjection(document: ResumeDocument): ResumeDocument {
  if (getPresentationMode(document) !== 'markdown' || !document.markdownSource) return document;
  function hasMisparsedName(node: RichNode): boolean {
    return node.type === 'text' ? /^@\[name\]\(.*[（）]/i.test(node.text ?? '') : !!node.content?.some(hasMisparsedName);
  }
  const items = document.sections.flatMap(section => section.items);
  const staleNames = new Set(items.filter(item => !item.title && hasMisparsedName(item.description)).map(item => item.id));
  const needsDates = /@\[(?:time|duration|date)\]/i.test(document.markdownSource)
    && items.some(item => item.startDate && item.endDate && item.dateSeparator === undefined);
  if (!staleNames.size && !needsDates) return document;
  const updated = updateMarkdownSource(document, document.markdownSource);
  if (updated.previewStale) return document;
  const projection = new Map(updated.document.sections.flatMap(section => section.items).map(item => [item.id, item]));
  return { ...document, sections: document.sections.map(section => ({ ...section, items: section.items.map(item => {
    const parsed = projection.get(item.id);
    if (!parsed) return item;
    const repairName = staleNames.has(item.id) && parsed.title;
    const repairDate = item.dateSeparator === undefined && parsed.dateSeparator !== undefined
      && parsed.startDate === item.startDate && parsed.endDate === item.endDate;
    if (!repairName && !repairDate) return item;
    return { ...item, ...(repairName ? { title: parsed.title, description: parsed.description } : {}),
      ...(repairDate ? { dateSeparator: parsed.dateSeparator } : {}) };
  }) })) };
}

/** Changing the UI never projects source back into structured fields or resets typography. */
export function switchEditingView(document: ResumeDocument): ResumeDocument {
  const editorMode = getEditorMode(document) === 'visual' ? 'markdown' : 'visual';
  const presentationMode = getPresentationMode(document);
  return { ...document, editorMode, presentationMode, markdownSource: getMarkdownSource(document),
    ...(editorMode === 'markdown' ? { markdownView: 'source' as const } : {}) };
}

export async function readMarkdownFile(file: Blob): Promise<string> {
  // TextDecoder ignores the BOM signature itself when ignoreBOM is true, preserving U+FEFF.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await file.arrayBuffer());
}

export function getEditorMode(document: ResumeDocument): 'visual' | 'markdown' { return document.editorMode ?? (typeof document.markdownSource === 'string' ? 'markdown' : 'visual'); }

/** Return saved source verbatim; generate text only for a legacy/visual document without source. */
export function getMarkdownSource(document: ResumeDocument): string { return typeof document.markdownSource === 'string' ? document.markdownSource : exportStructuredMarkdown(document); }

function exportInline(node: RichNode): string {
  if (node.type === 'hardBreak') return '\n';
  let value = node.text?.replace(/[\\*_[\]`~]/g, char => `\\${char}`) ?? (node.content ?? []).map(exportInline).join('');
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') value = `**${value}**`;
    else if (mark.type === 'italic') value = `*${value}*`;
    else if (mark.type === 'strike') value = `~~${value}~~`;
    else if (mark.type === 'code') value = `\`${value}\``;
    else if (mark.type === 'link') { const href = safeLink(mark.attrs?.href); if (href) value = `[${value}](${escapeValue(href)})`; }
  }
  return value;
}
function exportBody(node: RichNode): string {
  if (node.type === 'doc') return (node.content ?? []).map(exportBody).join('\n\n');
  if (node.type === 'bulletList' || node.type === 'orderedList') return (node.content ?? []).map((item, index) => `${node.type === 'bulletList' ? '-' : `${Number(node.attrs?.start ?? 1) + index}.`} ${(item.content ?? []).map(exportBody).join('\n  ').replace(/\n/g, '\n  ')}`).join('\n');
  if (node.type === 'heading') return `${'#'.repeat(Math.min(6, Math.max(1, Number(node.attrs?.level ?? 3))))} ${exportInline(node)}`;
  if (node.type === 'blockquote') return (node.content ?? []).map(exportBody).join('\n').split('\n').map(line => `> ${line}`).join('\n');
  if (node.type === 'codeBlock') return `\`\`\`\n${(node.content ?? []).map(child => child.text ?? '').join('')}\n\`\`\``;
  if (node.type === 'horizontalRule') return '---';
  return exportInline(node);
}
const field = (name: string, value: string) => `@[${name}](${escapeValue(value)})`;
export function exportSectionLines(section: ResumeSection): string[] {
  const lines: string[] = [];
  const header = `:::${section.type} ${section.title}`;
  const sectionKey = field('sectionId', section.id);
  const flags = [field('sectionVisible', String(section.visible)), field('pageBreakBefore', String(section.pageBreakBefore))];
  if (!section.items.length) lines.push(header, sectionKey, ...flags, ':::', '');
  for (const item of section.items) {
    lines.push(header, sectionKey + ' ' + field('itemId', item.id), ...flags, field('name', item.title), field('subtitle', item.subtitle), field('location', item.location), ...(item.dateSeparator && item.startDate && item.endDate ? [field('time', item.startDate + item.dateSeparator + item.endDate)] : [field('startDate', item.startDate), field('endDate', item.endDate)]), field('url', item.url), '', exportBody(item.description), ':::', '');
  }
  return lines;
}

/** Explicit conversion for visual documents; callers must choose to replace any existing source. */
export function exportStructuredMarkdown(input: ResumeDocument): string {
  const document = validateResumeDocument(input);
  const lines = [field('documentTitle', document.title), field('name', document.profile.name), field('position', document.profile.title), field('phone', document.profile.phone), field('email', document.profile.email), field('city', document.profile.city), field('status', document.profile.status), field('website', document.profile.website), field('github', document.profile.github), ...(document.profile.extraFields ?? []).map(extra => field('profileExtra', JSON.stringify(extra))), field('template', document.templateId), ...(getPresentationMode(document) === 'visual' ? [field('presentationMode', 'visual')] : []), ''];
  for (const section of document.sections) lines.push(...exportSectionLines(section));
  return lines.join('\n').trimEnd() + '\n';
}

/** Only an explicit design change needs a metadata patch in the downloaded source. */
export function exportMarkdown(document: ResumeDocument): string {
  if (document.markdownSource === undefined) return exportStructuredMarkdown(document);
  return document.markdownExportTemplate
    ? withMarkdownTemplate(document.markdownSource, document.templateId, getPresentationMode(document))
    : document.markdownSource;
}
