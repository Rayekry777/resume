export type RichNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: RichNode[];
};
export type SectionType = 'education' | 'experience' | 'project' | 'skill' | 'award' | 'research' | 'portfolio' | 'summary' | 'custom';
export interface ResumeItem {
  id: string;
  title: string;
  subtitle: string;
  location: string;
  startDate: string;
  endDate: string;
  /** Separator typed in an imported date range, including its spaces. */
  dateSeparator?: string;
  url: string;
  description: RichNode;
}
export interface ResumeSection {
  id: string;
  type: SectionType;
  title: string;
  visible: boolean;
  pageBreakBefore: boolean;
  items: ResumeItem[];
}
export interface ResumeProfileExtraField { key: string; label: string; value: string }
export interface ResumeProfile {
  name: string;
  title: string;
  email: string;
  phone: string;
  city: string;
  website: string;
  github: string;
  status: string;
  photoId?: string;
  /** Additional imported profile fields retain their original key and editable label. */
  extraFields?: ResumeProfileExtraField[];
}
export interface ResumeLayout {
  fontSize: number;
  lineHeight: number;
  marginTop: number;
  marginHorizontal: number;
  /** Additive point values; absent legacy fields retain the shared horizontal margin. */
  marginLeft?: number;
  marginRight?: number;
  /** Indents module entries, leaving the profile and module heading in place. */
  contentIndent?: number;
  titleTopGap?: number;
  sectionGap: number;
  titleGap: number;
  accent: string;
  headerAlign: 'left' | 'center' | 'right';
  photoShape: 'square' | 'round';
  showPhoto: boolean;
}
export interface ResumeDocument {
  id: string;
  schemaVersion: 1;
  title: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  templateId: string;
  profile: ResumeProfile;
  sections: ResumeSection[];
  layout: ResumeLayout;
  /** Missing on legacy documents; their editor mode is visual. */
  editorMode?: 'visual' | 'markdown';
  /** Last selected view inside the Markdown editor. */
  markdownView?: 'edit' | 'source';
  /** The page design stays fixed when the user changes editing views. */
  presentationMode?: 'visual' | 'markdown';
  /** Original editable source, retained verbatim when choosing a different paper design. */
  markdownSource?: string;
  /** Include the explicitly selected paper design when downloading the original .md file. */
  markdownExportTemplate?: boolean;
  deletedAt?: number;
}
export function getPresentationMode(document: ResumeDocument): 'visual' | 'markdown' {
  return document.presentationMode ?? document.editorMode ?? (document.markdownSource === undefined ? 'visual' : 'markdown');
}
export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  tags: string[];
  color: string;
  header: 'simple' | 'centered' | 'banner' | 'split' | 'card';
  heading: 'bar' | 'line' | 'pill' | 'underline' | 'plain' | 'timeline' | 'box';
  compact: boolean;
}
export interface ResumeAsset { id: string; blob: Blob; name: string; createdAt: number }
export interface ResumeSnapshot { id: string; resumeId: string; createdAt: number; document: ResumeDocument }
export interface BackupPackage { format: 'local-resume'; version: 1; createdAt: number; documents: ResumeDocument[]; assets: { id: string; name: string; type: string; path: string }[] }
export const EMPTY_RICH_TEXT: RichNode = { type: 'doc', content: [{ type: 'paragraph' }] };
export const SECTION_LABELS: Record<SectionType, string> = { education: '教育经历', experience: '工作经历', project: '项目经历', skill: '专业技能', award: '荣誉奖项', research: '研究经历', portfolio: '作品集', summary: '个人简介', custom: '自定义模块' };
export const DEFAULT_LAYOUT: ResumeLayout = { fontSize: 10, lineHeight: 1.65, marginTop: 30, marginHorizontal: 32, sectionGap: 12, titleGap: 7, accent: '#5064ee', headerAlign: 'left', photoShape: 'square', showPhoto: true };
