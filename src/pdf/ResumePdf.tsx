import React from 'react';
import { safePdfLink, tint } from './pdfStyle';
import { getMarkdownDesign } from '../markdownTemplates';
import { CatalogTemplatePage } from './CatalogTemplatePage';
export { safePdfLink } from './pdfStyle';
import { Document, Font, Image, Link, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { getPresentationMode } from '../model';
import { BODY_FONT, CODE_FONT, bodyFontFace, bodyFontSize, measureBodyLines, usesCodeFont } from './measureLines';
import type { ResumeDocument, ResumeItem, ResumeSection, RichNode, TemplateDefinition } from '../model';
import { getTemplate, MD_REFERENCE as MD_EDITOR, NEAT_REFERENCE as NEAT_EDITOR } from '../templates';
import { getTemplateReference, type TemplateReference } from '../templateReferences';

// Chromium exports the 700 CSS-pixel Markdown canvas at 68.895 pt per
// 80px photo. The editable settings still use the original A4-normalized units.
const MD_PRINT_SCALE = (68.895 / 80) / MD_EDITOR.pointPerPixel;
const mdPrint = (points: number) => points * MD_PRINT_SCALE;
const MD_REFERENCE = {
  ...MD_EDITOR,
  ...Object.fromEntries(Object.entries(MD_EDITOR).filter(([key, value]) =>
    typeof value === 'number' && key !== 'listFontRatio' && key !== 'paperWidthPx'
  ).map(([key, value]) => [key, mdPrint(Number(value))])),
} as typeof MD_EDITOR;

const NEAT_PRINT_SCALE = (68.895 / 80) / NEAT_EDITOR.pointPerPixel;
const NEAT_REFERENCE = {
  ...NEAT_EDITOR,
  ...Object.fromEntries(Object.entries(NEAT_EDITOR)
    .filter(([key, value]) => typeof value === 'number' && key !== 'paperWidthPx')
    .map(([key, value]) => [key, Number(value) * NEAT_PRINT_SCALE])),
} as typeof NEAT_EDITOR;

export interface ResumePdfProps { document: ResumeDocument; photoDataUrl?: string }
export interface ResumeFontSources { regular: string; bold: string; italic?: string; boldItalic?: string; mono?: string }

let registeredFontSources = '';
const FAMILY = BODY_FONT;
const OPENING = /[（(【\[《〈「『“‘]$/u;
const CLOSING = /^[，。！？、；：,.!?;:）)】\]》〉」』”’%％]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Keep CJK closing punctuation with the preceding character, without adding Latin hyphens. */
export function cjkHyphenation(word: string): string[] {
  if (!CJK.test(word) && word.length < 28) return [word];
  const parts: string[] = [];
  let latin = '';
  let opening = '';
  const flush = () => {
    if (!latin) return;
    // Long URLs/identifiers must also fit narrow columns.
    const pieces = latin.match(/.{1,24}/gu) ?? [latin];
    parts.push(...pieces.map((piece, index) => (index === 0 ? opening : '') + piece));
    opening = '';
    latin = '';
  };
  for (const char of Array.from(word)) {
    if (OPENING.test(char)) { flush(); opening += char; }
    else if (CLOSING.test(char)) {
      flush();
      if (parts.length) { parts[parts.length - 1] += opening + char; opening = ''; }
      else opening += char;
    } else if (CJK.test(char)) { flush(); parts.push(opening + char); opening = ''; }
    else latin += char;
  }
  flush();
  if (opening) { if (parts.length) parts[parts.length - 1] += opening; else parts.push(opening); }
  return parts.length > 1 ? parts.flatMap(part => [part, '']) : [word];
}

/** This must run in the same thread as the PDF renderer; tests can supply absolute font paths. */
export function registerResumeFonts(sources: ResumeFontSources): void {
  const mono = sources.mono ?? sources.regular.replace(/[^/\\]+$/, 'Code-Mono.ttf');
  const signature = `${sources.regular}|${sources.bold}|${sources.italic ?? ''}|${sources.boldItalic ?? ''}|${mono}`;
  if (registeredFontSources === signature) return;
  Font.register({ family: FAMILY, fonts: [
    { src: sources.regular, fontWeight: 400 },
    { src: sources.bold, fontWeight: 700 },
    { src: sources.italic ?? sources.regular, fontWeight: 400, fontStyle: 'italic' },
    { src: sources.boldItalic ?? sources.bold, fontWeight: 700, fontStyle: 'italic' },
  ] });
  Font.register({ family:CODE_FONT, fonts:[
    { src:mono, fontStyle:'normal' }, { src:mono, fontStyle:'italic' },
  ] });
  Font.registerHyphenationCallback(cjkHyphenation);
  registeredFontSources = signature;
}

const styles = StyleSheet.create({
  page: { fontFamily: FAMILY, color: '#29313d', backgroundColor: '#ffffff', paddingBottom: 35 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  body: { flexGrow: 1, flexShrink: 1 },
  item: { marginBottom: 7 },
  contact: { fontSize: 8.6, lineHeight: 1.65 },
  metadata: { color: '#677180', marginTop: 2 },
  paragraph: { marginTop: 1, marginBottom: 2 },
  footer: { position: 'absolute', bottom: 15, left: 0, right: 0, textAlign: 'center', color: '#9299a4', fontSize: 7.5 },
});

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,20})$/i.test(value) ? value : fallback;
}
// Load the exact fonts used for measured Chinese / Latin lines before the
// component tree is evaluated in the worker. Font.load shares completed loads.
export async function prepareResumeWrapping(document: ResumeDocument): Promise<void> {
  if (document.templateId !== 'neat') return;
  const ordinary = getPresentationMode(document) === 'visual';
  const faces = new Map<string, Parameters<typeof Font.load>[0]>();
  function collect(node: RichNode) {
    if (node.type === 'text') {
      const face = bodyFontFace(node, ordinary);
      faces.set(face.fontFamily + face.fontStyle + face.fontWeight, face);
    }
    node.content?.forEach(collect);
  }
  for (const section of document.sections) if (section.visible) {
    for (const item of section.items) collect(item.description);
  }
  await Promise.all([...faces.values()].map(face => Font.load(face)));
}

function inlineNodes(nodes: RichNode[] | undefined, key = 'inline', baseFontSize = 10, lineHeight = 1.65, ordinaryCode = false): React.ReactNode[] {
  return (nodes ?? []).map((node, index) => {
    const id = `${key}-${index}`;
    if (node.type === 'hardBreak') return <Text key={id}>{'\n'}</Text>;
    if (node.type !== 'text') return <Text key={id}>{inlineNodes(node.content, id, baseFontSize, lineHeight, ordinaryCode)}</Text>;
    const marks = node.marks ?? [];
    const fontSize = bodyFontSize(node, baseFontSize);
    const textStyle: { fontSize: number; lineHeight: string; fontWeight?: number; fontFamily?: string; fontStyle?: 'italic'; textDecoration?: 'underline' | 'line-through'; color?: string; backgroundColor?: string } = { fontSize, lineHeight: `${fontSize * lineHeight}pt` };
    if (marks.some(mark => mark.type === 'bold' || mark.type === 'strong')) textStyle.fontWeight = 700;
    if (marks.some(mark => mark.type === 'italic' || mark.type === 'em')) textStyle.fontStyle = 'italic';
    if (marks.some(mark => mark.type === 'underline')) textStyle.textDecoration = 'underline';
    if (marks.some(mark => mark.type === 'strike')) textStyle.textDecoration = 'line-through';
    if (usesCodeFont(node, ordinaryCode)) {
      textStyle.fontFamily = CODE_FONT;
      textStyle.lineHeight = `${fontSize * lineHeight + 3 * NEAT_REFERENCE.pointPerPixel}pt`;
    }
    const textColor = marks.find(mark => mark.type === 'textStyle')?.attrs?.color;
    if (textColor) textStyle.color = color(textColor, '#29313d');
    const highlight = marks.find(mark => mark.type === 'highlight');
    if (highlight) textStyle.backgroundColor = color(highlight.attrs?.color, '#fff3b8');
    const href = safePdfLink(String(marks.find(mark => mark.type === 'link')?.attrs?.href ?? ''));
    return href
      ? <Link key={id} src={href} style={{ ...textStyle, color: textStyle.color ?? '#3657bb', textDecoration: 'underline' }}>{node.text ?? ''}</Link>
      : <Text key={id} style={textStyle}>{node.text ?? ''}</Text>;
  });
}

/** Chromium paints a filled disc for an unordered marker outside the text column. */
function ListDisc({ fontSize, rowHeight }: { fontSize: number; rowHeight: number }) {
  const diameter = fontSize * 5 / 12;
  return <View style={{ position: 'absolute', left: -fontSize * 4 / 3,
    top: rowHeight / 2 - fontSize / 4, width: diameter, height: diameter,
    borderRadius: diameter / 2, backgroundColor: '#000000', opacity: .85 }} />;
}

function RichContent({ nodes, wrapWidth, fontSize, depth = 0, lineHeight = 1.65, neat = false, markdown = false, inMarkdownList = false }: { nodes?: RichNode[]; wrapWidth?: number; fontSize: number; depth?: number; lineHeight?: number; neat?: boolean; markdown?: boolean; inMarkdownList?: boolean }): React.ReactElement {
  return <View>{(nodes ?? []).map((node, index) => {
    const key = `${depth}-${index}`;
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const start = Number(node.attrs?.start ?? 1);
      if (markdown) {
        const listFontSize = inMarkdownList ? fontSize : fontSize * MD_REFERENCE.listFontRatio;
        const listLineHeight = inMarkdownList ? lineHeight : lineHeight / MD_REFERENCE.listFontRatio;
        return <View key={key} style={{ paddingLeft: MD_REFERENCE.listPaddingLeft, marginBottom: index === (nodes?.length ?? 0) - 1 ? 0 : MD_REFERENCE.listMarginBottom }}>{(node.content ?? []).map((item, itemIndex) =>
          <View key={`${key}-${itemIndex}`} style={{ position: 'relative', marginTop: itemIndex ? MD_REFERENCE.listItemMargin : 0 }}>
            {node.type === 'bulletList' ? <ListDisc fontSize={listFontSize} rowHeight={listFontSize * listLineHeight} /> : <Text style={{ position: 'absolute', left: -MD_REFERENCE.listPaddingLeft, width: MD_REFERENCE.listPaddingLeft - 4 * MD_REFERENCE.pointPerPixel, textAlign: 'right', fontSize: listFontSize, lineHeight: `${listFontSize * listLineHeight}pt` }}>{start + itemIndex}.</Text>}
            <RichContent wrapWidth={wrapWidth && wrapWidth - MD_REFERENCE.listPaddingLeft} nodes={item.content} fontSize={listFontSize} depth={depth + 1} lineHeight={listLineHeight} markdown inMarkdownList />
          </View>)}</View>;
      }
      if (neat) return <View key={key} style={{ paddingLeft: 13 * NEAT_REFERENCE.pointPerPixel }}>{(node.content ?? []).map((item, itemIndex) =>
        <View key={`${key}-${itemIndex}`} style={{ position: 'relative', marginLeft: 7 * NEAT_REFERENCE.pointPerPixel }}>
          {node.type === 'bulletList' ? <ListDisc fontSize={fontSize} rowHeight={fontSize * lineHeight} /> : <Text style={{ position: 'absolute', left: -20 * NEAT_REFERENCE.pointPerPixel, width: 15 * NEAT_REFERENCE.pointPerPixel, textAlign: 'right', fontSize, lineHeight: `${fontSize * lineHeight}pt` }}>{start + itemIndex}.</Text>}
          <RichContent wrapWidth={wrapWidth && wrapWidth - 20 * NEAT_REFERENCE.pointPerPixel} nodes={item.content} fontSize={fontSize} depth={depth + 1} lineHeight={lineHeight} neat />
        </View>)}</View>;
      return <View key={key} style={{ marginLeft: depth ? 8 : 0, marginBottom: 2 }}>{(node.content ?? []).map((item, itemIndex) =>
        <View key={`${key}-${itemIndex}`} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <Text style={{ width: node.type === 'orderedList' ? 19 : 12, flexShrink: 0, paddingTop: 1 }}>{node.type === 'orderedList' ? `${start + itemIndex}.` : '•'}</Text>
          <View style={{ flex: 1 }}><RichContent nodes={item.content} fontSize={fontSize} depth={depth + 1} lineHeight={lineHeight} /></View>
        </View>)}</View>;
    }
    if (node.type === 'blockquote') return <View key={key} style={{ borderLeftWidth: 2, borderLeftColor: '#cdd4de', paddingLeft: 8, marginVertical: 3 }}><RichContent wrapWidth={wrapWidth && wrapWidth - 10} nodes={node.content} fontSize={fontSize} depth={depth} lineHeight={lineHeight} neat={neat} markdown={markdown} inMarkdownList={inMarkdownList} /></View>;
    if (node.type === 'horizontalRule') return <View key={key} style={{ borderBottomWidth: .5, borderBottomColor: '#cdd4de', marginVertical: 5 }} />;
    if (node.type === 'doc' || node.type === 'listItem') return <RichContent key={key} nodes={node.content} fontSize={fontSize} depth={depth} lineHeight={lineHeight} neat={neat} markdown={markdown} inMarkdownList={inMarkdownList} />;
    const align = String(node.attrs?.textAlign ?? 'left');
    const textAlign = (['left', 'center', 'right', 'justify'].includes(align) ? align : 'left') as 'left' | 'center' | 'right' | 'justify';
    const paragraphFontSize = node.type === 'heading' ? fontSize + (node.attrs?.level === 2 ? 3 : 1) : node.type === 'codeBlock' ? fontSize - .5 : fontSize;
    const marginLeft = clamp(Number(node.attrs?.indent ?? 0), 0, 5, 0) * 15;
    const lines = wrapWidth && node.type === 'paragraph' && textAlign === 'left'
      ? measureBodyLines(node.content, wrapWidth - marginLeft, paragraphFontSize, neat) : undefined;
    if (lines) {
      // A slight allowance prevents a second layout pass from breaking off
      // trailing space or a final glyph due to shaping / rounding differences.
      // The printable break itself was measured against the original width.
      return <View key={key} style={{ marginLeft }}>{lines.map((line, lineIndex) =>
        <Text key={lineIndex} style={{ width: '101%', fontSize: paragraphFontSize, lineHeight: `${paragraphFontSize * lineHeight}pt` }}>
          {inlineNodes(line, key, paragraphFontSize, lineHeight, neat)}
        </Text>)}</View>;
    }
    const children = node.type === 'text' ? inlineNodes([node], key, paragraphFontSize, lineHeight, neat) : inlineNodes(node.content, key, paragraphFontSize, lineHeight, neat);
    return <Text key={key} orphans={neat || markdown ? 1 : 2} widows={neat || markdown ? 1 : 2} style={{ ...(neat || markdown ? { marginTop: 0, marginBottom: 0 } : styles.paragraph), textAlign, marginLeft, fontSize: paragraphFontSize, lineHeight: `${paragraphFontSize * lineHeight}pt`, ...(node.type === 'heading' ? { fontWeight: 700 } : {}), ...(node.type === 'codeBlock' ? { backgroundColor: '#f5f7fa', padding: 5 } : {}) }}>{children.length ? children : '\u00a0'}</Text>;
  })}</View>;
}

function SectionHeading({ section, template, accent, fontSize, gap, topGap, bodyLineHeight, markdown = false }: { section: ResumeSection; template: TemplateDefinition; accent: string; fontSize: number; gap: number; topGap?: number; bodyLineHeight: number; markdown?: boolean }): React.ReactElement {
  const title = section.title || '未命名模块';
  const common = { wrap: false, minPresenceAhead: fontSize * 3.6 + gap };
  if (markdown) return <View {...common} style={{ position: 'relative', height: MD_REFERENCE.headingHeight, marginTop: topGap ?? 0, marginBottom: gap, borderBottomWidth: MD_REFERENCE.headingBorderWidth, borderBottomColor: MD_REFERENCE.headingBorderColor }}>
    <View style={{ position: 'absolute', top: MD_REFERENCE.headingStripeTop, left: 0, width: MD_REFERENCE.headingStripeWidth, height: MD_REFERENCE.headingStripeHeight, backgroundColor: accent }} />
    <Text style={{ position: 'absolute', top: MD_REFERENCE.headingPaddingVertical - 3.8, left: MD_REFERENCE.headingPaddingLeft, right: 0, fontSize: MD_REFERENCE.headingFontSize, fontWeight: 700, color: MD_REFERENCE.bodyColor, lineHeight: `${MD_REFERENCE.headingLineHeight}pt` }}>{title}</Text>
  </View>;
  if (template.id === 'neat') return <View {...common} style={{ position: 'relative', height: bodyLineHeight + 2 * NEAT_REFERENCE.headingPaddingVertical, marginTop: topGap ?? NEAT_REFERENCE.headingMarginTop, marginBottom: gap, backgroundColor: tint(accent, .9) }}>
    <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: NEAT_REFERENCE.headingStripeWidth, backgroundColor: accent }} />
    <Text style={{ position:'absolute', top:NEAT_REFERENCE.headingPaddingVertical - 2, left:NEAT_REFERENCE.headingPaddingHorizontal, right:0,
      fontSize: NEAT_REFERENCE.headingFontSize, fontWeight: 700, color: accent, lineHeight: `${bodyLineHeight}pt` }}>{title}</Text>
  </View>;
  return <ReferenceHeading title={title} reference={getTemplateReference(template.id)} accent={accent} gap={gap} topGap={topGap} />;
}

function ReferenceHeading({ title, reference, accent, gap, topGap }: { title: string; reference: TemplateReference; accent: string; gap: number; topGap?: number }): React.ReactElement {
  const h = reference.heading;
  const titleWidth = Math.max(h.tabWidth, h.stripeWidth, title.length * h.fontSize + h.textLeft * 2);
  const foreground = h.kind === 'tab' || h.kind === 'capsule' ? '#ffffff' : h.kind === 'icon' || h.kind === 'plain' ? h.color : accent;
  const iconPath = 'M3 5h18v14H3V5Zm3 4h12M6 12h8M6 15h10';
  return <View wrap={false} minPresenceAhead={h.height + gap + h.lineHeight} style={{ position: 'relative', height: h.height, marginTop: topGap ?? reference.section.headingMarginTop, marginBottom: gap }}>
    {h.borderWidth > 0 && <View style={{ position: 'absolute', bottom: 0, left: h.kind === 'icon-underline' ? h.textLeft : 0, right: 0, borderBottomWidth: h.borderWidth, borderBottomColor: accent }} />}
    {h.kind === 'stripe' && <View style={{ position: 'absolute', top: 0, left: h.stripeLeft, width: h.stripeWidth, height: h.stripeHeight, backgroundColor: accent }} />}
    {h.kind === 'tab' && <View style={{ position: 'absolute', top: 0, left: h.stripeLeft, width: titleWidth, height: h.stripeHeight, backgroundColor: accent }} />}
    {h.kind === 'capsule' && <View style={{ position: 'absolute', top: 0, left: 0, width: titleWidth, height: h.lineHeight, backgroundColor: accent, borderTopRightRadius: h.radius, borderBottomRightRadius: h.radius }} />}
    {h.kind === 'capsule' && <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderBottomWidth: reference.pointPerPixel, borderBottomColor: tint(accent, .6), borderBottomStyle: 'dotted' }} />}
    {h.kind === 'icon' && <View style={{ position: 'absolute', left: 0, top: 0, width: 24 * reference.pointPerPixel, height: 24 * reference.pointPerPixel, borderRadius: 12 * reference.pointPerPixel, backgroundColor: tint(accent, .9), padding: 5 * reference.pointPerPixel }}>
      <Svg width={14 * reference.pointPerPixel} height={14 * reference.pointPerPixel} viewBox="0 0 24 24"><Path d={iconPath} fill="none" stroke={accent} strokeWidth={1.7} /></Svg>
    </View>}
    {(h.kind === 'plain' || h.kind === 'icon-underline') && <Svg width={28 * reference.pointPerPixel} height={28 * reference.pointPerPixel} viewBox="0 0 24 24" style={{ position: 'absolute', top: 0, left: h.kind === 'plain' ? -17 * reference.pointPerPixel : 0 }}><Path d={iconPath} fill="none" stroke={h.kind === 'plain' ? '#000000' : accent} strokeWidth={1.7} /></Svg>}
    <Text style={{ position: 'absolute', top: h.textTop, left: h.textLeft, right: 0, fontSize: h.fontSize, lineHeight: `${h.lineHeight}pt`, fontWeight: 700, color: foreground }}>{title}</Text>
  </View>;
}

type NeatContactIcon = 'phone' | 'email' | 'github' | 'website' | 'status' | 'position' | 'city';
const neatContactPaths: Record<NeatContactIcon, string> = {
  phone: 'M6 3H3v4c0 7.7 6.3 14 14 14h4v-3l-5-2-2 2a15 15 0 0 1-8-8l2-2-2-5Z',
  email: 'M3 5h18v14H3V5Zm0 1 9 7 9-7',
  github: 'M12 2a10 10 0 0 0-3.2 19.5v-2.3c-2.6.6-3.2-1.1-3.2-1.1-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.9.1-.7.4-1.1.6-1.4-2.1-.2-4.3-1-4.3-4.5 0-1 .4-1.8 1-2.4-.1-.2-.4-1.2.1-2.4 0 0 .8-.3 2.7 1a9.2 9.2 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .5 1.2.2 2.2.1 2.4.7.6 1 1.4 1 2.4 0 3.5-2.2 4.3-4.3 4.5.4.3.7.9.7 1.7v3.2A10 10 0 0 0 12 2Z',
  website: 'M2 12h20M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 0c-5 5-5 15 0 20 5-5 5-15 0-20Z',
  status: 'M8 7V4h8v3M3 7h18v13H3V7Zm0 5c6 3 12 3 18 0M10 12h4v4h-4v-4Z',
  position: 'M8 7V4h8v3M3 7h18v13H3V7Zm0 5c6 3 12 3 18 0M10 12h4v4h-4v-4Z',
  city: 'M12 22S4 14 4 9a8 8 0 1 1 16 0c0 5-8 13-8 13Zm0-17a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
};

function NeatContact({ value, icon, accent, link = false, markdown = false, noIcon = false, fontSize, lineHeight }: { value: string; icon: NeatContactIcon; accent: string; link?: boolean; markdown?: boolean; noIcon?: boolean; fontSize?: number; lineHeight?: number }): React.ReactElement | null {
  if (!value) return null;
  const href = link ? safePdfLink(value) : undefined;
  const reference = markdown ? MD_REFERENCE : NEAT_REFERENCE;
  const rowHeight = lineHeight ?? reference.contactLineHeight;
  return <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: markdown ? 0 : NEAT_REFERENCE.contactItemGap, minHeight: rowHeight, maxWidth: '100%' }}>
    {!noIcon && <Svg width={reference.contactIconSize} height={reference.contactIconSize} viewBox="0 0 24 24" style={{ marginRight: reference.contactIconGap, flexShrink: 0 }}>
      <Path d={neatContactPaths[icon]} fill={icon === 'phone' || icon === 'github' ? accent : 'none'} stroke={accent} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>}
    <Text style={{ fontSize: fontSize ?? reference.contactFontSize, lineHeight: `${rowHeight}pt`, flexShrink: 1, ...(markdown ? {} : { position:'relative', top: 2 }) }}>{href ? <Link src={href} style={{ color: markdown ? reference.bodyColor : '#446ef6', textDecoration: 'none' }}>{value}</Link> : value}</Text>
  </View>;
}

function MarkdownProfileHeader({ document, photoDataUrl }: ResumePdfProps): React.ReactElement {
  const { profile, layout } = document;
  const showPhoto = layout.showPhoto && Boolean(photoDataUrl);
  return <View wrap={false} style={{ position: 'relative', minHeight: showPhoto ? MD_REFERENCE.photoHeight : undefined, paddingRight: showPhoto ? MD_REFERENCE.profilePhotoReservedWidth : 0, marginBottom: MD_REFERENCE.profileMarginBottom }}>
    <Text style={{ position: 'relative', top: -1.9, fontSize: MD_REFERENCE.nameFontSize, lineHeight: `${MD_REFERENCE.nameLineHeight}pt`, fontWeight: 700, marginBottom: MD_REFERENCE.nameMarginBottom, textAlign: layout.headerAlign }}>{profile.name || '你的姓名'}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: MD_REFERENCE.contactRowGap, columnGap: MD_REFERENCE.contactColumnGap }}>
      <NeatContact accent={layout.accent} icon="phone" value={profile.phone} markdown />
      <NeatContact accent={layout.accent} icon="email" value={profile.email} markdown />
      <NeatContact accent={layout.accent} icon="status" value={profile.status} markdown />
      <NeatContact accent={layout.accent} icon="position" value={profile.title} markdown />
      <NeatContact accent={layout.accent} icon="github" value={profile.github} link markdown />
      <NeatContact accent={layout.accent} icon="website" value={profile.website} link markdown />
      <NeatContact accent={layout.accent} icon="city" value={profile.city} markdown />
      {profile.extraFields?.map(field => <NeatContact accent={layout.accent} key={field.key} icon="status" value={field.value} markdown noIcon />)}
    </View>
    {showPhoto && <Image src={photoDataUrl!} style={{ position: 'absolute', right: 0, top: 0, width: MD_REFERENCE.photoWidth, height: MD_REFERENCE.photoHeight, borderRadius: layout.photoShape === 'round' ? MD_REFERENCE.photoWidth / 2 : 0, objectFit: 'cover' }} />}
  </View>;
}

function NeatProfileHeader({ document, photoDataUrl }: ResumePdfProps): React.ReactElement {
  const { profile, layout } = document;
  const showPhoto = layout.showPhoto && Boolean(photoDataUrl);
  const typography = { accent: layout.accent, fontSize: layout.fontSize, lineHeight: layout.fontSize * layout.lineHeight };
  return <View wrap={false} style={{ paddingBottom: NEAT_REFERENCE.profilePaddingBottom }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', minHeight: showPhoto ? NEAT_REFERENCE.photoAreaHeight : undefined }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: NEAT_REFERENCE.nameFontSize, fontWeight: 700, lineHeight: `${NEAT_REFERENCE.nameLineHeight}pt`, marginBottom: NEAT_REFERENCE.nameMarginBottom, textAlign: layout.headerAlign, position:'relative', top:-4 }}>{profile.name || '你的姓名'}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <NeatContact {...typography} icon="phone" value={profile.phone} />
          <NeatContact {...typography} icon="email" value={profile.email} />
          <NeatContact {...typography} icon="github" value={profile.github} link />
          <NeatContact {...typography} icon="website" value={profile.website} link />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <NeatContact {...typography} icon="status" value={profile.status} />
          <NeatContact {...typography} icon="position" value={profile.title} />
          <NeatContact {...typography} icon="city" value={profile.city} />
        </View>
        {profile.extraFields?.some(field => field.value) && <View style={{ flexDirection:'row', flexWrap:'wrap' }}>
          {profile.extraFields.map(field => <NeatContact {...typography} key={field.key} icon="status" value={field.value} />)}
        </View>}
      </View>
      {showPhoto && <View style={{ width: NEAT_REFERENCE.photoWidth, height: NEAT_REFERENCE.photoAreaHeight, flexShrink: 0 }}>
        <Image src={photoDataUrl!} style={{ width: NEAT_REFERENCE.photoWidth, height: NEAT_REFERENCE.photoHeight, borderRadius: layout.photoShape === 'round' ? NEAT_REFERENCE.photoWidth / 2 : 0, objectFit: 'cover' }} />
      </View>}
    </View>
  </View>;
}

function ProfileHeader({ document, template, accent, photoDataUrl }: ResumePdfProps & { template: TemplateDefinition; accent: string }): React.ReactElement {
  if (template.id === 'neat' && getPresentationMode(document) === 'markdown') return <MarkdownProfileHeader document={document} photoDataUrl={photoDataUrl} />;
  if (template.id === 'neat') return <NeatProfileHeader document={document} photoDataUrl={photoDataUrl} />;
  return <ReferenceProfileHeader document={document} photoDataUrl={photoDataUrl} accent={accent} reference={getTemplateReference(template.id)} />;
}

function ReferenceContact({ value, icon, reference, fontSize, lineHeight, ink, noIcon = false }: { value: string; icon: NeatContactIcon; reference: TemplateReference; fontSize: number; lineHeight: number; ink: string; noIcon?: boolean }): React.ReactElement | null {
  if (!value) return null;
  const href = icon === 'website' || icon === 'github' ? safePdfLink(value) : undefined;
  const k = reference.pointPerPixel;
  return <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: lineHeight, marginRight: 8 * k, maxWidth: '100%' }}>
    {!noIcon && <Svg width={12 * k} height={12 * k} viewBox="0 0 24 24" style={{ marginRight: 4 * k, flexShrink: 0 }}><Path d={neatContactPaths[icon]} fill="none" stroke={ink} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></Svg>}
    <Text style={{ fontSize, lineHeight: `${lineHeight}pt`, color: ink, flexShrink: 1 }}>{href ? <Link src={href} style={{ color: ink, textDecoration: 'none' }}>{value}</Link> : value}</Text>
  </View>;
}

function ReferenceProfileHeader({ document, photoDataUrl, reference, accent }: ResumePdfProps & { reference: TemplateReference; accent: string }): React.ReactElement {
  const { profile, layout } = document;
  const p = reference.profile, k = reference.pointPerPixel;
  const showPhoto = layout.showPhoto && Boolean(photoDataUrl);
  const fontSize = clamp(layout.fontSize, 5, 40, p.contactFontSize);
  const lineHeight = fontSize * clamp(layout.lineHeight, .5, 4, 27 / 14);
  const name = <Text style={{ fontSize: p.nameFontSize, lineHeight: `${p.nameLineHeight}pt`, fontWeight: 700, color: p.kind === 'steady' ? accent : p.nameColor, textAlign: layout.headerAlign, marginBottom: p.nameMarginBottom }}>{profile.name || '你的姓名'}</Text>;
  const contact = (value: string, icon: NeatContactIcon, ink = p.color, noIcon = false) => <ReferenceContact key={icon} value={value} icon={icon} reference={reference} fontSize={fontSize} lineHeight={lineHeight} ink={ink} noIcon={noIcon} />;
  const extraContacts = (ink = p.color) => profile.extraFields?.map(field => <ReferenceContact key={`extra:${field.key}`} value={field.value} icon="status" reference={reference} fontSize={fontSize} lineHeight={lineHeight} ink={ink} noIcon />);
  const details = <>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{contact(profile.phone, 'phone')}{contact(profile.email, 'email')}{contact(profile.github, 'github')}{contact(profile.website, 'website')}</View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{contact(profile.title, 'position')}{contact(profile.city, 'city')}{contact(profile.status, 'status')}{extraContacts()}</View>
  </>;
  const photo = showPhoto ? <Image src={photoDataUrl!} style={{ width: p.photoWidth, height: p.photoHeight, borderRadius: layout.photoShape === 'round' ? p.photoWidth / 2 : p.photoRadius, objectFit: 'cover', flexShrink: 0 }} /> : null;

  if (p.kind === 'sidebar') return <View wrap={false} style={{ paddingTop: reference.columns!.topPadding }}>
    {photo && <View style={{ alignItems: layout.headerAlign === 'center' ? 'center' : 'flex-start' }}>{photo}</View>}
    <View style={{ marginTop: 8 * k }}>{name}</View>
    <View>{contact(profile.phone, 'phone')}{contact(profile.email, 'email')}{contact(profile.title, 'position')}{contact(profile.city, 'city')}{contact(profile.status, 'status')}{contact(profile.github, 'github')}{contact(profile.website, 'website')}{extraContacts()}</View>
  </View>;

  if (p.kind === 'elegant') return <View wrap={false} style={{ paddingBottom: p.paddingBottom }}>
    <View style={{ position: 'relative', minHeight: 177 * k, backgroundColor: tint(accent, .91), borderRadius: 12 * k, overflow: 'hidden', paddingTop: 22 * k, paddingBottom: 22 * k, paddingLeft: 32 * k, paddingRight: showPhoto ? 126 * k : 24 * k }}>
      <View style={{ position: 'absolute', width: 109 * k, height: 109 * k, borderRadius: 55 * k, backgroundColor: '#ffffff', opacity: .55, right: -42 * k, top: -42 * k }} />
      {name}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 * k }}>{contact(profile.title, 'position', accent, true)}{contact(profile.city, 'city', accent, true)}{contact(profile.status, 'status', accent, true)}{extraContacts(accent)}</View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{contact(profile.phone, 'phone', p.color, true)}{contact(profile.email, 'email', p.color, true)}{contact(profile.github, 'github', p.color, true)}{contact(profile.website, 'website', p.color, true)}</View>
      {photo && <View style={{ position: 'absolute', right: 24 * k, top: p.photoTop - 3 * k, padding: 3 * k, borderTopLeftRadius: 14 * k, borderBottomRightRadius: 14 * k, backgroundColor: '#ffffff' }}>{photo}</View>}
    </View>
  </View>;

  if (p.kind === 'steady') return <View wrap={false} style={{ position: 'relative', minHeight: p.height, paddingBottom: p.paddingBottom }}>
    <View style={{ position: 'absolute', top: 0, left: 297 * k, right: -(layout.marginRight ?? layout.marginHorizontal), height: 95 * k, backgroundColor: accent, borderTopLeftRadius: 48 * k, borderBottomLeftRadius: 48 * k }} />
    {photo && <View style={{ position: 'absolute', top: 0, left: 0 }}>{photo}</View>}
    <View style={{ position: 'absolute', left: showPhoto ? 109 * k : 0, top: p.nameTop, width: showPhoto ? 188 * k : 297 * k }}>{name}{profile.title && <Text style={{ fontSize, lineHeight: `${16 * k}pt`, color: accent }}>{profile.title}</Text>}</View>
    <View style={{ marginLeft: 314 * k, marginRight: 12 * k, paddingTop: 16 * k }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 * k }}>{contact(profile.phone, 'phone')}{contact(profile.status, 'status')}</View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{contact(profile.email, 'email')}{contact(profile.city, 'city')}{contact(profile.github, 'github')}{contact(profile.website, 'website')}{extraContacts()}</View>
    </View>
  </View>;

  const leftPhoto = p.kind === 'photo-left';
  const banner = p.kind === 'banner';
  const left = layout.marginLeft ?? layout.marginHorizontal, right = layout.marginRight ?? layout.marginHorizontal;
  return <View wrap={false} style={{ position: 'relative', paddingBottom: banner ? 38 * k : p.paddingBottom }}>
    {banner && <View style={{ position: 'absolute', top: -layout.marginTop, left: -left, right: -right, bottom: 0, backgroundColor: accent }} />}
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', minHeight: showPhoto ? p.photoHeight : undefined }}>
      {leftPhoto && photo && <View style={{ marginRight: 26 * k }}>{photo}</View>}
      <View style={{ flex: 1, minWidth: 0, ...(leftPhoto ? { marginLeft: 8 * k, marginRight: 18 * k } : {}) }}>{name}{details}</View>
      {!leftPhoto && photo}
    </View>
  </View>;
}

/** Keep a short entry together, while allowing substantial prose to paginate.
 * A measured, conservative text budget avoids a heading/one-line fragment at
 * the page foot without making a long rich-text entry an unbreakable box.
 */
function shortReferenceEntry(item: ResumeItem, width: number, fontSize: number, lineHeight: number): boolean {
  const headerRows = Number(Boolean(item.title || item.startDate || item.endDate)) + Number(Boolean(item.subtitle || item.location)) + Number(Boolean(item.url));
  let height = headerRows * Math.max(fontSize, 14) * lineHeight;
  const walk = (node: RichNode): void => {
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock' || node.type === 'text') {
      let textWidth = 0, largestFont = fontSize, explicitLines = 0;
      const inline = (child: RichNode): void => {
        const runFont = bodyFontSize(child, fontSize);
        largestFont = Math.max(largestFont, runFont);
        textWidth += Array.from(child.text ?? '').reduce((sum, char) => sum + (CJK.test(char) ? 1 : .6) * runFont, 0);
        if (child.type === 'hardBreak') explicitLines++;
        (child.content ?? []).forEach(inline);
      };
      inline(node);
      const indent = clamp(Number(node.attrs?.indent ?? 0), 0, 5, 0) * 15;
      const rows = Math.max(1, Math.ceil(textWidth / Math.max(40, width - indent - 24))) + explicitLines;
      height += rows * largestFont * lineHeight;
    } else (node.content ?? []).forEach(walk);
  };
  walk(item.description);
  return height < 240;
}

function NeatEntryBody({ description, wrapWidth, fontSize, lineHeight }: { description: RichNode; wrapWidth?: number; fontSize: number; lineHeight: number }): React.ReactElement {
  // Noto Sans CJK has hhea ascent 1160 and typographic ascent 880 per 1000 em.
  // On a continuous print surface the empty ascender space can fall above a
  // page boundary. Only reclaim space that is clear of every actual glyph.
  let trim = .28 * fontSize;
  function checkInk(node: RichNode) {
    if (!trim) return;
    if (node.type === 'text') {
      const run = node.text ?? '';
      const font = Font.getFont(bodyFontFace(node, true)).data;
      const simpleScript = /^[\p{Script=Han}\p{Script=Latin}\p{Punctuation}\p{Number}\p{Math_Symbol}\p{Space_Separator}\x20-\x7e]*$/u.test(run);
      if (!font || !simpleScript || node.marks?.some(mark => mark.type === 'highlight')) {
        trim = 0;
        return;
      }
      const scale = bodyFontSize(node, fontSize) / font.unitsPerEm;
      for (const character of new Set(run)) {
        const inkTop = font.glyphForCodePoint(character.codePointAt(0)!).bbox.maxY;
        trim = Math.min(trim, Math.max(0, (font.ascent - inkTop) * scale));
      }
    } else if (['doc', 'paragraph', 'orderedList', 'bulletList', 'listItem', 'hardBreak'].includes(node.type)) {
      node.content?.forEach(checkInk);
    } else trim = 0;
  }
  checkInk(description);
  const inset = 3 * NEAT_REFERENCE.pointPerPixel + trim;
  return <View style={{ paddingTop: inset, marginBottom: -inset }}>
    <View style={{ position: 'relative', top: -trim }}>
      <RichContent wrapWidth={wrapWidth} nodes={description.type === 'doc' ? description.content : [description]} fontSize={fontSize} lineHeight={lineHeight} neat />
    </View>
  </View>;
}

function Entry({ item, document, compact, sectionType, wrapWidth }: { wrapWidth?: number; item: ResumeItem; document: ResumeDocument; compact: boolean; sectionType: ResumeSection['type'] }): React.ReactElement {
  const fontSize = clamp(document.layout.fontSize, 5, 40, 10) * (document.templateId === 'neat' && getPresentationMode(document) === 'markdown' ? MD_PRINT_SCALE : 1);
  const neat = document.templateId === 'neat';
  const lineHeight = clamp(document.layout.lineHeight, .5, 4, 1.65);
  const neatItemPadding = 8 * NEAT_REFERENCE.pointPerPixel;
  const dates = [item.startDate, item.endDate].filter(Boolean).join(item.dateSeparator ?? ' — ');
  const hasHeading = Boolean(item.title || dates);
  const metadata = [item.subtitle, item.location].filter(Boolean).join(' · ');
  const link = safePdfLink(item.url);
  if (neat && getPresentationMode(document) === 'markdown') {
    const chips = [item.title, ...item.subtitle.split(' · '), item.location, dates, item.url].filter(Boolean);
    // The data model uses one empty paragraph for an empty editor. The source
    // only prints the chips for such a block. Rendering a NBSP adds a phantom row.
    const body = item.description.type === 'doc' ? item.description.content ?? [] : [item.description];
    const hasBody = body.some(node => node.type !== 'paragraph' || node.content?.length);
    return <View style={{ marginBottom: MD_REFERENCE.blockMarginBottom }}>
      {chips.length > 0 && <View wrap={false} minPresenceAhead={fontSize * 2.7} style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: MD_REFERENCE.chipsRowGap, marginBottom: hasBody ? MD_REFERENCE.chipsMarginBottom : 0 }}>{chips.map((chip, index) =>
        <View key={`${index}-${chip}`} style={{ flexDirection: 'row', alignItems: 'center', maxWidth: '100%' }}>
          {index > 0 && <Text style={{ fontSize, lineHeight: `${fontSize * lineHeight}pt`, marginHorizontal: MD_REFERENCE.chipSeparatorMargin, color: '#8c8c8c' }}>|</Text>}
          <Text style={{ position: 'relative', top: -1.9, fontSize, lineHeight: `${fontSize * lineHeight}pt`, fontWeight: index === 0 ? 600 : 400, flexShrink: 1 }}>{chip === item.url && link ? <Link src={link} style={{ color: MD_REFERENCE.bodyColor, textDecoration: 'none' }}>{chip}</Link> : chip}</Text>
        </View>)}</View>}
      {hasBody && <RichContent wrapWidth={wrapWidth} nodes={body} fontSize={fontSize} lineHeight={lineHeight} markdown />}
    </View>;
  }
  if (!neat) {
    const reference = getTemplateReference(document.templateId);
    const narrow = Boolean(reference.columns && reference.columns.leftSections.includes(sectionType));
    const accentProject = reference.profile.kind === 'banner' && sectionType === 'project';
    const titleFontSize = (sectionType === 'education' ? 16 : accentProject ? 14 : 15) * reference.pointPerPixel;
    const pageWidth = 595.28 - (document.layout.marginLeft ?? document.layout.marginHorizontal) - (document.layout.marginRight ?? document.layout.marginHorizontal);
    const entryWidth = reference.columns ? pageWidth * (narrow ? .3 : .7) - reference.columns.gap : pageWidth;
    return <View wrap={!shortReferenceEntry(item, entryWidth, fontSize, lineHeight)} style={{ paddingBottom: reference.section.itemPaddingBottom }}>
      {hasHeading && <View minPresenceAhead={fontSize * 2.7} wrap={false} style={{ flexDirection: narrow ? 'column' : 'row', alignItems: 'flex-start', minHeight: fontSize * lineHeight }}>
        <Text style={{ fontSize: titleFontSize, fontWeight: 700, color: accentProject ? color(document.layout.accent, reference.accent) : reference.bodyColor, lineHeight: `${fontSize * lineHeight}pt`, ...(narrow ? {} : { flex: 1, paddingRight: 8 * reference.pointPerPixel }) }}>{item.title}</Text>
        {dates && <Text style={{ fontSize, lineHeight: `${fontSize * lineHeight}pt`, color: '#808080', flexShrink: 0 }}>{dates}</Text>}
      </View>}
      {metadata && <Text style={{ fontSize, lineHeight: `${fontSize * lineHeight}pt`, color: '#808080' }}>{metadata}</Text>}
      {item.url && <Text style={{ fontSize, lineHeight: `${fontSize * lineHeight}pt` }}>{link ? <Link src={link} style={{ color: document.layout.accent, textDecoration: 'none' }}>{item.url}</Link> : item.url}</Text>}
      <RichContent wrapWidth={wrapWidth} nodes={item.description?.type === 'doc' ? item.description.content : [item.description]} fontSize={fontSize} lineHeight={lineHeight} neat />
    </View>;
  }
  if (neat && sectionType === 'education') {
    const rowHeight = fontSize * lineHeight;
    const columns = item.subtitle.split(' · ');
    // The importer represents major, degree and attendance type in the subtitle.
    // In the original form, attendance and the optional academy share the next row.
    const attendance = columns.length >= 3 && /^(全日制|非全日制)$/.test(columns.at(-1)!) ? columns.pop() : undefined;
    const paragraphs = item.description.type === 'doc' ? item.description.content ?? [] : [item.description];
    const detail = attendance && paragraphs[0]?.type === 'paragraph' ? paragraphs[0] : undefined;
    const label = { fontSize, color:'#8c8c8c', lineHeight:`${rowHeight}pt`, position:'relative' as const, top:2 };
    const gap = 2 * NEAT_REFERENCE.educationColumnGap;
    return <View style={{ paddingBottom:neatItemPadding }}>
      {Boolean(item.title || item.subtitle || dates) && <View minPresenceAhead={fontSize * 2.7} wrap={false}
        style={{ flexDirection:'row', minHeight:rowHeight, columnGap:gap }}>
        <Text style={{ fontSize:NEAT_REFERENCE.educationTitleFontSize, fontWeight:700, lineHeight:`${rowHeight}pt`, flexShrink:1 }}>{item.title}</Text>
        {columns.filter(Boolean).map((column,index) => <Text key={index} style={{ ...label, flexShrink:1 }}>{column}</Text>)}
        {dates && <Text style={{ ...label, marginLeft:'auto', marginRight:NEAT_REFERENCE.educationColumnGap, flexShrink:0 }}>{dates}</Text>}
      </View>}
      {attendance && <View style={{ flexDirection:'row', minHeight:rowHeight, columnGap:gap }}>
        <Text style={label}>{attendance}</Text>
        {detail && <Text style={label}>{inlineNodes(detail.content, 'academy', fontSize, lineHeight)}</Text>}
      </View>}
      {item.location && <Text style={label}>{item.location}</Text>}
      {item.url && <Text style={{ fontSize }}>{link ? <Link src={link} style={{ color:document.layout.accent, textDecoration:'none' }}>{item.url}</Link> : item.url}</Text>}
      <RichContent wrapWidth={wrapWidth} nodes={detail ? paragraphs.slice(1) : paragraphs} fontSize={fontSize} lineHeight={lineHeight} neat />
    </View>;
  }
  if (neat && (sectionType === 'project' || sectionType === 'skill')) return <View style={{ paddingBottom: neatItemPadding }}>
    {hasHeading && <View minPresenceAhead={fontSize * 2.7} wrap={false} style={{ flexDirection: 'row', alignItems: 'center', minHeight: (fontSize * lineHeight) }}>
      <Text style={{ fontSize: 15 * NEAT_REFERENCE.pointPerPixel, fontWeight: 700, lineHeight: `${(fontSize * lineHeight)}pt`, flex: 1, paddingRight: NEAT_REFERENCE.educationColumnGap }}>{item.title}</Text>
      {dates && <Text style={{ fontSize, lineHeight: `${(fontSize * lineHeight)}pt`, color: '#808080', marginLeft: 'auto', flexShrink: 0 }}>{dates}</Text>}
    </View>}
    {metadata && <Text style={{ fontSize, lineHeight: `${fontSize * lineHeight}pt`, color: '#808080' }}>{metadata}</Text>}
    {item.url && <Text style={{ fontSize, lineHeight: `${fontSize * lineHeight}pt` }}>{link ? <Link src={link} style={{ color: document.layout.accent, textDecoration: 'none' }}>{item.url}</Link> : item.url}</Text>}
    <NeatEntryBody description={item.description} wrapWidth={wrapWidth} fontSize={fontSize} lineHeight={lineHeight} />
  </View>;
  return <View style={{ ...styles.item, ...(neat ? { marginBottom: 0, paddingBottom: neatItemPadding } : { marginBottom: compact ? 5 : 8 }) }}>
    {hasHeading && <View minPresenceAhead={fontSize * 2.7} wrap={false} style={{ ...styles.row, marginBottom: metadata ? 1 : 2 }}><Text style={{ flex: 1, fontWeight: 700, fontSize: fontSize + .25, paddingRight: 8 }}>{item.title}</Text>{dates && <Text style={{ fontSize: fontSize - .8, color: '#626e7c', textAlign: 'right', maxWidth: '40%', flexShrink: 0 }}>{dates}</Text>}</View>}
    {metadata && <Text minPresenceAhead={fontSize * 1.9} style={{ ...styles.metadata, fontSize: fontSize - .4, marginBottom: 2 }}>{metadata}</Text>}
    {item.url && <Text style={{ fontSize: fontSize - .6, marginBottom: 2 }}>{link ? <Link src={link} style={{ color: document.layout.accent, textDecoration: 'none' }}>{item.url}</Link> : item.url}</Text>}
    <RichContent wrapWidth={wrapWidth} nodes={item.description?.type === 'doc' ? item.description.content : [item.description]} fontSize={fontSize} lineHeight={lineHeight} neat={neat} />
  </View>;
}

export function ResumePdf({ document: input, photoDataUrl }: ResumePdfProps): React.JSX.Element {
  const design = getMarkdownDesign(input.templateId);
  if (design) return <Document title={input.title || input.profile.name} author={input.profile.name} subject="个人简历" creator="简历" language="zh-CN">
    <CatalogTemplatePage document={input} design={design} photo={photoDataUrl}
      renderBody={item => <RichContent nodes={item.description?.type === 'doc' ? item.description.content : [item.description]}
        fontSize={input.layout.fontSize} lineHeight={input.layout.lineHeight} />} />
  </Document>;
  // Saved layouts are in normalized A4 points. The original ordinary print
  // surface uses the same 80px / 68.895pt calibration as its Markdown sibling.
  let document = input;
  const ordinary = input.templateId === 'neat' && getPresentationMode(input) === 'visual';
  if (ordinary) {
    const layout = { ...input.layout };
    for (const key of ['fontSize', 'marginTop','marginHorizontal','marginLeft','marginRight','sectionGap','titleGap','titleTopGap','contentIndent'] as const) {
      const value = layout[key];
      if (value !== undefined) layout[key] = value * NEAT_PRINT_SCALE;
    }
    document = { ...input, layout };
  }
  const template = getTemplate(document.templateId);
  const reference = getTemplateReference(template.id);
  const markdown = template.id === 'neat' && getPresentationMode(document) === 'markdown';
  const { layout, profile } = document;
  const accent = color(layout.accent, template.color);
  const fontSize = clamp(layout.fontSize, 5, 40, 10);
  const printScale = markdown ? MD_PRINT_SCALE : 1;
  const marginTop = clamp(layout.marginTop, 0, 180, 30) * printScale;
  const titleGap = clamp(layout.titleGap, 0, 100, 7);
  const sectionGap = clamp(layout.sectionGap, 0, 100, 12);
  const legacyMargin = clamp(layout.marginHorizontal, 0, 180, 32);
  const marginLeft = (layout.marginLeft ?? legacyMargin) * printScale;
  const originalCanvasOverflow = markdown ? 700 * MD_REFERENCE.pointPerPixel - 595.28 : ordinary ? 689 * NEAT_REFERENCE.pointPerPixel - 595.28 : 0;
  const marginRight = Math.max(0, (layout.marginRight ?? legacyMargin) * printScale - originalCanvasOverflow);
  const contentIndent = clamp(layout.contentIndent ?? 0, 0, 72, 0);
  const titleTopGap = layout.titleTopGap === undefined ? undefined : clamp(layout.titleTopGap, 0, 72, 0);
  const sections = document.sections.filter(section => section.visible);
  const renderSection = (section: ResumeSection, index: number) => {
    const leftColumn = reference.columns?.leftSections.includes(section.type);
    const width = (595.28 - marginLeft - marginRight) * (reference.columns ? leftColumn ? .3 : .7 : 1);
    const shortSection = template.id !== 'neat' && section.items.length === 1 && shortReferenceEntry(section.items[0], width, fontSize, clamp(layout.lineHeight, .5, 4, 1.65));
    // In the original Markdown flow, a block's bottom margin collapses
    // with the following section margin. Yoga would otherwise add the two.
    const spaceAbove = markdown && index > 0 && !section.pageBreakBefore && sections[index - 1]?.items.length
      ? Math.max(0, sectionGap - MD_REFERENCE.blockMarginBottom) : sectionGap;
    return <View key={section.id} wrap={!shortSection} break={section.pageBreakBefore} style={{ paddingTop: spaceAbove }}>
      <SectionHeading section={section} template={template} accent={accent} fontSize={fontSize} gap={titleGap} topGap={titleTopGap} bodyLineHeight={fontSize * layout.lineHeight} markdown={markdown} />
      <View style={{ paddingLeft: contentIndent }}>{section.items.map(item => <Entry wrapWidth={template.id === 'neat' ? width - contentIndent : undefined} key={item.id} item={item} document={document} compact={template.compact} sectionType={section.type} />)}</View>
    </View>;
  };
  return <Document title={document.title || `${profile.name}的简历`} author={profile.name} subject="个人简历" creator="简历" language="zh-CN">
    <Page size="A4" wrap style={{ ...styles.page, color: markdown ? MD_REFERENCE.bodyColor : template.id === 'neat' ? NEAT_REFERENCE.bodyColor : reference.bodyColor, paddingTop: template.id === 'neat' ? 0 : marginTop, paddingLeft: marginLeft, paddingRight: marginRight, paddingBottom: template.id === 'neat' ? 0 : 30 * reference.pointPerPixel, fontSize }}>
      {reference.columns ? <>
        <View fixed style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${reference.columns.leftRatio * 100}%`, backgroundColor: reference.columns.background }} />
        <View style={{ flexDirection: 'row', marginLeft: -marginLeft, marginRight: -marginRight }}>
          <View style={{ width: `${reference.columns.leftRatio * 100}%`, paddingLeft: marginLeft }}>
            <ProfileHeader document={document} template={template} accent={accent} photoDataUrl={photoDataUrl} />
            {sections.filter(section => reference.columns!.leftSections.includes(section.type)).map(renderSection)}
          </View>
          <View style={{ width: `${(1 - reference.columns.leftRatio) * 100}%`, paddingLeft: reference.columns.gap, paddingRight: marginRight }}>
            {sections.filter(section => !reference.columns!.leftSections.includes(section.type)).map(renderSection)}
          </View>
        </View>
      </> : <>
        {template.id === 'neat' && <View wrap={false} style={{height: marginTop}} />}
        <ProfileHeader document={document} template={template} accent={accent} photoDataUrl={photoDataUrl} />
        {sections.map(renderSection)}
      </>}
    </Page>
  </Document>;
}

export default ResumePdf;
