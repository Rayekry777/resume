import React from 'react';
import { Image, Link, Page, Path, Svg, Text, View } from '@react-pdf/renderer';
import type { MarkdownDesign } from '../markdownTemplates';
import { previewPoint as pt } from '../markdownTemplates';
import type { ResumeDocument, ResumeItem, ResumeSection } from '../model';
import { BODY_FONT } from './measureLines';
import { safePdfLink, tint } from './pdfStyle';

interface PageProps {
  document: ResumeDocument;
  design: MarkdownDesign;
  photo?: string;
  renderBody: (item: ResumeItem) => React.ReactElement;
}
const pageWidth = 595.28;
const iconPath: Record<ResumeSection['type'], string> = {
  education: 'M2 9l10-5 10 5-10 5z M6 12v5l6 3 6-3v-5',
  experience: 'M3 8h18v12H3z M8 8V5h8v3 M3 13h18',
  project: 'M3 7h7l2 2h9v11H3z', skill: 'M4 19l6-6 M12 4a5 5 0 006 7l-9 10-3-3 9-9a5 5 0 01-3-5z',
  award: 'M7 4h10v5a5 5 0 01-10 0z M12 14v5m-4 1h8',
  summary: 'M12 3a4 4 0 100 8 4 4 0 000-8z M4 21a8 8 0 0116 0',
  research: 'M9 3h6 M10 4v7L4 20h16l-6-9V4', portfolio: 'M3 5h18v14H3z M4 17l6-6 3 3 3-4 4 5',
  custom: 'M4 4h16v16H4z M7 9h10 M7 13h7',
};
function icon(section: ResumeSection, color: string) {
  return <Svg width={12} height={12} viewBox="0 0 24 24"><Path d={iconPath[section.type] || iconPath.custom} stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" fill="none" /></Svg>;
}

function Heading({ section, design, accent, onDark }: {
  section: ResumeSection; design: MarkdownDesign; accent: string; onDark: boolean;
}) {
  const kind = design.section;
  const ink = onDark ? '#ffffff' : accent;
  const size = pt(design.headingSize);
  const title = section.title || '未命名模块';
  const filled = ['pill-rule','pill','ribbon','green-tab'].includes(kind);
  const lined = ['pill-rule','timeline','icon-rule','underline','icon-line','corner','ribbon','box','green-tab'].includes(kind);
  const hasIcon = ['icon-rule','icon-line','dot','corner','timeline'].includes(kind);
  const frame = kind === 'box';
  const textInk = filled ? contrast(accent) : ['icon-rule','icon-line','timeline'].includes(kind) && !onDark ? '#272b30' : ink;
  const capsule = kind === 'pill-rule' || kind === 'pill';
  return <View wrap={false} style={{ flexDirection: 'row', alignItems: 'center',
    ...(kind === 'tinted' ? { backgroundColor: tint(accent, .86), borderLeftWidth: 3, borderLeftColor: accent, paddingLeft: 8 } : {}) }}>
    {hasIcon && <View style={{ marginRight: 5, ...(kind === 'dot' || kind === 'icon-line' ? { padding: 3, backgroundColor: accent, borderRadius: 12 } : {}) }}>
      {icon(section, kind === 'dot' || kind === 'icon-line' ? '#ffffff' : ink)}
    </View>}
    <View style={{ flexShrink: 1, paddingHorizontal: filled || frame ? pt(14) : 0, paddingVertical: pt(3),
      ...(filled ? { backgroundColor: accent, borderRadius: capsule ? pt(12) : 0 } : {}),
      ...(frame ? { borderWidth: .8, borderColor: ink } : {}),
      ...(kind === 'short-rule' ? { borderBottomWidth: 2, borderBottomColor: accent } : {}) }}>
      <Text style={{ fontSize: size, fontWeight: 700, color: textInk, lineHeight: 1.25 }}>{title}</Text>
    </View>
    {kind === 'ribbon' && <Svg width={10} height={21} viewBox="0 0 10 21"><Path d="M0 0H10L0 21Z" fill={accent}/></Svg>}
    {lined && <View style={{ flexGrow: 1, height: .7, backgroundColor: onDark ? '#bfc2c6' : tint(accent,.38), marginLeft: capsule ? 0 : 5 }} />}
  </View>;
}

function contrast(hex: string) {
  const [r,g,b] = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16) / 255);
  return r * .299 + g * .587 + b * .114 > .71 ? '#20242a' : '#ffffff';
}
function Contacts({ document, ink, stack = false }: { document: ResumeDocument; ink: string; stack?: boolean }) {
  const p = document.profile;
  const fields = [
    { value: p.phone, href: p.phone ? 'tel:' + p.phone.replace(/[\s()-]/g,'') : undefined },
    { value: p.email, href: p.email ? 'mailto:' + p.email : undefined },
    { value: p.city }, { value: p.status }, { value: p.github, href: p.github }, { value: p.website, href: p.website },
    ...(p.extraFields || []).map(v => ({ value: v.label ? v.label + ' ' + v.value : v.value, href: undefined })),
  ].filter(field => field.value);
  return <View style={{ flexDirection: stack ? 'column' : 'row', flexWrap: stack ? 'nowrap' : 'wrap', justifyContent: document.layout.headerAlign === 'center' && !stack ? 'center' : 'flex-start' }}>
    {fields.map((field, index) => {
      const href = field.href && safePdfLink(field.href);
      return <Text key={index} style={{ color: ink, fontSize: Math.max(7,document.layout.fontSize * .92), maxWidth: '100%', lineHeight: 1.55, marginRight: stack ? 0 : 11, marginBottom: stack ? 3 : 1 }}>
        {href ? <Link src={href} style={{ color: ink, textDecoration: 'none' }}>{field.value}</Link> : field.value}
      </Text>;
    })}
  </View>;
}
function Portrait({ design, document, photo }: Pick<PageProps,'design'|'document'|'photo'>) {
  if (!photo || !document.layout.showPhoto) return null;
  const round = document.layout.photoShape === 'round';
  return <Image src={photo} style={{ width: pt(design.photo[0]), height: pt(round ? design.photo[0] : design.photo[1]), objectFit: 'cover',
    borderRadius: round ? pt(design.photo[0]) / 2 : 0, flexShrink: 0 }} />;
}
function Identity({ document, design, ink, align }: Pick<PageProps,'design'|'document'> & { ink: string; align?: 'left'|'center'|'right' }) {
  return <View style={{ marginBottom: 6 }}><Text style={{ color: ink, fontSize: pt(design.nameSize), fontWeight: 700, lineHeight: 1.25, textAlign: align || document.layout.headerAlign }}>{document.profile.name || '姓名'}</Text>
    {document.profile.title && <Text style={{ color: ink, fontSize: document.layout.fontSize + .6, marginTop: 3, textAlign: align || document.layout.headerAlign }}>{document.profile.title}</Text>}
  </View>;
}

function Header(props: PageProps & { accent: string; left: number; right: number }) {
  const { design, document, accent, left, right, photo } = props;
  const kind = design.profile;
  const banner = kind === 'banner' || kind === 'red-banner';
  const wave = kind === 'wave';
  const photoLeft = ['portrait-left','portrait-block','red-banner'].includes(kind);
  const hasPhoto = Boolean(photo && document.layout.showPhoto);
  const ink = banner ? contrast(accent) : '#25282d';
  const portrait = <Portrait {...props}/>;
  const profile = <View style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
    <Identity {...props} ink={ink}/><Contacts document={document} ink={ink}/>
  </View>;
  return <View wrap={false} style={{ paddingTop: document.layout.marginTop, paddingLeft: left, paddingRight: right, paddingBottom: pt(17),
    ...(banner ? { backgroundColor: accent } : {}) }}>
    {wave && <Svg style={{ position: 'absolute', left: 0, top: 0 }} width={pageWidth} height={pt(83)} viewBox="0 0 689 83"><Path d="M0 0H689V34Q345 112 0 34Z" fill={accent}/></Svg>}
    {['top-rule','portrait-left','notch'].includes(kind) && <View style={{ position:'absolute', left:0, right:0, top:0, height: kind === 'notch' ? 2 : 5, backgroundColor: accent }}/>}
    {kind === 'notch' && <View style={{ position:'absolute', left:pageWidth * .43, top:0, width:pageWidth * .14, height:6, backgroundColor:accent }}/>}
    {kind === 'masthead' && <View style={{ paddingBottom: pt(16), marginBottom: pt(17), borderBottomWidth: 1, borderBottomColor: tint(accent,.5) }}>
      <Text style={{ color: accent, fontSize: pt(32), fontWeight: 700 }}>个人简历</Text><Text style={{ color: accent, fontSize: 9, letterSpacing: 1.5 }}>PERSONAL RESUME</Text>
    </View>}
    {wave ? <View style={{ alignItems: 'center', paddingTop: hasPhoto ? 0 : pt(52) }}>
      {portrait}<View style={{ marginTop: 7, alignSelf: 'stretch' }}><Identity {...props} ink={ink}/><Contacts document={document} ink={ink}/></View>
    </View> : <View style={{ flexDirection: photoLeft ? 'row-reverse' : 'row', alignItems: 'center',
      ...(kind === 'portrait-block' && !hasPhoto ? { borderLeftWidth: 5, borderLeftColor: accent, paddingLeft: 12 } : {}) }}>
      {profile}
      {hasPhoto && <View style={{ marginLeft: photoLeft ? 0 : 12, marginRight: photoLeft ? 15 : 0,
        ...(kind === 'portrait-block' ? { backgroundColor: accent, padding: pt(16), minHeight: pt(88), width: pt(118), alignItems:'center', justifyContent:'center' } : {}) }}>{portrait}</View>}
    </View>}
  </View>;
}

function Entry({ item, renderBody, document, narrow, ink, accent }: Pick<PageProps,'document'|'renderBody'> & { item: ResumeItem; narrow: boolean; ink: string; accent: string }) {
  const size = document.layout.fontSize;
  const date = [item.startDate, item.endDate].filter(Boolean).join(item.dateSeparator ?? ' – ');
  const details = [item.subtitle, item.location].filter(Boolean).join('  ·  ');
  const url = item.url && safePdfLink(item.url);
  return <View style={{ marginBottom: pt(6) }}>
    {(item.title || date) && <View wrap={false} minPresenceAhead={size * 1.65} style={{ flexDirection: narrow ? 'column' : 'row', alignItems: 'flex-start' }}>
      {item.title && <Text style={{ flexGrow: 1, flexShrink: 1, fontWeight: 700, fontSize: size + 1.2, color: ink }}>{item.title}</Text>}
      {date && <Text style={{ fontSize: Math.max(7,size-1), lineHeight: 1.6, paddingLeft: narrow ? 0 : 5, color: ink }}>{date}</Text>}
    </View>}
    {details && <Text style={{ fontSize: size, color: ink, marginBottom: 2 }}>{details}</Text>}
    {item.url && <Text style={{ fontSize: size }}>{url ? <Link src={url} style={{ color: accent }}>{item.url}</Link> : item.url}</Text>}
    {renderBody(item)}
  </View>;
}

export function CatalogTemplatePage(props: PageProps) {
  const { design, document } = props;
  const layout = document.layout;
  const accent = /^#[\da-f]{6}$/i.test(layout.accent) ? layout.accent : design.accent;
  const left = layout.marginLeft ?? layout.marginHorizontal;
  const right = layout.marginRight ?? layout.marginHorizontal;
  const side = design.sidebar;
  const sections = document.sections.filter(section => section.visible);
  const labels = design.section === 'label' || design.section === 'label-rule';
  function body(section: ResumeSection, narrow = false) {
    const dark = Boolean(narrow && side?.dark);
    const ink = dark ? contrast(accent) : '#30343a';
    const labelWidth = labels ? pt(design.section === 'label' ? 126 : 98) : 0;
    return <View key={section.id} break={section.pageBreakBefore} style={{ color: ink, marginTop: layout.sectionGap + (layout.titleTopGap || 0), ...(!side ? { marginLeft: left, marginRight: right } : {}) }}>
      <View minPresenceAhead={labels ? 0 : layout.fontSize * 2 + layout.titleGap} style={{ marginBottom: layout.titleGap,
        ...(labels ? { position: 'absolute', left: 0, top: 0, width: labelWidth, paddingRight: 7 } : {}) }}>
        <Heading section={section} design={design} accent={accent} onDark={dark}/>
      </View>
      <View style={{ paddingLeft: layout.contentIndent || 0, ...(labels ? { marginLeft: labelWidth, minHeight: pt(design.headingSize) * 1.5 + layout.titleGap, paddingBottom: layout.titleGap } : {}),
        ...(design.section === 'label-rule' ? { borderLeftWidth: 1, borderLeftColor: accent, paddingLeft: pt(12) + (layout.contentIndent || 0) } : {}) }}>
        {section.items.map(item => <Entry key={item.id} {...props} item={item} narrow={narrow} ink={ink} accent={dark ? ink : accent}/>)}
      </View>
    </View>;
  }
  const sideWidth = side ? pt(side.width) : 0;
  const sideInk = side?.dark ? contrast(accent) : '#33383e';
  const oppositeIdentity = design.profile === 'side-right' || design.profile === 'side-masthead';
  const sideTop = <View wrap={false}>
    {design.profile === 'side-blue' && <Text style={{ textAlign:'center', color:accent, fontSize:9, marginBottom:9, letterSpacing:1.3 }}>PERSONAL RESUME</Text>}
    {props.photo && layout.showPhoto && <View style={{ alignItems:'center', marginBottom:12 }}><Portrait {...props}/></View>}
    {!oppositeIdentity && <Identity {...props} ink={sideInk} align="center"/>}
    <Contacts document={document} ink={sideInk} stack/>
  </View>;
  return <Page size="A4" wrap style={{ fontFamily: BODY_FONT, fontSize: layout.fontSize, lineHeight: layout.lineHeight, color: '#30343a', paddingBottom: pt(22), backgroundColor:'#ffffff' }}>
    {design.profile === 'edge' && <View fixed style={{ position:'absolute', left:0, top:0, bottom:0, width:pt(4), backgroundColor:accent }}/>}
    {side ? <>
      <View fixed style={{ position:'absolute', top:0, bottom:0, ...(side.edge === 'left' ? {left:0} : {right:0}), width:sideWidth,
        backgroundColor: side.dark ? accent : design.profile === 'side-masthead' ? '#efefef' : tint(accent,.93) }}/>
      {design.profile === 'side-blue' && <View style={{ position:'absolute', top:0, left:0, right:0, height:5, backgroundColor:accent }}/>}
      {design.profile === 'side-masthead' && <View style={{ position:'absolute', top:0, left:props.photo && layout.showPhoto ? 0 : sideWidth, right:0, height:pt(130), backgroundColor:accent }}/>}
      <View style={{ flexDirection:side.edge === 'left' ? 'row' : 'row-reverse' }}>
        <View style={{ width:sideWidth, paddingHorizontal:Math.min(sideWidth/4,side.edge === 'left' ? left : right), paddingTop:layout.marginTop }}>
          {sideTop}{sections.filter(s=>side.sections.includes(s.type)).map(s=>body(s,true))}
        </View>
        <View style={{ width:pageWidth-sideWidth, paddingLeft:left, paddingRight:right, paddingTop:layout.marginTop }}>
          {oppositeIdentity && <View wrap={false} style={{ minHeight:design.profile === 'side-masthead' ? Math.max(pt(36), pt(140) - layout.marginTop) : pt(70) }}>
            <Identity {...props} ink={design.profile === 'side-masthead' ? contrast(accent) : '#27292d'}/>
          </View>}
          {sections.filter(s=>!side.sections.includes(s.type)).map(s=>body(s))}
        </View>
      </View>
    </> : <>
      <Header {...props} accent={accent} left={left} right={right}/>
      {sections.map(s=>body(s))}
    </>}
  </Page>;
}
