import { SECTION_LABELS } from '../model';
import type { ResumeDocument, ResumeProfile } from '../model';
import { escapeValue, exportSectionLines, exportStructuredMarkdown, markdownSectionType } from './markdown';
import { analyzeMarkdownSource, markdownLineEnding, matchMarkdownLineEndings } from './markdownSource';

type TextKey = keyof Omit<ResumeProfile, 'photoId' | 'extraFields'>;
const profileKeys: Record<TextKey, string[]> = {
  name: ['name'], title: ['position','title'], phone: ['phone','mobile'], email: ['email'],
  city: ['city','address'], status: ['status'], website: ['website'], github: ['github'],
};
interface Edit { start: number; end: number; text: string }

function patchProfile(source: string, before: ResumeProfile, after: ResumeProfile): string {
  const changed = (Object.keys(profileKeys) as TextKey[]).filter(key => before[key] !== after[key]);
  const extrasChanged = before.extraFields !== after.extraFields && JSON.stringify(before.extraFields ?? []) !== JSON.stringify(after.extraFields ?? []);
  if (!changed.length && !extrasChanged) return source;
  const analysis = analyzeMarkdownSource(source);
  const headerEnd = analysis.blocks[0]?.start ?? source.length;
  const fields = analysis.profileFields.filter(field => field.start < headerEnd);
  const edits: Edit[] = [], additions: string[] = [];
  const fieldLine = (key: string, value: string) => `@[${key}](${escapeValue(value)})`;
  for (const key of changed) {
    const aliases = profileKeys[key];
    const field = fields.filter(field => aliases.includes(field.key.toLowerCase())).at(-1);
    if (field) {
      edits.push({ start: field.valueStart, end: field.valueEnd, text: escapeValue(after[key]) });
    } else if (key === 'name' && /^(?:\uFEFF)?# [^\r\n]*/.test(source)) {
      const heading = /^(?:\uFEFF)?# ([^\r\n]*)/.exec(source)!;
      if (after[key]) edits.push({ start: heading[0].length - heading[1].length, end: heading[0].length, text: after[key] });
      else edits.push({ start: source.startsWith('\uFEFF') ? 1 : 0, end: heading[0].length, text: fieldLine('name', '') });
    } else {
      additions.push(fieldLine(aliases[0], after[key]));
    }
  }
  if (extrasChanged) {
    for (const field of fields.filter(field => field.key.toLowerCase() === 'profileextra')) {
      edits.push({ start: field.start, end: field.end, text: '' });
    }
    additions.push(...(after.extraFields ?? []).map(field => fieldLine('profileExtra', JSON.stringify(field))));
  }
  const eol = markdownLineEnding(source);
  for (const edit of edits.sort((a,b) => b.start - a.start)) {
    source = source.slice(0,edit.start) + edit.text + source.slice(edit.end);
  }
  if (additions.length) {
    // After a # name heading, before section content, so a new field never turns the name into prose.
    const offset = source.match(/^\uFEFF?# [^\r\n]*(?:\r\n|\r|\n|$)/)?.[0].length ?? (source.startsWith('\uFEFF') ? 1 : 0);
    const leadingBreak = offset > 1 && !/[\r\n]/.test(source[offset-1]) ? eol : '';
    return source.slice(0,offset) + leadingBreak + additions.join(eol) + eol + source.slice(offset);
  }
  return source;
}

/** Keep original source regions for untouched sections, including custom syntax and whitespace. */
export function syncFormMarkdown(before: ResumeDocument, after: ResumeDocument): ResumeDocument {
  if (before.markdownSource === undefined || before === after) return after;
  let source = before.markdownSource;
  if (before.profile !== after.profile) source = patchProfile(source, before.profile, after.profile);
  if (before.sections === after.sections) return source === after.markdownSource ? after : { ...after, markdownSource: source };
  const eol = markdownLineEnding(source);
  const { blocks, outside } = analyzeMarkdownSource(source);
  const chunks = new Map<string, string>();
  const sections = new Map(before.sections.map(section => [section.id, section]));
  const start = blocks[0]?.start ?? source.length;
  const hasUnmappedProse = outside.some(region => region.textParts.some(part =>
    part.text.replace(/^\uFEFF?# [^\r\n]*/,'').trim()));
  // Free-form Markdown can contain implicit sections with no source boundary.
  // After a structural change serialize those documents with explicit section IDs.
  function serialize() {
    const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
    return { ...after, markdownSource: bom + matchMarkdownLineEndings(exportStructuredMarkdown(after), source) };
  }
  if (hasUnmappedProse || outside.some(region => region.start >= start && region.fields.length)) return serialize();
  for (const [i, block] of blocks.entries()) {
    const id = block.fields.find(field => field.key.toLowerCase() === 'sectionid')?.value;
    const rawType = block.type === 'heading' ? block.title : block.type;
    const type = markdownSectionType(rawType);
    const title = block.title || (type === 'custom' ? rawType : SECTION_LABELS[type]);
    const section = id ? sections.get(id) : before.sections.find(s => s.type === type && s.title === title);
    if (!section) return serialize();
    const end = blocks[i+1]?.start ?? source.length;
    chunks.set(section.id, (chunks.get(section.id) ?? '') + source.slice(block.start, end));
  }
  let result = source.slice(0,start);
  for (const section of after.sections) {
    if (result && !/[\r\n\uFEFF]$/.test(result)) result += eol;
    const original = chunks.get(section.id);
    result += original !== undefined && sections.get(section.id) === section
      ? original : exportSectionLines(section).join(eol);
  }
  return { ...after, markdownSource: result };
}
