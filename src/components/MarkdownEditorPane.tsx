import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Award, BookOpen, BriefcaseBusiness, ChevronDown, Code2, FileText, GraduationCap, ImagePlus, Layers3, LayoutTemplate, Microscope, Plus, Sparkles, Trash2, UserRound, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ResumeDocument } from '../model';
import { getMarkdownSource, getSourceStatus, updateMarkdownSource } from '../lib/markdown';
import { analyzeMarkdownSource, appendMarkdownBlock, insertMarkdownProfileField, matchMarkdownLineEndings, moveMarkdownBlock, removeMarkdownBlock, replaceMarkdownField, replaceMarkdownText } from '../lib/markdownSource';
import type { MarkdownSourceField, MarkdownSourceRegion } from '../lib/markdownSource';
import Modal from './Modal';
import ActionMenu from './ActionMenu';
import './markdownModules.css';

export interface MarkdownEditorPaneProps {
  document: ResumeDocument;
  onUpdate: (update: (document: ResumeDocument) => ResumeDocument) => void;
  onChoosePhoto: () => void;
  onScrollRatio?: (ratio: number) => void;
  syncScroll: boolean;
  modulesOpen?: boolean;
  onCloseModules?: () => void;
}
const INFO_FIELDS = [
  { key: 'name', label: '姓名' }, { key: 'phone', label: '联系电话' }, { key: 'email', label: '电子邮箱' }, { key: 'position', label: '期望职位' },
  { key: 'status', label: '当前状态' }, { key: 'city', label: '所在城市' }, { key: 'website', label: '个人网站' }, { key: 'github', label: 'GitHub / 作品链接' },
];
const FIELD_LABELS: Record<string, string> = {
  name: '名称', phone: '电话', mobile: '电话', email: '邮箱', position: '职位', title: '标题', status: '状态', city: '城市', address: '地址', website: '网站', github: 'GitHub',
  school: '学校', major: '专业', degree: '学历', degreetype: '补充信息', time: '时间', date: '时间', duration: '时间', company: '公司 / 组织', organization: '组织', role: '担任角色', department: '部门', job: '职位',
  subtitle: '补充信息', location: '地点', startdate: '开始时间', enddate: '结束时间', url: '相关链接', link: '相关链接', avatar: '原头像地址', photo: '原头像地址', documenttitle: '文档名称', template: '模板标识', sectionvisible: '显示模块', pagebreakbefore: '另起一页',
};
const INTERNAL_ID_FIELDS = new Set(['id', 'uuid', 'resumeid', 'documentid', 'sectionid', 'itemid', 'profileid', 'assetid', 'photoid', 'schemaversion', 'revision', 'createdat', 'updatedat', 'deletedat', 'editormode', 'markdownview', 'presentationmode', 'markdownsource', 'profileextra']);
function isProfileField(field: MarkdownSourceField): boolean { const key = field.key.toLowerCase(); return !INTERNAL_ID_FIELDS.has(key) && !['documenttitle', 'template', 'avatar', 'photo'].includes(key); }
function isModuleField(field: MarkdownSourceField, type: string): boolean { const key = field.key.toLowerCase(); return !INTERNAL_ID_FIELDS.has(key) && key !== 'sectionvisible' && key !== 'pagebreakbefore' && !(type === 'summary' && key === 'name' && !field.value); }
const MODULES: { type: string; title: string; icon: LucideIcon; fields: string[] }[] = [
  { type: 'education', title: '教育经历', icon: GraduationCap, fields: ['school', 'major', 'degree', 'time'] },
  { type: 'experience', title: '工作经历', icon: BriefcaseBusiness, fields: ['company', 'position', 'time'] },
  { type: 'project', title: '项目经历', icon: BookOpen, fields: ['name', 'role', 'time'] },
  { type: 'skill', title: '专业技能', icon: Wrench, fields: ['name'] },
  { type: 'advantage', title: '个人优势', icon: Sparkles, fields: [] },
  { type: 'award', title: '荣誉奖项', icon: Award, fields: ['name', 'time'] },
  { type: 'custom', title: '自定义模块', icon: Plus, fields: ['name'] },
  { type: 'summary', title: '个人简介', icon: UserRound, fields: [] },
  { type: 'portfolio', title: '个人作品', icon: LayoutTemplate, fields: ['name', 'url'] },
  { type: 'other', title: '其他经历', icon: Layers3, fields: ['name', 'time'] },
  { type: 'research', title: '研究经历', icon: Microscope, fields: ['name', 'role', 'time'] },
];
function labelFor(field: MarkdownSourceField, context = 'profile'): string {
  const key = field.key.toLowerCase();
  if (key === 'name') return ({ profile: '姓名', education: '学校', experience: '公司', project: '项目名称', skill: '技能名称', award: '奖项名称', portfolio: '作品名称', research: '研究名称', summary: '小标题' } as Record<string, string>)[context] ?? '名称';
  return FIELD_LABELS[key] ?? field.key;
}
function highlightedSource(source: string) {
  const matcher = /@\[[a-zA-Z][\w-]*\](?=\()|^[ \t]*:::[^\r\n]*|\*\*[^*\r\n]+\*\*/gm;
  const pieces = []; let cursor = 0, match: RegExpExecArray | null;
  while ((match = matcher.exec(source))) {
    if (match.index > cursor) pieces.push(source.slice(cursor, match.index));
    if (match[0].startsWith('@[')) pieces.push(<span key={match.index}>@[<span className="md-token-field">{match[0].slice(2, -1)}</span>]</span>);
    else pieces.push(<span key={match.index} className={match[0].trimStart().startsWith(':::') ? 'md-token-directive' : 'md-token-strong'}>{match[0]}</span>);
    cursor = matcher.lastIndex;
  }
  pieces.push(source.slice(cursor)); return pieces;
}

/** Both views edit the original source; cards never regenerate the document. */
export default function MarkdownEditorPane({ document: resume, onUpdate, onChoosePhoto, onScrollRatio, syncScroll, modulesOpen, onCloseModules }: MarkdownEditorPaneProps) {
  const [legacyMode] = useState<'edit' | 'source'>(() => {
    try { return sessionStorage.getItem(`markdown-view:${resume.id}`) === 'source' ? 'source' : 'edit'; }
    catch { return 'edit'; }
  });
  const mode = resume.markdownView ?? legacyMode;
  const [localError, setLocalError] = useState('');
  const source = getMarkdownSource(resume);
  const analysis = useMemo(() => analyzeMarkdownSource(source), [source]);
  const profileFields = analysis.profileFields.filter(isProfileField);
  const projection = getSourceStatus(resume);
  const sourceHighlight = useMemo(() => mode === 'source' ? highlightedSource(source) : null, [source, mode]);
  const [pendingRemoval, setPendingRemoval] = useState<{block: MarkdownSourceRegion; text: string} | null>(null);
  const highlight = useRef<HTMLPreElement>(null);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const pane = useRef<HTMLElement>(null);
  const [jump, setJump] = useState<{ index: number | 'profile' } | null>(null);
  function chooseMode(value: 'edit' | 'source') {
    if (value !== mode) onUpdate(current => ({ ...current, markdownView: value }));
  }

  useEffect(() => {
    if (!jump || modulesOpen) return;
    const index = jump.index;
    if (mode === 'source' && sourceInput.current) {
      const input = sourceInput.current;
      const offset = index === 'profile' ? 0 : analysis.blocks[index]?.start ?? 0;
      input.focus({ preventScroll: true });
      // Textareas expose LF-normalized offsets; the saved source may use CRLF.
      const caret = source.slice(0, offset).replace(/\r\n|\r/g, '\n').length;
      input.setSelectionRange(caret, caret);
      if (offset === 0) input.scrollTop = 0;
      else if (highlight.current) {
        // Measure the highlighted source at the same width to account for wrapped lines.
        const pre = highlight.current;
        const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
        let remaining = offset, node: Node | null;
        while ((node = walker.nextNode())) {
          const length = node.textContent?.length ?? 0;
          if (remaining >= length) { remaining -= length; continue; }
          const range = document.createRange();
          range.setStart(node, remaining);
          range.setEnd(node, Math.min(remaining + 1, length));
          if (typeof range.getBoundingClientRect === 'function') {
            input.scrollTop = pre.scrollTop + range.getBoundingClientRect().top - pre.getBoundingClientRect().top - 16;
          }
          break;
        }
      }
    } else {
      const card = pane.current?.querySelector<HTMLElement>(`[data-md-block="${index}"]`);
      card?.scrollIntoView?.({ block: 'start' });
      card?.focus({ preventScroll: true });
    }
    setJump(null);
  }, [analysis, jump, mode, modulesOpen, source]);

  function jumpTo(index: number | 'profile') {
    setJump({ index });
    onCloseModules?.();
  }

  function addModule(module: typeof MODULES[number]) {
    changeSource(current => appendMarkdownBlock(current, module.type, module.title, module.fields));
    jumpTo(analysis.blocks.length);
  }
  function removeBlock(block: MarkdownSourceRegion, original = source.slice(block.start, block.end)) {
    changeSource(current => {
      const candidate = analyzeMarkdownSource(current).blocks[block.index];
      if (!candidate || current.slice(candidate.start, candidate.end) !== original) throw new Error('模块已更新，请重新选择。');
      return removeMarkdownBlock(current, block.index);
    });
  }
  function requestRemoval(block: MarkdownSourceRegion) {
    const containsContent = block.textParts.some(part => part.text.trim()) ||
      block.fields.some(field => isModuleField(field, block.type) && field.value.trim());
    if (containsContent) setPendingRemoval({block, text:source.slice(block.start, block.end)});
    else removeBlock(block);
  }

  function changeSource(change: (current: string) => string) {
    try {
      onUpdate(current => {
        if (current.id !== resume.id) return current;
        const before = getMarkdownSource(current), next = change(before);
        if (before === next && current.editorMode === 'markdown' && typeof current.markdownSource === 'string') return current;
        return updateMarkdownSource(current, next).document;
      });
      setLocalError('');
    } catch (error) { setLocalError(error instanceof Error ? error.message : '修改未能保存，请保留源码后重试'); }
  }
  function scrollRatio(element: HTMLElement) { if (syncScroll) onScrollRatio?.(element.scrollHeight > element.clientHeight ? element.scrollTop / (element.scrollHeight - element.clientHeight) : 0); }
  function fieldChip(field: MarkdownSourceField, context = 'profile') {
    const label = labelFor(field, context);
    return <label className={`md-info-chip ${field.value.length > 25 ? 'md-info-chip-wide' : ''}`} key={`${field.location.kind}-${field.location.index}-${field.location.fieldIndex}`}>
      <span>{label}：</span><input aria-label={`Markdown ${label}`} value={field.value} placeholder={`填写${label}`} maxLength={2000} size={Math.max(5, Math.min(28, Array.from(field.value).length + 1))} onChange={event => { const value = event.target.value; changeSource(current => replaceMarkdownField(current, field.location, value)); }} />
    </label>;
  }
  function bodyInputs(region: MarkdownSourceRegion) {
    const populated = region.textParts.filter(part => part.text.trim());
    const parts = populated.length ? populated : [region.textParts.at(-1)!];
    return <div className="md-card-bodies">{parts.map(part => <textarea key={part.location.textIndex} className="md-card-body-input" aria-label={region.kind === 'block' ? `${region.title || MODULES.find(module => module.type === region.type)?.title || region.type} Markdown 正文` : 'Markdown 正文'} value={part.text} rows={Math.max(3, part.text.split(/\r\n|\r|\n/).length)} spellCheck={false} placeholder="填写内容" onChange={event => { const value = event.target.value; changeSource(current => replaceMarkdownText(current, part.location, value)); }} />)}</div>;
  }
  function blockCard(region: MarkdownSourceRegion) {
    const module = MODULES.find(entry => entry.type === region.type), Icon = module?.icon ?? FileText, title = region.title || module?.title || region.type;
    const fields = region.fields.filter(field => isModuleField(field, region.type));
    return <section className="md-edit-card" data-md-block={region.index} tabIndex={-1} key={`block-${region.index}`}>
      <header className="md-card-header"><div className="md-card-title"><Icon size={17} /><h3>{title}</h3>{!region.closed && <span className="md-unclosed-label">源码未闭合</span>}</div><div className="md-card-actions">
        <button type="button" aria-label={`上移${title}`} title="上移模块" disabled={region.index === 0} onClick={() => changeSource(current => moveMarkdownBlock(current, region.index, -1))}><ArrowUp size={15} /></button>
        <button type="button" aria-label={`下移${title}`} title="下移模块" disabled={region.index === analysis.blocks.length - 1} onClick={() => changeSource(current => moveMarkdownBlock(current, region.index, 1))}><ArrowDown size={15} /></button>
        <button type="button" aria-label={`删除${title}`} title="删除模块" onClick={() => requestRemoval(region)}><Trash2 size={15} /></button>
      </div></header>
      {!!fields.length && <div className="md-field-chips">{fields.map(field => fieldChip(field, region.type))}</div>}
      {bodyInputs(region)}
    </section>;
  }
  function infoMenu() {
    return <ActionMenu className="md-info-menu"><summary>插入信息项<ChevronDown size={13} /></summary><div className="md-info-options" role="menu">{INFO_FIELDS.map(field => <button key={field.key} type="button" role="menuitem" disabled={analysis.profileFields.some(value => value.key.toLowerCase() === field.key)} onClick={() => changeSource(current => insertMarkdownProfileField(current, field.key))}><Plus size={12} />{field.label}</button>)}</div></ActionMenu>;
  }
  return <section className="markdown-editor-pane" aria-label="Markdown 简历编辑器" ref={pane}>
    <div className="md-editor-tools">
      <div className="md-mode-switch" role="group" aria-label="Markdown 编辑视图"><button type="button" aria-pressed={mode === 'edit'} className={mode === 'edit' ? 'active' : ''} onClick={() => chooseMode('edit')}><FileText size={15} />编辑模式</button><button type="button" aria-pressed={mode === 'source'} className={mode === 'source' ? 'active' : ''} onClick={() => chooseMode('source')}><Code2 size={15} />源码模式</button></div>
      <div className="md-module-buttons" aria-label="插入简历模块">{MODULES.map(module => <button type="button" key={`${module.type}-${module.title}`} onClick={() => addModule(module)}><Plus size={12} /><span>{module.title}</span></button>)}</div>
      <div className="md-source-actions">{mode === 'source' && infoMenu()}<button type="button" className="md-upload-photo" onClick={onChoosePhoto}><ImagePlus size={14} /><span>上传头像</span></button></div>
    </div>
    {(localError || projection.warnings.length > 0) && <div className={`md-editor-warning ${localError || projection.previewStale ? 'md-editor-warning-error' : ''}`} role={localError || projection.previewStale ? 'alert' : 'status'}>{localError || projection.warnings.join(' ')}</div>}
    {mode === 'source' ? <div className="md-source-wrap">
      <pre ref={highlight} className="md-source-highlight" aria-hidden="true">{sourceHighlight}{source.endsWith('\n') || !source ? '\u200b' : ''}</pre>
      <textarea ref={sourceInput} className="md-source-input" aria-label="Markdown 源码" value={source} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" onChange={event => { const value = event.target.value; changeSource(current => matchMarkdownLineEndings(value, current)); }} onScroll={event => { if (highlight.current) { highlight.current.scrollTop = event.currentTarget.scrollTop; highlight.current.scrollLeft = event.currentTarget.scrollLeft; } scrollRatio(event.currentTarget); }} />
    </div> : <div className="md-editor-content" onScroll={event => { if (event.target === event.currentTarget) scrollRatio(event.currentTarget); }}>
      <section className="md-edit-card md-profile-card" data-md-block="profile" tabIndex={-1}><header className="md-card-header"><div className="md-card-title"><UserRound size={17} /><h3>基本信息</h3></div>{infoMenu()}</header>
        {!!profileFields.length && <div className="md-field-chips">{profileFields.map(field => fieldChip(field))}</div>}
      </section>
      {analysis.regions.map(region => region.kind === 'block' ? blockCard(region) : region.textParts.some(part => part.text.trim()) || !analysis.blocks.length ? <section className="md-edit-card md-prose-card" key={`outside-${region.index}`}><header className="md-card-header"><div className="md-card-title"><FileText size={17} /><h3>正文</h3></div></header>{bodyInputs(region)}</section> : null)}
    </div>}
    {modulesOpen && onCloseModules && <Modal title="简历模块" onClose={onCloseModules} className="mobile-modules-modal md-modules-modal">
      <button className="md-drawer-jump" onClick={() => jumpTo('profile')}><UserRound size={17}/>基本信息</button>
      {analysis.blocks.map(block => {
        const definition = MODULES.find(module => module.type === block.type);
        const title = block.title || definition?.title || block.type;
        const Icon = definition?.icon ?? FileText;
        return <div className="md-drawer-row" key={block.index}>
          <button className="md-drawer-jump" onClick={() => jumpTo(block.index)}><Icon size={17}/><span>{title}</span></button>
          <button aria-label={`上移${title}`} disabled={block.index === 0} onClick={() => changeSource(current => moveMarkdownBlock(current, block.index, -1))}><ArrowUp size={16}/></button>
          <button aria-label={`下移${title}`} disabled={block.index === analysis.blocks.length - 1} onClick={() => changeSource(current => moveMarkdownBlock(current, block.index, 1))}><ArrowDown size={16}/></button>
          <button aria-label={`删除${title}`} onClick={() => requestRemoval(block)}><Trash2 size={15}/></button>
        </div>;
      })}
      <details className="md-drawer-add"><summary><Plus size={15}/>添加模块</summary><div className="add-module-grid">
        {MODULES.map(module => <button key={module.type} onClick={() => addModule(module)}><module.icon size={16}/>{module.title}</button>)}
      </div></details>
    </Modal>}
    {pendingRemoval && <Modal title="移除这个模块？" onClose={() => setPendingRemoval(null)}>
      <p>「{pendingRemoval.block.title || MODULES.find(module => module.type === pendingRemoval.block.type)?.title || pendingRemoval.block.type}」及其正文将从简历中移除。</p>
      <div className="modal-actions"><button className="button secondary" onClick={() => setPendingRemoval(null)}>保留模块</button>
        <button className="button danger" onClick={() => { removeBlock(pendingRemoval.block, pendingRemoval.text); setPendingRemoval(null); }}>移除模块</button></div>
    </Modal>}
  </section>;
}
