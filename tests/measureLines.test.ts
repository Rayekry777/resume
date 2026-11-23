import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Font } from '@react-pdf/renderer';
import { type RichNode } from '../src/model';
import { createResume, newItem, newSection } from '../src/sample';
import { prepareResumeWrapping, registerResumeFonts } from '../src/pdf/ResumePdf';
import { BODY_FONT, measureBodyLines } from '../src/pdf/measureLines';

const link = { type: 'link', attrs: { href: 'https://example.com/' } };
const markedText: RichNode = { type: 'text', text: '天地玄黄宇宙洪荒。', marks: [link, { type: 'bold' }] };
const plainText: RichNode = { type: 'text', text: '日月盈昃' };

beforeAll(async () => {
  registerResumeFonts({ regular: resolve('public/fonts/Chinese-Regular.ttf'), bold: resolve('public/fonts/Chinese-Bold.ttf') });
  const document = createResume('neat', false);
  document.sections = [{ ...newSection('custom'), items: [newItem({ description: { type: 'doc', content: [
    { type: 'paragraph', content: [markedText, plainText] },
  ] } })] }];
  await prepareResumeWrapping(document);
});

describe('Unicode line breaks with the embedded PDF fonts', () => {
  it('uses Simplified Chinese punctuation metrics in both measurement and painting', () => {
    for (const fontWeight of [400, 700]) {
      const font = Font.getFont({ fontFamily: BODY_FONT, fontWeight }).data!;
      expect(font.layout('——').advanceWidth / font.unitsPerEm).toBe(2);
    }
  });

  it('fills the available width, preserves a link across lines and keeps closing punctuation with the previous glyph', () => {
    const lines = measureBodyLines([markedText, plainText], 30.2, 10, false);
    expect(lines?.map(line => line.map(node => node.text).join(''))).toEqual(['天地玄', '黄宇宙', '洪荒。', '日月盈', '昃']);
    expect(lines?.slice(0, 3).flat().every(node => node.marks === markedText.marks)).toBe(true);
    expect(lines?.slice(3).flat().every(node => node.marks === undefined)).toBe(true);
  });

  it('retains spaces and supplementary characters, and delegates unbreakable or bidirectional content to React PDF', () => {
    const source = '中文 PDF 中文 𠮷 中文';
    const lines = measureBodyLines([{ type: 'text', text: source }], 38, 10, true);
    expect(lines?.flat().map(node => node.text).join('')).toBe(source);
    expect(measureBodyLines([{ type: 'text', text: '中文 ' + 'W'.repeat(80) }], 30, 10, true)).toBeUndefined();
    expect(measureBodyLines([{ type: 'text', text: '中文 العربية' }], 30, 10, true)).toBeUndefined();
    expect(measureBodyLines([plainText, { type: 'hardBreak' }], 30, 10, true)).toBeUndefined();
  });
});
