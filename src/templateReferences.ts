import type { ResumeLayout, SectionType, TemplateDefinition } from './model';

/** These public catalog entries point to the same paper in both editors. */
export function canonicalCatalogId(id: string): string {
  if (id === 'md-generous') return 'elegant';
  if (id === 'md-graduate-steady') return 'steady';
  return id;
}

/** A4 dimensions for the 689px template canvas. Multiple catalog entries
 * can share one design object while keeping their own local template keys. */
export interface TemplateReference {
  name: string;
  tags: string[];
  accent: string;
  paperWidthPx: number;
  pointPerPixel: number;
  bodyColor: string;
  header: TemplateDefinition['header'];
  headingCategory: TemplateDefinition['heading'];
  defaultLayout: Partial<ResumeLayout>;
  profile: {
    kind: 'standard' | 'photo-left' | 'banner' | 'elegant' | 'steady' | 'sidebar';
    height: number;
    background: string;
    color: string;
    nameColor: string;
    nameFontSize: number;
    nameLineHeight: number;
    nameMarginBottom: number;
    nameAlign: ResumeLayout['headerAlign'];
    contactFontSize: number;
    contactLineHeight: number;
    paddingBottom: number;
    photoWidth: number;
    photoHeight: number;
    photoRadius: number;
    photoTop: number;
    photoLeft: number;
    nameLeft: number;
    nameTop: number;
  };
  heading: {
    kind: 'underline' | 'icon-underline' | 'stripe' | 'tab' | 'icon' | 'capsule' | 'plain';
    height: number;
    fontSize: number;
    lineHeight: number;
    color: string;
    background: string;
    textLeft: number;
    textTop: number;
    borderWidth: number;
    stripeWidth: number;
    stripeLeft: number;
    stripeHeight: number;
    tabWidth: number;
    radius: number;
  };
  section: { paddingTop: number; marginTop: number; headingMarginTop: number; headingMarginBottom: number; itemPaddingBottom: number };
  columns?: {
    leftRatio: number;
    background: string;
    leftPadding: number;
    topPadding: number;
    rightPadding: number;
    gap: number;
    leftSections: SectionType[];
  };
}

const PAPER_WIDTH = 689;
const k = 595.28 / PAPER_WIDTH;
const pt = (value: number) => value * k;
type SourceOptions = {
  name: string; tags: string[]; accent?: string;
  horizontal?: number; top?: number; sectionPadding?: number;
  sectionMargin?: number; headingTop?: number; headingBottom?: number;
  profileKind?: TemplateReference['profile']['kind']; nameAlign?: ResumeLayout['headerAlign'];
  headingKind?: TemplateReference['heading']['kind']; headingHeight?: number;
  headingFont?: number; headingTextLeft?: number; headingTextTop?: number;
  stripeWidth?: number; stripeHeight?: number; stripeLeft?: number; tabWidth?: number;
  profileHeight?: number;
  sidebarPadding?: number;
};

function measured(options: SourceOptions): TemplateReference {
  const accent = options.accent ?? '#000000';
  const kind = options.profileKind ?? 'standard';
  const headingKind = options.headingKind ?? 'underline';
  const top = options.top ?? 30, horizontal = options.horizontal ?? 30;
  const sectionPadding = options.sectionPadding ?? 2;
  const headingTop = options.headingTop ?? 0, headingBottom = options.headingBottom ?? 12;
  const sidebar = kind === 'sidebar';
  const headingHeight = options.headingHeight ?? 36;
  const header: TemplateDefinition['header'] = sidebar || kind === 'photo-left' ? 'split' : kind === 'banner' ? 'banner' : kind === 'elegant' ? 'card' : kind === 'steady' || options.nameAlign === 'center' ? 'centered' : 'simple';
  const headingCategory: TemplateDefinition['heading'] = headingKind === 'stripe' ? 'bar' : headingKind === 'tab' || headingKind === 'capsule' ? 'pill' : headingKind === 'icon' ? 'timeline' : headingKind === 'plain' ? 'plain' : 'underline';
  return {
    name: options.name, tags: options.tags, accent,
    paperWidthPx: PAPER_WIDTH, pointPerPixel: k, bodyColor: '#262626', header, headingCategory,
    defaultLayout: {
      fontSize: pt(14), lineHeight: (kind === 'banner' ? 18 : 27) / 14,
      marginTop: pt(sidebar ? options.sidebarPadding ?? 20 : top),
      marginHorizontal: pt(sidebar ? options.sidebarPadding ?? 20 : horizontal),
      marginLeft: pt(sidebar ? options.sidebarPadding ?? 20 : horizontal),
      marginRight: pt(sidebar ? options.sidebarPadding ?? 20 : horizontal),
      contentIndent: 0, sectionGap: pt(sectionPadding + (options.sectionMargin ?? 0)),
      titleTopGap: pt(headingTop), titleGap: pt(headingBottom), accent,
      headerAlign: options.nameAlign ?? 'left',
    },
    profile: {
      kind, height: pt(options.profileHeight ?? 104),
      background: kind === 'banner' ? accent : kind === 'elegant' ? '#f0f5f9' : 'transparent',
      color: kind === 'banner' || kind === 'steady' ? '#ffffff' : kind === 'elegant' ? '#656970' : '#262626',
      nameColor: kind === 'banner' ? '#ffffff' : kind === 'steady' ? accent : kind === 'elegant' ? '#181a1e' : '#262626',
      nameFontSize: pt(kind === 'elegant' ? 27 : kind === 'steady' ? 20 : 22),
      nameLineHeight: pt(kind === 'elegant' ? 32 : kind === 'steady' ? 26 : 22),
      nameMarginBottom: pt(8), nameAlign: options.nameAlign ?? 'left',
      contactFontSize: pt(14), contactLineHeight: pt(kind === 'banner' ? 20 : 27), paddingBottom: pt(8),
      photoWidth: pt(sidebar ? 60 : kind === 'elegant' ? 74 : kind === 'steady' ? 95 : 80),
      photoHeight: pt(sidebar ? 60 : kind === 'elegant' ? 80 : kind === 'steady' ? 95 : 96),
      photoRadius: pt(kind === 'steady' ? 47.5 : kind === 'elegant' ? 12 : 0),
      photoTop: pt(kind === 'elegant' ? 48.5 : 0),
      photoLeft: pt(kind === 'elegant' ? 538 : 0),
      nameLeft: pt(kind === 'elegant' ? 32 : kind === 'steady' ? 109 : 0),
      nameTop: pt(kind === 'elegant' || kind === 'steady' ? 22 : 0),
    },
    heading: {
      kind: headingKind, height: pt(headingHeight), fontSize: pt(options.headingFont ?? 18), lineHeight: pt(kind === 'banner' ? 18 : 27),
      color: headingKind === 'tab' || headingKind === 'capsule' ? '#ffffff' : headingKind === 'plain' ? '#000000' : headingKind === 'icon' ? '#292b30' : accent,
      background: 'transparent',
      textLeft: pt(options.headingTextLeft ?? (headingKind === 'stripe' || headingKind === 'tab' ? 12 : headingKind === 'capsule' ? 23 : headingKind === 'icon' ? 32 : 0)),
      textTop: pt(options.headingTextTop ?? (headingKind === 'underline' ? 4 : 0)),
      borderWidth: pt(headingKind === 'underline' || headingKind === 'icon-underline' || headingKind === 'tab' ? 1 : 0),
      stripeWidth: pt(options.stripeWidth ?? (headingKind === 'stripe' ? 6 : 0)),
      stripeHeight: pt(options.stripeHeight ?? headingHeight), stripeLeft: pt(options.stripeLeft ?? 0),
      tabWidth: pt(options.tabWidth ?? (headingKind === 'capsule' ? 118 : 96)), radius: pt(headingKind === 'capsule' ? 13 : 0),
    },
    section: { paddingTop: pt(sectionPadding), marginTop: pt(options.sectionMargin ?? 0), headingMarginTop: pt(headingTop), headingMarginBottom: pt(headingBottom), itemPaddingBottom: pt(8) },
    ...(sidebar ? { columns: { leftRatio: .3, background: '#f0eee2', leftPadding: pt(options.sidebarPadding ?? 20), topPadding: pt(options.sidebarPadding ?? 20), rightPadding: pt(options.sidebarPadding ?? 20), gap: pt(10), leftSections: ['education', 'award', 'summary'] as SectionType[] } } : {}),
  };
}

const references: Record<string, TemplateReference> = {
  neat: measured({ name:'美观整齐简历模板', tags:['校招','实习','社招','大学生'], accent:'#4672f1', headingKind:'stripe', headingHeight:30, headingTextLeft:18, headingTextTop:4, headingTop:12 }),
  'frontend-pro': measured({ name:'前端社招简历模板', tags:['前端开发','社招','大学生'] }),
  elegant: measured({ name:'通用美观大方简历模板', tags:['通用','校招','实习','社招','大学生'], accent:'#5695c3', horizontal:25, top:16, profileKind:'elegant', profileHeight:185, sectionPadding:16, sectionMargin:16, headingKind:'icon', headingHeight:24 }),
  operations: measured({ name:'运营社招简历模板', tags:['运营','社招','大学生'], accent:'#0cb2ac', horizontal:40, sectionPadding:4 }),
  mono: measured({ name:'黑白整齐美观大方简历模板', tags:['后端开发','校招','实习','社招','大学生'], sectionPadding:4 }),
  minimal: measured({ name:'极简专业美观大方简历模板', tags:['校招','实习','社招','大学生'], accent:'#4672f2', horizontal:20, top:20, profileKind:'photo-left', nameAlign:'center', headingKind:'stripe', headingHeight:27, sectionPadding:16 }),
  creative: measured({ name:'创意专业简约大气简历模板', tags:['社招','实习','校招'], accent:'#436eee', nameAlign:'center', headingKind:'tab', headingHeight:28, stripeWidth:96, stripeHeight:27 }),
  engineering: measured({ name:'电子信息工程通用简约大气简历模板', tags:['电子信息工程','网络安全','.NET工程师','算法工程师','Web前端','互联网','大学生'], accent:'#436eee', nameAlign:'center' }),
  professional: measured({ name:'简约专业美观大方简历模板', tags:['社招','校招','实习'], accent:'#a05fca', horizontal:35, top:24, profileKind:'banner', profileHeight:134, sectionPadding:12, headingKind:'plain', headingHeight:32, headingTop:6, headingBottom:0, headingTextTop:0, headingTextLeft:26 }),
  'java-campus': measured({ name:'Java后端校招简历模板', tags:['后端开发','校招','Java','大学生'], horizontal:40, sectionPadding:4 }),
  organized: measured({ name:'应届生通用专业整洁简历模板', tags:['社招','实习','校招','大学生'], accent:'#4672f2', profileKind:'sidebar', sidebarPadding:5, profileHeight:157, sectionPadding:16, headingKind:'stripe', headingHeight:27, headingTop:12 }),
  'java-pro': measured({ name:'Java后端社招简历模板', tags:['后端开发','社招','Java','大学生'], horizontal:39, top:31, sectionPadding:5 }),
  steady: measured({ name:'应届生通用优雅稳重简历模板', tags:['通用','校招','实习','社招','大学生'], accent:'#446898', horizontal:36, top:33, profileKind:'steady', profileHeight:103, sectionPadding:16, sectionMargin:8, headingKind:'capsule', headingHeight:34 }),
  graduate: measured({ name:'应届生通用简约大气简历模板', tags:['社招','实习','校招','大学生'], accent:'#4672f2', profileKind:'sidebar', sidebarPadding:20, profileHeight:172, nameAlign:'center', sectionPadding:16, headingKind:'tab', headingHeight:29, headingTop:12, stripeWidth:100, stripeLeft:-4, stripeHeight:28 }),
  'java-intern': measured({ name:'Java后端实习简历模板', tags:['后端开发','实习','Java','大学生'], horizontal:40 }),
  fresh: measured({ name:'应届生通用清新雅致简历模板', tags:['校招','实习','社招','大学生'], accent:'#4672f2', profileKind:'sidebar', sidebarPadding:20, profileHeight:172, sectionPadding:16, headingTop:12 }),
  classic: measured({ name:'应届生通用经典商务简历模板', tags:['校招','实习','社招','大学生'], accent:'#4672f2', profileKind:'sidebar', sidebarPadding:5, profileHeight:157, nameAlign:'center', sectionPadding:16, headingTop:12 }),
  'frontend-campus': measured({ name:'前端校招简历模板', tags:['校招','前端开发','大学生'] }),
  modern: measured({ headingKind:'icon-underline', name:'新颖时尚美观大方简历模板', tags:['社招','校招','实习','大学生'], accent:'#284967', horizontal:20, top:20, sectionPadding:16, headingFont:16, headingTextTop:6, headingTextLeft:46 }),
  'operations-campus': measured({ name:'运营校招简历模板', tags:['运营','大学生'], horizontal:40, sectionPadding:4 }),
  'frontend-intern': measured({ name:'前端实习简历模板', tags:['前端开发','实习','大学生'] }),
};

// The established blue-template/Markdown renderer has a separately verified
// typography baseline.  Preserve that baseline when exposing creation defaults.
references.neat.defaultLayout = { ...references.neat.defaultLayout, fontSize:pt(12), lineHeight:22 / 12, titleTopGap:pt(12) };
references.neat.profile.contactFontSize = pt(12);
references.neat.profile.contactLineHeight = pt(22);
references.neat.heading.lineHeight = pt(22);
references.neat.heading.background = '#edf1fe';
references.product = references['java-pro'];

export const TEMPLATE_REFERENCES: Readonly<Record<string, TemplateReference>> = references;
export function getTemplateReference(localId: string): TemplateReference { return references[canonicalCatalogId(localId)] ?? references.neat; }
