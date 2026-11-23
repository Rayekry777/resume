import { canonicalCatalogId, getTemplateReference } from './templateReferences';
export { canonicalCatalogId } from './templateReferences';
import type { ResumeLayout, SectionType, TemplateDefinition } from './model';

export type ProfileStyle = 'masthead' | 'side-right' | 'side-masthead' | 'top-rule' | 'wave' | 'banner' | 'portrait-left' | 'portrait-block' | 'edge' | 'side-blue' | 'notch' | 'side-dark' | 'side-green' | 'red-banner';
export type SectionStyle = 'pill-rule' | 'timeline' | 'icon-rule' | 'underline' | 'dot' | 'label' | 'label-rule' | 'tinted' | 'pill' | 'icon-line' | 'corner' | 'ribbon' | 'box' | 'green-tab' | 'short-rule';

interface Measurements {
  id: string;
  name: string;
  accent: string;
  profile: ProfileStyle;
  section: SectionStyle;
  photo: [number, number];
  nameSize: number;
  headingSize: number;
  inset: number;
  top: number;
  round?: boolean;
  sidebar?: { edge: 'left' | 'right'; width: number; sections: SectionType[]; dark?: boolean };
}
export interface MarkdownDesign extends Measurements { layout: Partial<ResumeLayout> }

// Profile, photo and column measurements use the 689px-wide template preview.
// Editable lengths are stored in A4 points, shared by both editing modes.
export const previewPoint = (px: number) => px * 595.28 / 689;
const designs: Measurements[] = [
  { id: 'md-atmosphere', name: '通用简约大气简历模板', accent: '#607a9d', profile: 'masthead', section: 'pill-rule', photo: [77,84], nameSize: 24, headingSize: 18, inset: 30, top: 28 },
  { id: 'md-graduate-modern', name: '应届生通用新颖时尚简历模板', accent: '#474747', profile: 'side-right', section: 'timeline', photo: [120,120], nameSize: 30, headingSize: 15, inset: 24, top: 38, round: true, sidebar: { edge: 'right', width: 232, sections: ['education','skill','award'], dark: true } },
  { id: 'md-graduate-business', name: '应届生通用简洁商务简历模板', accent: '#353535', profile: 'side-masthead', section: 'icon-rule', photo: [142,142], nameSize: 28, headingSize: 14, inset: 28, top: 30, round: true, sidebar: { edge: 'left', width: 213, sections: ['skill','custom','award'] } },
  { id: 'md-graduate-fresh', name: '应届生通用清新简约简历模板', accent: '#9c5bde', profile: 'top-rule', section: 'underline', photo: [100,100], nameSize: 22, headingSize: 18, inset: 42, top: 42 },
  { id: 'md-graduate-creative', name: '应届生通用创意专业简历模板', accent: '#4184ff', profile: 'wave', section: 'dot', photo: [84,84], nameSize: 24, headingSize: 16, inset: 28, top: 27, round: true },
  { id: 'md-premium', name: '通用高级质感简历模板', accent: '#0e88ad', profile: 'banner', section: 'label', photo: [86,94], nameSize: 24, headingSize: 17, inset: 25, top: 28 },
  { id: 'md-classic', name: '通用经典商务简历模板', accent: '#5695c3', profile: 'portrait-left', section: 'label-rule', photo: [68,74], nameSize: 25, headingSize: 18, inset: 25, top: 29 },
  { id: 'md-elegant', name: '通用清新雅致简历模板', accent: '#67a886', profile: 'portrait-block', section: 'tinted', photo: [74,80], nameSize: 26, headingSize: 16, inset: 25, top: 22 },
  { id: 'md-clear', name: '通用简洁清晰简历模板', accent: '#3978a3', profile: 'banner', section: 'pill', photo: [82,82], nameSize: 25, headingSize: 16, inset: 25, top: 29, round: true },
  { id: 'md-organized', name: '通用专业整洁简历模板', accent: '#5695c3', profile: 'edge', section: 'icon-line', photo: [72,78], nameSize: 25, headingSize: 16, inset: 33, top: 24 },
  { id: 'md-business', name: '通用商务大气简历模板', accent: '#5695c3', profile: 'side-blue', section: 'corner', photo: [100,109], nameSize: 25, headingSize: 15, inset: 25, top: 38, sidebar: { edge: 'left', width: 240, sections: ['skill','award'] } },
  { id: 'md-refined', name: '通用精致美观简历模板', accent: '#53637c', profile: 'notch', section: 'ribbon', photo: [91,98], nameSize: 20, headingSize: 15, inset: 34, top: 28 },
  { id: 'md-steady', name: '通用优雅稳重简历模板', accent: '#545969', profile: 'side-dark', section: 'box', photo: [101,109], nameSize: 22, headingSize: 16, inset: 25, top: 34, sidebar: { edge: 'left', width: 240, sections: ['summary'], dark: true } },
  { id: 'md-fresh', name: '通用清新简约简历模板', accent: '#76ba31', profile: 'side-green', section: 'green-tab', photo: [116,116], nameSize: 26, headingSize: 16, inset: 22, top: 20, round: true, sidebar: { edge: 'left', width: 202, sections: ['skill'] } },
  { id: 'md-graduate-refined', name: '应届生通用精致美观简历模板', accent: '#a02132', profile: 'red-banner', section: 'short-rule', photo: [70,84], nameSize: 19.5, headingSize: 18, inset: 26, top: 34 },
];

const normalized = new Map(designs.map((definition): [string, MarkdownDesign] => {
  const margin = previewPoint(definition.inset);
  return [definition.id, { ...definition, layout: {
    marginHorizontal: margin, marginLeft: margin, marginRight: margin,
    marginTop: previewPoint(definition.top), sectionGap: previewPoint(10),
    titleTopGap: 0, titleGap: previewPoint(9), headerAlign: definition.profile === 'wave' ? 'center' : 'left',
    photoShape: definition.round ? 'round' : 'square',
  } }];
}));
export const getMarkdownDesign = (id: string): MarkdownDesign | undefined => normalized.get(canonicalCatalogId(id));
export const ADDITIONAL_TEMPLATES: TemplateDefinition[] = designs.map(design => ({
  id: design.id, name: design.name, description: design.name.replace(/简历模板$/, ''),
  tags: ['通用', '校招', '实习', '社招', '大学生'], color: design.accent,
  header: design.sidebar ? 'split' : design.profile === 'wave' ? 'centered' : ['banner','red-banner'].includes(design.profile) ? 'banner' : 'simple',
  heading: design.section === 'timeline' ? 'timeline' : design.section.startsWith('pill') ? 'pill' : 'line',
  compact: false,
}));
// Keep the order of the public collection. These two entries resolve to existing
// designs before creating a resume, loading its cover or applying its layout.
function sharedTemplate(id: string): TemplateDefinition {
  const reference = getTemplateReference(canonicalCatalogId(id));
  return { id, name: reference.name, description: reference.name, tags: reference.tags, color: reference.accent,
    header: reference.header, heading: reference.headingCategory, compact: false };
}
export const MARKDOWN_TEMPLATES = [
  ...ADDITIONAL_TEMPLATES.flatMap(template => template.id === 'md-graduate-refined'
    ? [sharedTemplate('md-generous'), template, sharedTemplate('md-graduate-steady')] : [template]),
];
