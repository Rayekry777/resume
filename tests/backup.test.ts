import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResume } from '../src/sample';
import { exportBackup, importBackup } from '../src/lib/backup';
import { exportMarkdown, getEditorMode, parseMarkdown, updateMarkdownSource } from '../src/lib/markdown';
import { getAsset, getResume, loadResumes, putAsset, saveResume } from '../src/lib/storage';
import type { BackupPackage } from '../src/model';
import { MARKDOWN_TEMPLATES, canonicalCatalogId } from '../src/markdownTemplates';
import { applyResumeTemplate, templateLayout } from '../src/templates';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64'));
async function clearDatabase() {
  await loadResumes(true); const db = await openDB('local-resume-studio', 1);
  const tx = db.transaction(['resumes', 'snapshots', 'assets', 'settings'], 'readwrite');
  await Promise.all(Array.from(tx.objectStoreNames).map(name => tx.objectStore(name).clear())); await tx.done; db.close();
}
function makeZip(manifest: unknown, files: Record<string, Uint8Array> = {}): Blob { return new Blob([new Uint8Array(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), ...files }))], { type: 'application/zip' }); }
beforeEach(clearDatabase); afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('editable ZIP backup', () => {
  it('restores referenced photo bytes and creates copies on document ID collisions', async () => {
    const asset = await putAsset({ id: crypto.randomUUID(), name: '我的照片.png', createdAt: Date.now(), blob: new Blob([png], { type: 'image/png' }) });
    const input = createResume(); input.profile.photoId = asset.id;
    input.layout = { ...input.layout, marginLeft: 12, marginRight: 42, contentIndent: 18, titleTopGap: 0 };
    const original = await saveResume(input), backup = await exportBackup();
    const fetch = vi.fn(() => { throw new Error('不应联网'); }); vi.stubGlobal('fetch', fetch);
    const imported = await importBackup(backup);
    expect(imported.warnings).toEqual([]); expect(imported.documents).toHaveLength(1);
    const copy = imported.documents[0]; expect(copy.id).not.toBe(original.id); expect(copy.title).toContain('导入副本'); expect(copy.profile.photoId).not.toBe(asset.id);
    expect(copy.layout).toEqual(original.layout);
    const restoredPhoto = await getAsset(copy.profile.photoId!);
    expect(restoredPhoto?.blob.type).toBe('image/png'); expect(new Uint8Array(await restoredPhoto!.blob.arrayBuffer())).toEqual(png);
    expect(await loadResumes()).toHaveLength(2); expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an unsupported version before any partial import', async () => {
    const manifest = { format: 'local-resume', version: 2, createdAt: Date.now(), documents: [createResume()], assets: [] };
    await expect(importBackup(makeZip(manifest))).rejects.toThrow('版本'); expect(await loadResumes(true)).toEqual([]);
  });

  it('validates every document before importing the first one', async () => {
    const valid = createResume(), invalid = { ...createResume(), sections: '坏数据' };
    await expect(importBackup(makeZip({ format: 'local-resume', version: 1, createdAt: Date.now(), documents: [valid, invalid], assets: [] }))).rejects.toThrow();
    expect(await loadResumes(true)).toEqual([]);
  });

  it('does not follow ZIP paths or remote photo URLs', async () => {
    const manifest: BackupPackage = { format: 'local-resume', version: 1, createdAt: Date.now(), documents: [createResume()], assets: [{ id: 'remote', name: '远程.png', type: 'image/png', path: 'https://example.com/photo.png' }] };
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(importBackup(makeZip(manifest))).rejects.toThrow('路径');
    await expect(importBackup(makeZip({ ...manifest, assets: [] }, { '../outside.png': png }))).rejects.toThrow('路径');
    expect(fetch).not.toHaveBeenCalled(); expect(await loadResumes()).toEqual([]);
  });

  it('strips unsupported rich nodes, unsafe links and unknown object properties', async () => {
    const document = createResume(); document.templateId = 'missing-template'; document.profile.website = 'javascript:alert(1)';
    document.sections[0].items[0].description = { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/track.png' } }, { type: 'paragraph', content: [{ type: 'text', text: '保留文本', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] };
    const raw = JSON.parse(JSON.stringify(document));
    Object.defineProperty(raw.profile, '__proto__', { value: { contaminated: true }, enumerable: true });
    raw.profile.constructor = { prototype: { contaminated: true } };
    const result = await importBackup(makeZip({ format: 'local-resume', version: 1, createdAt: Date.now(), documents: [raw], assets: [] }));
    expect(result.documents[0].templateId).toBe('neat'); expect(result.warnings).toHaveLength(1); expect(result.documents[0].profile.website).toBe('');
    const body = JSON.stringify(result.documents[0].sections[0].items[0].description);
    expect(body).toContain('保留文本'); expect(body).not.toContain('javascript:'); expect(body).not.toContain('track.png');
    expect(Object.hasOwn(result.documents[0].profile, '__proto__')).toBe(false);
    expect(Object.hasOwn(result.documents[0].profile, 'constructor')).toBe(false);
    expect(Object.hasOwn(Object.prototype, 'contaminated')).toBe(false);
  });

  it('rejects disguised SVG assets even when declared as PNG', async () => {
    const document = createResume(); document.profile.photoId = 'photo';
    const manifest: BackupPackage = { format: 'local-resume', version: 1, createdAt: Date.now(), documents: [document], assets: [{ id: 'photo', name: 'photo.png', type: 'image/png', path: 'assets/0.bin' }] };
    await expect(importBackup(makeZip(manifest, { 'assets/0.bin': strToU8('<svg onload="alert(1)"></svg>') }))).rejects.toThrow('照片格式');
    expect(await loadResumes()).toEqual([]);
  });

  it('rolls back all imported documents and photos if a storage write fails midway', async () => {
    const first = createResume(), second = createResume(); first.profile.photoId = 'photo';
    const manifest: BackupPackage = { format: 'local-resume', version: 1, createdAt: Date.now(), documents: [first, second], assets: [{ id: 'photo', name: 'photo.png', type: 'image/png', path: 'assets/0.bin' }] };
    let writes = 0; const originalAdd = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'resumes' && ++writes === 2) throw new DOMException('模拟本机空间不足', 'QuotaExceededError');
      return originalAdd.apply(this, args);
    });
    await expect(importBackup(makeZip(manifest, { 'assets/0.bin': png }))).rejects.toThrow('空间不足');
    expect(await loadResumes(true)).toEqual([]);
    const db = await openDB('local-resume-studio', 1); expect(await db.getAll('assets')).toEqual([]); db.close();
  });

  it('preserves exact Markdown source and editor mode through ZIP restore with remapped photos', async () => {
    const source = '\uFEFF@[name](MD 姓名)\r\n\r\n:::project\r\n@[name](原始项目)\r\n\r\n- **保留空行和格式**  \r\n:::\r\n';
    const photo = await putAsset({ id: crypto.randomUUID(), name: 'photo.png', createdAt: Date.now(), blob: new Blob([png], { type: 'image/png' }) });
    const parsed = parseMarkdown(source).document; parsed.profile.photoId = photo.id; parsed.templateId = 'mono'; parsed.layout.accent = '#123456';
    const original = await saveResume(parsed), blob = await exportBackup([original]);
    const { documents } = await importBackup(blob), restored = documents[0];
    expect(restored.id).not.toBe(original.id); expect(restored.editorMode).toBe('markdown'); expect(restored.markdownSource).toBe(source); expect(exportMarkdown(restored)).toBe(source);
    expect(restored.profile.photoId).not.toBe(photo.id); expect(restored.templateId).toBe('mono'); expect(restored.layout).toEqual(original.layout);
    expect(new Uint8Array(await (await getAsset(restored.profile.photoId!))!.blob.arrayBuffer())).toEqual(png);
    const updated = updateMarkdownSource(restored, source.replace('原始项目', '更新后的项目')).document;
    expect(updated.id).toBe(restored.id); expect(updated.profile.photoId).toBe(restored.profile.photoId); expect(updated.layout).toEqual(restored.layout); expect(updated.templateId).toBe(restored.templateId);
    expect(updated.sections[0].items[0].title).toBe('更新后的项目');
  });

  it('restores old version-1 backups without source fields as visual documents', async () => {
    const legacy = createResume();
    const restored = await importBackup(makeZip({ format: 'local-resume', version: 1, createdAt: Date.now(), documents: [legacy], assets: [] }));
    expect(getEditorMode(restored.documents[0])).toBe('visual'); expect(restored.documents[0].markdownSource).toBeUndefined();
    expect(restored.documents[0].sections).toEqual(legacy.sections);
  });

  it('preserves every native Markdown design on import, local save and editable ZIP restore', async () => {
    const photo = await putAsset({ id: crypto.randomUUID(), name: '头像.png', createdAt: Date.now(), blob: new Blob([png], { type: 'image/png' }) });
    const originals = [];
    for (const template of MARKDOWN_TEMPLATES) {
      const source = `\uFEFF@[name](示例)\r\n@[template](${template.id})\r\n\r\n## 教育经历\r\n学位 BSc  \r\n`;
      const { document } = parseMarkdown(source);
      expect(document.templateId).toBe(canonicalCatalogId(template.id));
      expect(document.layout).toEqual(templateLayout(template.id, 'markdown'));
      document.profile.photoId = photo.id;
      originals.push(await saveResume(document));
    }
    expect(originals).toHaveLength(17);
    const restored = await importBackup(await exportBackup(originals));
    expect(restored.warnings).toEqual([]);
    expect(restored.documents.map(doc => doc.templateId)).toEqual(originals.map(doc => doc.templateId));
    for (const [index, doc] of restored.documents.entries()) {
      expect(doc.layout).toEqual(originals[index].layout);
      expect(doc.markdownSource).toBe(originals[index].markdownSource);
      expect(doc.editorMode).toBe('markdown');
      expect(doc.profile.photoId).toBeDefined();
      expect(doc.profile.photoId).not.toBe(photo.id);
    }
  });

  it('opens old design aliases and keeps an explicit design choice across an editable backup', async () => {
    const source = '\uFEFF@[template](md-graduate-steady)\r\n@[name](原稿)\r\n';
    const { document } = parseMarkdown(source);
    const legacy = { ...document, templateId: 'md-graduate-steady', revision: 1, layout: { ...document.layout, marginLeft: 42 } };
    const db = await openDB('local-resume-studio', 1);
    await db.put('resumes', legacy);
    db.close();
    const loaded = (await getResume(legacy.id))!;
    expect(loaded.templateId).toBe('steady');
    expect(loaded.layout.marginLeft).toBe(42);
    expect(exportMarkdown(loaded)).toBe(source);
    const fromZip = await importBackup(makeZip({ format: 'local-resume', version: 1,
      createdAt: Date.now(), documents: [legacy], assets: [] }));
    expect(fromZip.warnings).toEqual([]);
    expect(fromZip.documents[0].templateId).toBe('steady');
    const switched = await saveResume(applyResumeTemplate(loaded, 'md-graduate-business'));
    const restored = (await importBackup(await exportBackup([switched]))).documents[0];
    expect(restored.markdownSource).toBe(source);
    expect(exportMarkdown(restored)).toBe(source.replace('md-graduate-steady', 'md-graduate-business'));
  });
});
