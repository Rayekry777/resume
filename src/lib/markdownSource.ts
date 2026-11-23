import { closesMarkdownFence, markdownFence, markdownFieldParentheses } from './markdownDelimiters';

/** Source ranges for the Markdown edit view. All edits preserve unrelated bytes. */
export interface MarkdownRegionLocation { kind: 'block' | 'outside'; index: number }
export interface MarkdownFieldLocation extends MarkdownRegionLocation { fieldIndex: number }
export interface MarkdownTextLocation extends MarkdownRegionLocation { textIndex: number }
export interface MarkdownSourceField {
  key: string; value: string; start: number; end: number; valueStart: number; valueEnd: number; lineEnd: number; location: MarkdownFieldLocation;
}
export interface MarkdownSourceText { start: number; end: number; text: string; location: MarkdownTextLocation }
export interface MarkdownSourceRegion {
  kind: 'block' | 'outside'; index: number; start: number; end: number; contentStart: number; contentEnd: number;
  type: string; title: string; closed: boolean; fields: MarkdownSourceField[]; textParts: MarkdownSourceText[];
}
export interface MarkdownSourceAnalysis { regions: MarkdownSourceRegion[]; blocks: MarkdownSourceRegion[]; outside: MarkdownSourceRegion[]; profileFields: MarkdownSourceField[] }
interface SourceLine { start: number; end: number; text: string }

export function markdownLineEnding(source: string): string { return source.match(/\r\n|\r|\n/)?.[0] ?? '\n'; }
export function matchMarkdownLineEndings(value: string, source: string): string { return value.replace(/\r\n|\r|\n/g, markdownLineEnding(source)); }
function lines(source: string, offset = 0): SourceLine[] {
  const result: SourceLine[] = []; const matcher = /[^\r\n]*(?:\r\n|\r|\n|$)/g; let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) && match[0].length) result.push({ start: offset + match.index, end: offset + matcher.lastIndex, text: match[0].replace(/(?:\r\n|\r|\n)$/, '') });
  return result;
}
function fieldValue(value: string): string { return value.replace(/\\([\\()[\]])/g, '$1'); }
function escapedValue(value: string): string { return value.replace(/\r\n|\r|\n/g, ' ').replace(/\\/g, '\\\\').replace(/[()]/g, token => `\\${token}`); }
function fillRegion(source: string, region: MarkdownSourceRegion): MarkdownSourceRegion {
  let codeFence: string | undefined, cursor = region.contentStart;
  const fieldLines: { line: SourceLine; fields: Omit<MarkdownSourceField, 'location'>[] }[] = [];
  for (const line of lines(source.slice(region.contentStart, region.contentEnd), region.contentStart)) {
    const marker = markdownFence(line.text);
    if (marker) { if (!codeFence) codeFence = marker; else if (closesMarkdownFence(line.text, codeFence)) codeFence = undefined; continue; }
    if (codeFence) continue;
    const fields: Omit<MarkdownSourceField, 'location'>[] = [], ends = markdownFieldParentheses(line.text);
    const matcher = /@\[([a-zA-Z][\w-]*)\]\(/g; let match: RegExpExecArray | null, remainder = '', last = 0;
    while ((match = matcher.exec(line.text))) {
      let slashes = 0; for (let index = match.index - 1; index >= 0 && line.text[index] === '\\'; index--) slashes++;
      if (slashes % 2) continue;
      const end = ends.get(matcher.lastIndex - 1); if (end === undefined) continue;
      remainder += line.text.slice(last, match.index);
      fields.push({ key: match[1], value: fieldValue(line.text.slice(matcher.lastIndex, end)), start: line.start + match.index, end: line.start + end + 1, valueStart: line.start + matcher.lastIndex, valueEnd: line.start + end, lineEnd: line.end });
      last = end + 1; matcher.lastIndex = last;
    }
    remainder += line.text.slice(last);
    // Mixed prose/metadata and unfinished syntax remain editable as raw body text.
    if (fields.length && !remainder.trim()) fieldLines.push({ line, fields });
  }
  const addText = (start: number, end: number) => { if (end > start) region.textParts.push({ start, end, text: source.slice(start, end), location: { kind: region.kind, index: region.index, textIndex: region.textParts.length } }); };
  for (const { line, fields } of fieldLines) {
    addText(cursor, line.start); cursor = line.end;
    for (const field of fields) region.fields.push({ ...field, location: { kind: region.kind, index: region.index, fieldIndex: region.fields.length } });
  }
  addText(cursor, region.contentEnd);
  if (!region.textParts.length) region.textParts.push({ start: region.contentEnd, end: region.contentEnd, text: '', location: { kind: region.kind, index: region.index, textIndex: 0 } });
  return region;
}

export function analyzeMarkdownSource(source: string): MarkdownSourceAnalysis {
  const result: MarkdownSourceAnalysis = { regions: [], blocks: [], outside: [], profileFields: [] };
  let current: { start: number; contentStart: number; type: string; title: string; heading: boolean } | undefined, outsideStart = 0, codeFence: string | undefined;
  const outside = (start: number, end: number) => { if (end <= start) return; const region = fillRegion(source, { kind: 'outside', index: result.outside.length, start, end, contentStart: start, contentEnd: end, type: '', title: '', closed: true, fields: [], textParts: [] }); result.regions.push(region); result.outside.push(region); result.profileFields.push(...region.fields); };
  const block = (end: number, contentEnd: number, closed: boolean) => {
    if (!current) return;
    const region = fillRegion(source, { kind: 'block', index: result.blocks.length, start: current.start, end, contentStart: current.contentStart, contentEnd, type: current.type, title: current.title, closed, fields: [], textParts: [] });
    result.blocks.push(region); result.regions.push(region); current = undefined; outsideStart = end;
  };
  for (const line of lines(source)) {
    const marker = markdownFence(line.text);
    if (marker) { if (!codeFence) codeFence = marker; else if (closesMarkdownFence(line.text, codeFence)) codeFence = undefined; continue; }
    if (codeFence) continue;
    const opening = line.text.match(/^\s*:::\s*([\w\u4e00-\u9fff-]+)(?:[ \t]+(.+?))?[ \t]*$/);
    const heading = (!current || current.heading) && line.text.replace(/^\uFEFF/, '').match(/^##[ \t]+(.+?)\s*$/);
    if (opening || heading) {
      const start = line.start === 0 && source.startsWith('\uFEFF') ? 1 : line.start;
      if (current) block(start, start, current.heading); else outside(outsideStart, start);
      current = { start, contentStart: line.end, type: opening?.[1] ?? 'heading', title: opening?.[2] ?? (heading ? heading[1] : ''), heading: Boolean(heading) }; continue;
    }
    if (current && !current.heading && /^\s*:::\s*$/.test(line.text)) block(line.end, line.start, true);
  }
  if (current) block(source.length, source.length, current.heading); else outside(outsideStart, source.length);
  if (!result.regions.length) { const region = fillRegion(source, { kind: 'outside', index: 0, start: 0, end: 0, contentStart: 0, contentEnd: 0, type: '', title: '', closed: true, fields: [], textParts: [] }); result.outside.push(region); result.regions.push(region); }
  return result;
}

function resolveRegion(source: string, location: MarkdownRegionLocation): MarkdownSourceRegion {
  const analysis = analyzeMarkdownSource(source), region = (location.kind === 'block' ? analysis.blocks : analysis.outside)[location.index];
  if (!region) throw new Error('源码模块已变化，请重新选择要编辑的内容'); return region;
}
function replace(source: string, start: number, end: number, value: string): string { return source.slice(0, start) + value + source.slice(end); }
export function replaceMarkdownField(source: string, location: MarkdownFieldLocation, value: string): string {
  const field = resolveRegion(source, location).fields[location.fieldIndex]; if (!field) throw new Error('源码信息项已变化，请重试');
  return replace(source, field.valueStart, field.valueEnd, escapedValue(value));
}
export function replaceMarkdownText(source: string, location: MarkdownTextLocation, value: string): string {
  const region = resolveRegion(source, location), part = region.textParts[location.textIndex]; if (!part) throw new Error('源码正文已变化，请重试');
  let next = matchMarkdownLineEndings(value, source);
  if (region.kind === 'block' && region.closed && part.end === region.contentEnd && part.end < source.length && next && !/[\r\n]$/.test(next)) next += markdownLineEnding(source);
  return replace(source, part.start, part.end, next);
}
export function removeMarkdownBlock(source: string, index: number): string { const region = resolveRegion(source, { kind: 'block', index }); return replace(source, region.start, region.end, ''); }
export function moveMarkdownBlock(source: string, index: number, delta: -1 | 1): string {
  const blocks = analyzeMarkdownSource(source).blocks, other = index + delta;
  if (!blocks[index] || !blocks[other]) return source;
  const first = blocks[Math.min(index, other)], second = blocks[Math.max(index, other)];
  // Keep the terminating newline with its original position. A final block
  // without one still needs a newline when it moves between two other blocks.
  const firstText = source.slice(first.start, first.end), secondText = source.slice(second.start, second.end);
  const firstEol = firstText.match(/(?:\r\n|\r|\n)$/)?.[0] ?? '';
  const secondEol = secondText.match(/(?:\r\n|\r|\n)$/)?.[0] ?? '';
  return source.slice(0, first.start) + secondText.slice(0, secondText.length - secondEol.length) + firstEol
    + source.slice(first.end, second.start) + firstText.slice(0, firstText.length - firstEol.length) + secondEol + source.slice(second.end);
}
export function insertMarkdownProfileField(source: string, key: string, value = ''): string {
  if (!/^[a-zA-Z][\w-]*$/.test(key)) throw new Error('信息项名称无效');
  const fields = analyzeMarkdownSource(source).profileFields;
  if (fields.some(field => field.key.toLowerCase() === key.toLowerCase())) return source;
  const offset = fields.at(-1)?.lineEnd ?? (source.startsWith('\uFEFF') ? 1 : 0), eol = markdownLineEnding(source);
  const prefix = offset > 0 && !/[\r\n\uFEFF]/.test(source[offset - 1]) ? eol : '';
  return replace(source, offset, offset, `${prefix}@[${key}](${escapedValue(value)})${eol}`);
}
export function appendMarkdownBlock(source: string, type: string, title: string, fields: string[] = []): string {
  if (!/^[\w-]+$/.test(type)) throw new Error('模块类型无效');
  const eol = markdownLineEnding(source), label = title.replace(/[\r\n]/g, ' '), gap = source ? (/[\r\n]$/.test(source) ? eol : eol + eol) : '';
  return source + gap + `:::${type}${label ? ` ${label}` : ''}${eol}` + fields.map(key => `@[${key}]()${eol}`).join('') + eol + `:::${eol}`;
}

/** Patch only file-level design fields, leaving the source's body, delimiter style and line endings intact. */
export function withMarkdownTemplate(source: string, templateId: string, presentation: 'markdown' | 'visual'): string {
  function set(valueSource: string, key: string, value: string, fallback: string): string {
    const fields = analyzeMarkdownSource(valueSource).profileFields;
    const field = fields.reverse().find(entry => entry.key.toLowerCase() === key.toLowerCase());
    if ((field?.value ?? fallback) === value) return valueSource;
    return field ? replace(valueSource, field.valueStart, field.valueEnd, escapedValue(value))
      : insertMarkdownProfileField(valueSource, key, value);
  }
  return set(set(source, 'template', templateId, 'neat'), 'presentationMode', presentation, 'markdown');
}
