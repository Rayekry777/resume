import { DEFAULT_LAYOUT, getPresentationMode } from './model';
import type { ResumeDocument, ResumeLayout, TemplateDefinition } from './model';
import { getTemplateReference } from './templateReferences';
import { MARKDOWN_TEMPLATES, canonicalCatalogId, getMarkdownDesign } from './markdownTemplates';

// Measurements from the unscaled 689px original paper, normalized to A4 points.
const neatPoint = (pixels: number) => pixels * 595.28 / 689;
export const NEAT_REFERENCE = {
  paperWidthPx: 689,
  pointPerPixel: 595.28 / 689,
  bodyColor: '#262626',
  accent: '#4672f1',
  nameFontSize: neatPoint(22),
  nameLineHeight: neatPoint(22),
  nameMarginBottom: neatPoint(8),
  contactFontSize: neatPoint(12),
  contactLineHeight: neatPoint(22),
  contactIconSize: neatPoint(12),
  contactIconGap: neatPoint(4),
  contactItemGap: neatPoint(8),
  photoWidth: neatPoint(80),
  photoHeight: neatPoint(94),
  photoAreaHeight: neatPoint(96),
  profilePaddingBottom: neatPoint(8),
  headingFontSize: neatPoint(18),
  headingLineHeight: neatPoint(22),
  headingHeight: neatPoint(30),
  headingPaddingVertical: neatPoint(4),
  headingPaddingHorizontal: neatPoint(18),
  headingStripeWidth: neatPoint(6),
  headingMarginTop: neatPoint(12),
  educationTitleFontSize: neatPoint(16),
  educationColumnGap: neatPoint(8),
  defaultLayout: {
    fontSize: neatPoint(12), lineHeight: 22 / 12,
    marginTop: neatPoint(30), marginHorizontal: neatPoint(30),
    marginLeft: neatPoint(30), marginRight: neatPoint(30), contentIndent: 0, titleTopGap: neatPoint(12),
    sectionGap: neatPoint(2), titleGap: neatPoint(12), accent: '#4672f1',
  },
} as const;

const markdownPoint = (pixels: number) => pixels * 595.28 / 700;
/** The original Markdown editor uses its own 700px paper and typography. */
export const MD_REFERENCE = {
  paperWidthPx: 700, pointPerPixel: 595.28 / 700,
  bodyColor: '#262626', accent: '#4672f1',
  nameFontSize: markdownPoint(20), nameLineHeight: markdownPoint(26), nameMarginBottom: markdownPoint(10),
  contactFontSize: markdownPoint(12), contactLineHeight: markdownPoint(20),
  contactIconSize: markdownPoint(12), contactIconGap: markdownPoint(4),
  contactRowGap: markdownPoint(8), contactColumnGap: markdownPoint(16),
  profileMarginBottom: markdownPoint(20), profilePhotoReservedWidth: markdownPoint(100),
  photoWidth: markdownPoint(80), photoHeight: markdownPoint(96),
  headingFontSize: markdownPoint(17), headingLineHeight: markdownPoint(20), headingHeight: markdownPoint(29),
  headingPaddingVertical: markdownPoint(4), headingPaddingLeft: markdownPoint(12),
  headingStripeWidth: markdownPoint(4), headingStripeHeight: markdownPoint(20), headingStripeTop: markdownPoint(4),
  headingBorderWidth: markdownPoint(1), headingBorderColor: '#e8e8e8',
  blockMarginBottom: markdownPoint(12), chipsMarginBottom: markdownPoint(4), chipsRowGap: markdownPoint(4), chipSeparatorMargin: markdownPoint(8),
  listFontRatio: 12 / 13, listPaddingLeft: markdownPoint(16.8), listMarginBottom: markdownPoint(6), listItemMargin: markdownPoint(2),
  defaultLayout: {
    fontSize: markdownPoint(13), lineHeight: 20 / 13,
    marginTop: markdownPoint(30), marginHorizontal: markdownPoint(30),
    marginLeft: markdownPoint(30), marginRight: markdownPoint(30), contentIndent: 0,
    sectionGap: markdownPoint(2), titleTopGap: 0, titleGap: markdownPoint(10), accent: '#4672f1',
  },
} as const;

const templateIds = [
  'neat', 'frontend-pro', 'elegant', 'operations', 'mono', 'minimal',
  'creative', 'engineering', 'professional', 'java-campus', 'organized',
  'java-pro', 'steady', 'graduate', 'java-intern', 'fresh', 'classic',
  'frontend-campus', 'modern', 'operations-campus', 'product', 'frontend-intern',
];
export const TEMPLATES: TemplateDefinition[] = templateIds.map(id => {
  const reference = getTemplateReference(id);
  const descriptions: Record<string, string> = {
    standard: '清晰的个人信息与经历分区',
    'photo-left': '左侧照片与简洁的蓝色分区',
    banner: '紫色页眉与黑色图标标题',
    elegant: '浅蓝信息卡与圆形模块图标',
    steady: '圆形照片、蓝色联系栏与圆角标题',
    sidebar: '米色侧栏与左右双栏布局',
  };
  return {
    id, name: reference.name, description: descriptions[reference.profile.kind],
    tags: reference.tags, color: reference.accent, header: reference.header,
    heading: reference.headingCategory, compact: false,
  };
});
export function getTemplate(id: string): TemplateDefinition {
  const canonical = canonicalCatalogId(id);
  return TEMPLATES.find(t => t.id === canonical) ?? MARKDOWN_TEMPLATES.find(t => t.id === canonical) ?? TEMPLATES[0];
}

export function templatePointPerPixel(templateId: string, mode: 'visual' | 'markdown'): number {
  return getMarkdownDesign(templateId) || (templateId === 'neat' && mode === 'markdown')
    ? MD_REFERENCE.pointPerPixel : NEAT_REFERENCE.pointPerPixel;
}

export function templateLayout(templateId: string, mode: 'visual' | 'markdown' = 'visual'): ResumeLayout {
  const id = canonicalCatalogId(templateId);
  const design = getMarkdownDesign(id);
  if (design) return { ...DEFAULT_LAYOUT, ...MD_REFERENCE.defaultLayout, ...design.layout, accent: design.accent };
  const reference = getTemplateReference(id);
  const typography = id === 'neat' && mode === 'markdown' ? MD_REFERENCE.defaultLayout : reference.defaultLayout;
  return { ...DEFAULT_LAYOUT, ...typography, accent: reference.accent };
}

export function applyResumeTemplate(document: ResumeDocument, templateId: string, mode?: 'visual' | 'markdown'): ResumeDocument {
  const id = getTemplate(templateId).id;
  const presentationMode = getMarkdownDesign(id) ? 'markdown' : mode ?? getPresentationMode(document);
  const layout = templateLayout(id, presentationMode);
  // Photo visibility and cropping are choices about this resume.
  layout.showPhoto = document.layout.showPhoto;
  layout.photoShape = document.layout.photoShape;
  const changedTemplate = id !== canonicalCatalogId(document.templateId)
    || (id === 'neat' && presentationMode !== getPresentationMode(document));
  return { ...document, templateId: id, layout, presentationMode,
    ...(changedTemplate && document.markdownSource !== undefined ? { markdownExportTemplate: true } : {}) };
}

export function resetResumeSpacing(document: ResumeDocument): ResumeLayout {
  const defaults = templateLayout(document.templateId, getPresentationMode(document));
  return {
    ...document.layout,
    marginTop: defaults.marginTop,
    marginLeft: defaults.marginLeft ?? defaults.marginHorizontal,
    marginRight: defaults.marginRight ?? defaults.marginHorizontal,
    contentIndent: defaults.contentIndent ?? 0,
    sectionGap: defaults.sectionGap,
    titleTopGap: defaults.titleTopGap ?? 0,
    titleGap: defaults.titleGap,
  };
}

export const templateCategories = ['全部', '通用', '程序员', '运营', '校招', '社招', '实习'];
export function matchesTemplate(template: TemplateDefinition, category: string, search: string): boolean {
  const coding = template.tags.some(tag => /开发|工程师|Web前端/.test(tag));
  const terms = [template.name, template.description, ...template.tags, ...(coding ? ['程序员'] : [])];
  const matchesCategory = category === '全部' || (category === '程序员' ? coding : terms.some(term => term.includes(category)));
  return matchesCategory && terms.join(' ').toLowerCase().includes(search.trim().toLowerCase());
}
export const PALETTES = ['#4672f1','#000000','#0cb2ac','#5695c3','#436eee','#a05fca','#446898','#284967'];
