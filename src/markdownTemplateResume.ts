import { getEditorMode, parseMarkdown, switchEditingView } from './lib/markdown';
import { MARKDOWN_EMPTY, MARKDOWN_EXAMPLE } from './markdownExample';
import { canonicalCatalogId } from './markdownTemplates';
import { createResume } from './sample';
import { getTemplate } from './templates';

/** Build both the editable starter and its public cover from the same source. */
export function createMarkdownTemplateResume(templateId: string, withExample = true) {
  const template = getTemplate(templateId);
  const body = withExample ? MARKDOWN_EXAMPLE : MARKDOWN_EMPTY;
  const source = template.id === 'neat' ? body : `@[template](${template.id})\n${body}`;
  const document = parseMarkdown(source, withExample ? template.name : '未命名简历').document;
  return { ...document, presentationMode: 'markdown' as const };
}

/** Choose a design once. Both editors open the very same sample, layout and photo settings. */
export function createTemplateResume(templateId: string, withExample: boolean, editor: 'visual' | 'markdown') {
  const designId = canonicalCatalogId(templateId);
  const document = designId.startsWith('md-')
    ? createMarkdownTemplateResume(designId, withExample)
    : createResume(designId, withExample);
  if (editor === getEditorMode(document)) {
    return editor === 'markdown' ? { ...document, markdownView: 'source' as const } : document;
  }
  return switchEditingView(document);
}
