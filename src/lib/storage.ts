import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase, IDBPTransaction } from 'idb';
import { DEFAULT_LAYOUT } from '../model';
import type { ResumeAsset, ResumeDocument, ResumeItem, ResumeProfileExtraField, ResumeSection, ResumeSnapshot, RichNode, SectionType } from '../model';
import { getTemplate } from '../templates';
import { canonicalCatalogId } from '../markdownTemplates';
import { validateImageBlob } from './images';
import { repairLegacyMarkdownProjection } from './markdown';

const DB_NAME = 'local-resume-studio';
interface ResumeDB extends DBSchema {
  resumes: { key: string; value: ResumeDocument };
  assets: { key: string; value: ResumeAsset };
  snapshots: { key: string; value: ResumeSnapshot; indexes: { 'by-resume': string } };
  settings: { key: string; value: { key: string; value: unknown } };
}
let databasePromise: Promise<IDBPDatabase<ResumeDB>> | undefined;
type StorageChange = { store: 'resumes' | 'assets' | 'settings' | 'all'; key?: string; external: boolean };
const listeners = new Set<(change: StorageChange) => void>();
let channel: BroadcastChannel | undefined;

function emitChange(change: StorageChange): void { for (const listener of listeners) { try { listener(change); } catch { /* Subscribers must not break a successful write. */ } } }
function ensureChannel(): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined' || channel) return;
  try {
    channel = new BroadcastChannel('local-resume-changes');
    channel.onmessage = event => {
      if (event.data?.type !== 'changed') return;
      const { store = 'all', key } = event.data;
      emitChange({ store, key, external: true });
    };
  } catch { /* Cross-tab notification is optional and must never invalidate a stored document. */ }
}
function notifyChange(store: StorageChange['store'], key?: string): void {
  ensureChannel();
  try { channel?.postMessage({ type: 'changed', store, key }); } catch { /* The transaction has already committed. */ }
  queueMicrotask(() => emitChange({ store, key, external: false }));
}
export function subscribeChanges(callback: (change: StorageChange) => void): () => void { ensureChannel(); listeners.add(callback); return () => { listeners.delete(callback); }; }

function getDatabase(): Promise<IDBPDatabase<ResumeDB>> {
  if (!databasePromise) {
    databasePromise = openDB<ResumeDB>(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('resumes', { keyPath: 'id' }); db.createObjectStore('assets', { keyPath: 'id' });
        const snapshots = db.createObjectStore('snapshots', { keyPath: 'id' }); snapshots.createIndex('by-resume', 'resumeId');
        db.createObjectStore('settings', { keyPath: 'key' });
      },
      blocking() { void databasePromise?.then(db => db.close()); databasePromise = undefined; },
      terminated() { databasePromise = undefined; },
    }).catch(error => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
}

export class ConflictError extends Error {
  readonly current: ResumeDocument;
  constructor(current: ResumeDocument) { super('这份简历已在另一个页面中更新，请保留副本或重新载入'); this.name = 'ConflictError'; this.current = current; }
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown, field: string, limit = 2000): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`简历字段“${field}”无效或过长`); return value;
}
function number(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`简历字段“${field}”无效`); return value;
}
function identifier(value: unknown, field: string): string { const id = text(value, field, 200); if (!id.trim() || /[\u0000-\u001f]/.test(id)) throw new Error(`简历字段“${field}”无效`); return id; }

/** Rebuild imported metadata as bounded plain strings, never executable or dynamic properties. */
export function validateProfileExtraFields(value: unknown): ResumeProfileExtraField[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('简历附加信息格式无效或超过 30 项');
  const keys = new Set<string>();
  const plainText = (input: unknown, field: string, limit: number) => {
    const result = text(input, field, limit);
    if (/[\u0000-\u001f\u007f]/.test(result)) throw new Error(`简历字段“${field}”无效`);
    return result;
  };
  return value.map(input => {
    if (!record(input)) throw new Error('简历附加信息格式无效');
    const key = plainText(input.key, '附加信息标识', 200), label = plainText(input.label, '附加信息名称', 200);
    if (!key.trim() || !label.trim() || keys.has(key)) throw new Error('简历附加信息标识或名称无效，或标识重复');
    keys.add(key);
    return { key, label, value: plainText(input.value, '附加信息内容', 2000) };
  });
}

/** Keep only explicit safe links. This function never performs network requests. */
export function safeLink(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000) return '';
  const link = value.trim(); if (/[\u0000-\u0020\u007f]/.test(link)) return '';
  return /^(https?:\/\/|mailto:|tel:)/i.test(link) ? link : '';
}
/** Plain input fields must retain unfinished URLs; renderers decide whether to make them clickable. */
export function sanitizeLinkText(value: string): string {
  const result = value.replace(/[\u0000-\u001f\u007f]/g, '');
  return /^\s*(?:javascript|vbscript|data|file|blob):/i.test(result) ? '' : result;
}
const nodeTypes = new Set(['doc', 'paragraph', 'text', 'bulletList', 'orderedList', 'listItem', 'hardBreak', 'heading', 'blockquote', 'horizontalRule', 'codeBlock']);
const plainMarks = new Set(['bold', 'italic', 'strike', 'underline', 'code']);
export function sanitizeRichText(value: unknown): RichNode {
  let count = 0;
  function visit(input: unknown, depth: number): RichNode | undefined {
    if (++count > 12000 || depth > 20) throw new Error('富文本内容过大或嵌套过深');
    if (!record(input) || typeof input.type !== 'string' || !nodeTypes.has(input.type)) return undefined;
    const node: RichNode = { type: input.type };
    if (input.type === 'text') node.text = text(input.text, '正文', 200000);
    if (Array.isArray(input.content)) {
      if (input.content.length > 10000) throw new Error('富文本内容过大');
      node.content = input.content.map(child => visit(child, depth + 1)).filter((child): child is RichNode => Boolean(child));
    }
    if (record(input.attrs)) {
      const attrs: Record<string, unknown> = {};
      if (['paragraph', 'heading'].includes(input.type) && ['left', 'center', 'right', 'justify'].includes(String(input.attrs.textAlign))) attrs.textAlign = input.attrs.textAlign;
      if (['paragraph', 'heading'].includes(input.type) && Number.isInteger(input.attrs.indent) && Number(input.attrs.indent) >= 0 && Number(input.attrs.indent) <= 5) attrs.indent = input.attrs.indent;
      if (input.type === 'heading') attrs.level = [1, 2, 3, 4, 5, 6].includes(Number(input.attrs.level)) ? Number(input.attrs.level) : 3;
      if (input.type === 'orderedList' && Number.isInteger(input.attrs.start) && Number(input.attrs.start) > 0 && Number(input.attrs.start) < 10000) attrs.start = input.attrs.start;
      if (Object.keys(attrs).length) node.attrs = attrs;
    }
    if (Array.isArray(input.marks)) {
      node.marks = input.marks.flatMap(mark => {
        if (!record(mark) || typeof mark.type !== 'string') return [];
        if (plainMarks.has(mark.type)) return [{ type: mark.type }];
        if (mark.type === 'link' && record(mark.attrs)) { const href = safeLink(mark.attrs.href); return href ? [{ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer' } }] : []; }
        if (mark.type === 'textStyle' && record(mark.attrs)) {
          const attrs: Record<string, unknown> = {};
          if (typeof mark.attrs.color === 'string' && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(mark.attrs.color)) attrs.color = mark.attrs.color;
          if (typeof mark.attrs.fontSize === 'string') {
            const size = mark.attrs.fontSize.match(/^(\d{1,2}(?:\.\d{1,2})?)(pt|px)$/);
            if (size && Number(size[1]) >= 5 && Number(size[1]) <= 40) attrs.fontSize = mark.attrs.fontSize;
          }
          return Object.keys(attrs).length ? [{ type: 'textStyle', attrs }] : [];
        }
        return [];
      });
    }
    return node;
  }
  const result = visit(value, 0); return result?.type === 'doc' ? result : { type: 'doc', content: result ? [result] : [{ type: 'paragraph' }] };
}

/** Validate and rebuild all objects from known fields before storage or import. */
export function validateResumeDocument(value: unknown, warnings: string[] = []): ResumeDocument {
  if (!record(value) || value.schemaVersion !== 1) throw new Error('不支持的简历数据版本');
  if (!record(value.profile) || !record(value.layout) || !Array.isArray(value.sections) || value.sections.length > 80) throw new Error('简历数据缺少有效的基本信息、布局或模块');
  const p = value.profile;
  const profile = {
    name: text(p.name, '姓名'), title: text(p.title, '求职意向'), email: text(p.email, '邮箱'), phone: text(p.phone, '电话'), city: text(p.city, '城市'),
    website: sanitizeLinkText(text(p.website, '网站')), github: sanitizeLinkText(text(p.github, 'GitHub')), status: text(p.status, '状态'),
    ...(p.photoId === undefined ? {} : { photoId: identifier(p.photoId, '照片') }),
    ...(p.extraFields === undefined ? {} : { extraFields: validateProfileExtraFields(p.extraFields) }),
  };
  const allIds = new Set<string>();
  function uniqueId(input: unknown, field: string): string { const id = identifier(input, field); if (allIds.has(id)) throw new Error('简历模块或条目 ID 重复'); allIds.add(id); return id; }
  let totalItems = 0;
  const sectionTypes = new Set<SectionType>(['education', 'experience', 'project', 'skill', 'award', 'research', 'portfolio', 'summary', 'custom']);
  const sections: ResumeSection[] = value.sections.map(input => {
    if (!record(input) || !sectionTypes.has(input.type as SectionType) || typeof input.visible !== 'boolean' || typeof input.pageBreakBefore !== 'boolean' || !Array.isArray(input.items) || (totalItems += input.items.length) > 1000) throw new Error('简历模块或条目格式无效');
    const items: ResumeItem[] = input.items.map(item => {
      if (!record(item)) throw new Error('简历条目格式无效');
      return { id: uniqueId(item.id, '条目 ID'), title: text(item.title, '条目标题'), subtitle: text(item.subtitle, '副标题'), location: text(item.location, '地点'), startDate: text(item.startDate, '开始日期', 100), endDate: text(item.endDate, '结束日期', 100), ...(item.dateSeparator === undefined ? {} : { dateSeparator: text(item.dateSeparator, '日期分隔符', 100) }), url: sanitizeLinkText(text(item.url, '条目链接')), description: sanitizeRichText(item.description) };
    });
    return { id: uniqueId(input.id, '模块 ID'), type: input.type as SectionType, title: text(input.title, '模块标题'), visible: input.visible, pageBreakBefore: input.pageBreakBefore, items };
  });
  const l = value.layout;
  const optionalLayout: Partial<ResumeDocument['layout']> = {};
  for (const [key, label] of [['marginLeft', '左边距'], ['marginRight', '右边距'], ['contentIndent', '内容缩进'], ['titleTopGap', '标题上间距']] as const) {
    if (l[key] !== undefined) optionalLayout[key] = number(l[key], label, 0, 72);
  }
  if (typeof l.showPhoto !== 'boolean' || !['square', 'round'].includes(String(l.photoShape)) || !['left', 'center', 'right'].includes(String(l.headerAlign)) || typeof l.accent !== 'string' || !/^#[\da-f]{6}$/i.test(l.accent)) throw new Error('简历布局格式无效');
  const rawTemplateId = text(value.templateId, '模板'), templateId = getTemplate(rawTemplateId).id;
  if (canonicalCatalogId(rawTemplateId) !== templateId) warnings.push(`模板“${rawTemplateId}”暂不可用，已使用默认模板`);
  const doc: ResumeDocument = {
    id: identifier(value.id, '简历 ID'), schemaVersion: 1, title: text(value.title, '简历名称'), createdAt: number(value.createdAt, '创建时间', 0, 8640000000000000), updatedAt: number(value.updatedAt, '更新时间', 0, 8640000000000000), revision: number(value.revision, '修订版本', 0, Number.MAX_SAFE_INTEGER), templateId, profile, sections,
    layout: { ...DEFAULT_LAYOUT, ...optionalLayout, fontSize: number(l.fontSize, '字号', 5, 40), lineHeight: number(l.lineHeight, '行高', 0.5, 4), marginTop: number(l.marginTop, '上下边距', 0, 180), marginHorizontal: number(l.marginHorizontal, '左右边距', 0, 180), sectionGap: number(l.sectionGap, '模块间距', 0, 100), titleGap: number(l.titleGap, '标题间距', 0, 100), accent: l.accent, headerAlign: l.headerAlign as 'left' | 'center' | 'right', photoShape: l.photoShape as 'square' | 'round', showPhoto: l.showPhoto },
  };
  if (!Number.isInteger(doc.revision)) throw new Error('修订版本必须是整数');
  if (value.editorMode !== undefined) {
    if (value.editorMode !== 'visual' && value.editorMode !== 'markdown') throw new Error('简历编辑模式无效');
    doc.editorMode = value.editorMode;
  }
  if (value.markdownView !== undefined) {
    if (value.markdownView !== 'edit' && value.markdownView !== 'source') throw new Error('Markdown 编辑视图无效');
    doc.markdownView = value.markdownView;
  }
  if (value.presentationMode !== undefined) {
    if (value.presentationMode !== 'visual' && value.presentationMode !== 'markdown') throw new Error('简历排版模式无效');
    doc.presentationMode = value.presentationMode;
  }
  if (value.markdownSource !== undefined) {
    doc.markdownSource = text(value.markdownSource, 'Markdown 源码', 2_000_000);
    // Tolerate additive source fields from a version-1 backup without a mode field.
    doc.editorMode ??= 'markdown';
  }
  if (value.markdownExportTemplate === true) doc.markdownExportTemplate = true;
  if (value.deletedAt !== undefined) doc.deletedAt = number(value.deletedAt, '删除时间', 0, 8640000000000000);
  return doc;
}

export async function loadResumes(includeDeleted = false): Promise<ResumeDocument[]> {
  const documents = await (await getDatabase()).getAll('resumes');
  return documents.filter(doc => includeDeleted || !doc.deletedAt).map(readStoredResume).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function getResume(id: string): Promise<ResumeDocument | undefined> {
  const document = await (await getDatabase()).get('resumes', id);
  return document && readStoredResume(document);
}

function readStoredResume(document: ResumeDocument): ResumeDocument {
  const templateId = canonicalCatalogId(document.templateId);
  return repairLegacyMarkdownProjection(templateId === document.templateId ? document : { ...document, templateId });
}

type WriteTransaction = IDBPTransaction<ResumeDB, ['resumes', 'snapshots'], 'readwrite'>;
async function commitDocument(tx: WriteTransaction, input: ResumeDocument, current?: ResumeDocument): Promise<ResumeDocument> {
  if (current) {
    if (input.revision !== current.revision) throw new ConflictError(current);
    const snapshots = tx.objectStore('snapshots');
    // IndexedDB orders equal index entries by primary key. The revision prefix
    // lets us prune large resumes by key, without loading their previous bodies.
    const id = 'r' + String(current.revision).padStart(16, '0') + ':' + current.id;
    await snapshots.put({ id, resumeId: current.id, createdAt: Date.now(), document: current });
    const index = snapshots.index('by-resume');
    const keys = await index.getAllKeys(current.id);
    if (keys.length > 20) {
      if (keys.every(key => /^r\d{16}:/.test(key))) {
        for (const key of keys.slice(0, -20)) await snapshots.delete(key);
      } else {
        // Older installations used random UUIDs. Preserve revision order until
        // those history entries have naturally rotated out.
        const history = await index.getAll(current.id);
        history.sort((a, b) => b.document.revision - a.document.revision || b.createdAt - a.createdAt);
        for (const old of history.slice(20)) await snapshots.delete(old.id);
      }
    }
  } else if (input.revision !== 0) throw new Error('这份简历已不存在，请将内容保存为新的副本');
  const saved: ResumeDocument = { ...input, createdAt: current?.createdAt ?? input.createdAt, updatedAt: Date.now(), revision: (current?.revision ?? 0) + 1 };
  await tx.objectStore('resumes').put(saved); return saved;
}

export async function saveResume(document: ResumeDocument): Promise<ResumeDocument> {
  const input = validateResumeDocument(document), db = await getDatabase();
  const tx = db.transaction(['resumes', 'snapshots'], 'readwrite');
  try {
    const current = await tx.objectStore('resumes').get(input.id);
    if (current && input.revision === 0) throw new ConflictError(current);
    const saved = await commitDocument(tx, input, current);
    await tx.done; notifyChange('resumes', saved.id); return saved;
  } catch (error) { try { tx.abort(); } catch { /* Already aborted/complete. */ } await tx.done.catch(() => undefined); throw error; }
}

async function setDeleted(id: string, deleted: boolean, expectedRevision?: number): Promise<ResumeDocument> {
  const db = await getDatabase(), tx = db.transaction(['resumes', 'snapshots'], 'readwrite');
  try {
    const current = await tx.objectStore('resumes').get(id);
    if (!current) throw new Error('找不到这份简历');
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new ConflictError(current);
    const input = { ...current }; if (deleted) input.deletedAt = Date.now(); else delete input.deletedAt;
    const saved = await commitDocument(tx, input, current);
    await tx.done; notifyChange('resumes', saved.id); return saved;
  } catch (error) { try { tx.abort(); } catch { /* Already aborted/complete. */ } await tx.done.catch(() => undefined); throw error; }
}
export function deleteResume(id: string, expectedRevision?: number): Promise<ResumeDocument> { return setDeleted(id, true, expectedRevision); }
export function restoreResume(id: string, expectedRevision?: number): Promise<ResumeDocument> { return setDeleted(id, false, expectedRevision); }
export async function getSnapshots(resumeId: string): Promise<ResumeSnapshot[]> {
  const snapshots = await (await getDatabase()).getAllFromIndex('snapshots', 'by-resume', resumeId);
  return snapshots.sort((a, b) => b.document.revision - a.document.revision || b.createdAt - a.createdAt);
}
export async function restoreSnapshot(resumeId: string, snapshotId: string, expectedRevision?: number): Promise<ResumeDocument> {
  const db = await getDatabase(), tx = db.transaction(['resumes', 'snapshots'], 'readwrite');
  try {
    const current = await tx.objectStore('resumes').get(resumeId), snapshot = await tx.objectStore('snapshots').get(snapshotId);
    if (!current || !snapshot || snapshot.resumeId !== resumeId) throw new Error('找不到这份历史版本');
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new ConflictError(current);
    const input = { ...readStoredResume(snapshot.document), id: current.id, createdAt: current.createdAt, revision: current.revision };
    if (current.deletedAt) input.deletedAt = current.deletedAt; else delete input.deletedAt;
    const saved = await commitDocument(tx, input, current);
    await tx.done; notifyChange('resumes', saved.id); return saved;
  } catch (error) { try { tx.abort(); } catch { /* Already aborted/complete. */ } await tx.done.catch(() => undefined); throw error; }
}

export function getSetting<T>(key: string, fallback: T): Promise<T>;
export function getSetting<T>(key: string): Promise<T | undefined>;
export async function getSetting<T>(key: string, fallback?: T): Promise<T | undefined> { const entry = await (await getDatabase()).get('settings', key); return entry ? entry.value as T : fallback; }
export async function setSetting(key: string, value: unknown): Promise<void> { await (await getDatabase()).put('settings', { key, value }); notifyChange('settings', key); }
export async function toggleTemplateFavorite(templateId: string): Promise<string[]> {
  const tx = (await getDatabase()).transaction('settings', 'readwrite');
  const entry = await tx.store.get('favorites');
  const ids = new Set(Array.isArray(entry?.value) ? entry.value.filter((id): id is string => typeof id === 'string').map(canonicalCatalogId) : []);
  const id = canonicalCatalogId(templateId);
  if (ids.has(id)) ids.delete(id); else ids.add(id);
  const value = [...ids];
  await tx.store.put({ key: 'favorites', value });
  await tx.done;
  notifyChange('settings', 'favorites');
  return value;
}
export async function putAsset(asset: ResumeAsset): Promise<ResumeAsset> {
  identifier(asset.id, '照片 ID'); text(asset.name, '照片名称'); const type = await validateImageBlob(asset.blob);
  const normalized = { id: asset.id, name: asset.name, createdAt: asset.createdAt, blob: asset.blob.type === type ? asset.blob : new Blob([asset.blob], { type }) };
  await (await getDatabase()).put('assets', normalized); notifyChange('assets', asset.id); return normalized;
}
export async function getAsset(id: string): Promise<ResumeAsset | undefined> { return (await getDatabase()).get('assets', id); }

/** Commit an already validated backup in one transaction; document collisions become copies. */
export async function importDocuments(documents: ResumeDocument[], assets: ResumeAsset[]): Promise<ResumeDocument[]> {
  const db = await getDatabase(), tx = db.transaction(['resumes', 'assets'], 'readwrite');
  try {
    const imported: ResumeDocument[] = [];
    for (const asset of assets) await tx.objectStore('assets').put(asset);
    for (const document of documents) {
      const input = { ...document, revision: 1, updatedAt: Date.now() };
      if (await tx.objectStore('resumes').get(input.id)) { input.id = crypto.randomUUID(); input.title = `${input.title.slice(0, 1980)}（导入副本）`; }
      await tx.objectStore('resumes').add(input); imported.push(input);
    }
    await tx.done; notifyChange('resumes'); return imported;
  } catch (error) { try { tx.abort(); } catch { /* Already aborted/complete. */ } await tx.done.catch(() => undefined); throw error; }
}
