import LineBreaker from 'linebreak';
import { Font } from '@react-pdf/renderer';
import type { RichNode } from '../model';

export const BODY_FONT = 'LocalResumeChinese';
export const CODE_FONT = 'LocalResumeCode';

export function usesCodeFont(node: RichNode, ordinary: boolean): boolean {
  return ordinary && !!node.marks?.some(mark => mark.type === 'code') && /^[\x20-\x7e]+$/.test(node.text ?? '');
}

export function bodyFontFace(node: RichNode, ordinary: boolean) {
  const marks = node.marks ?? [];
  return {
    fontFamily: usesCodeFont(node, ordinary) ? CODE_FONT : BODY_FONT,
    fontWeight: marks.some(mark => mark.type === 'bold' || mark.type === 'strong') ? 700 : 400,
    fontStyle: marks.some(mark => mark.type === 'italic' || mark.type === 'em') ? 'italic' as const : 'normal' as const,
  };
}

export function bodyFontSize(node: RichNode, fallback: number): number {
  const size = node.marks?.find(mark => mark.type === 'textStyle')?.attrs?.fontSize;
  const parsed = typeof size === 'string' && /^(\d+(?:\.\d+)?)(pt|px)?$/.exec(size);
  return parsed ? Math.min(40, Math.max(5, Number(parsed[1]) * (parsed[2] === 'px' ? .75 : 1))) : fallback;
}

/** Chromium fills each line up to the last Unicode break opportunity. Measure
 * advances with the embedded fonts and retain the original marked text spans.
 * Scripts requiring contextual shaping and long unbreakable runs use React PDF's
 * default line breaker. */
export function measureBodyLines(nodes: RichNode[] | undefined, width: number, baseSize: number, ordinary: boolean): RichNode[][] | undefined {
  if (!nodes?.length || !(width > 0) || !nodes.every(node => node.type === 'text')) return;
  const text = nodes.map(node => node.text ?? '').join('');
  if (!text || !/\p{Script=Han}/u.test(text) ||
      /[^\p{Script=Han}\p{Script=Latin}\p{Punctuation}\p{Number}\p{Space_Separator}\x20-\x7e]/u.test(text)) return;

  const advances = new Float64Array(text.length + 1);
  let offset = 0, total = 0;
  for (const node of nodes) {
    const font = Font.getFont(bodyFontFace(node, ordinary)).data;
    if (!font) return;
    const scale = bodyFontSize(node, baseSize) / font.unitsPerEm;
    const textRun = node.text ?? '';
    const runEnd = offset + textRun.length;
    const run = font.layout(textRun, undefined, undefined, undefined, 'ltr');
    for (let index = 0; index < run.glyphs.length; index++) {
      // Kerning and ligatures change the advance in mixed Latin / Han text.
      // Fontkit maps each shaped glyph back to its original code points.
      const codes = run.glyphs[index].codePoints;
      for (const code of codes) {
        total += run.positions[index].xAdvance * scale / codes.length;
        offset += code > 0xffff ? 2 : 1;
        advances[offset] = total;
      }
    }
    if (offset !== runEnd) return;
  }
  if (total <= width) return;
  const ends: number[] = [], breaker = new LineBreaker(text);
  let lineStart = 0, previous = 0, candidate;
  while ((candidate = breaker.nextBreak())) {
    const end = candidate.position;
    let paintedEnd = end;
    while (paintedEnd > previous && text[paintedEnd - 1] === ' ') paintedEnd--;
    if (advances[paintedEnd] - advances[previous] > width) return;
    if (advances[paintedEnd] - advances[lineStart] > width && previous > lineStart) {
      ends.push(previous);
      lineStart = previous;
    }
    previous = end;
  }
  if (!ends.length) return;
  ends.push(text.length);
  const lines: RichNode[][] = [[]];
  offset = 0;
  for (const node of nodes) {
    const end = offset + (node.text?.length ?? 0);
    while (offset < end) {
      const cut = ends[lines.length - 1];
      const next = Math.min(end, cut);
      const fragment = { ...node, text: text.slice(offset, next) };
      if (usesCodeFont(fragment, ordinary) !== usesCodeFont(node, ordinary)) return;
      lines[lines.length - 1].push(fragment);
      offset = next;
      if (offset === cut && cut < text.length) lines.push([]);
    }
  }
  return lines;
}
