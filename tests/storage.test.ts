import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createResume } from '../src/sample';
import { getEditorMode, getMarkdownSource, parseMarkdown, updateMarkdownSource } from '../src/lib/markdown';
import { ConflictError, deleteResume, getResume, getSetting, getSnapshots, loadResumes, restoreResume, restoreSnapshot, saveResume, setSetting, subscribeChanges, toggleTemplateFavorite } from '../src/lib/storage';

async function clearDatabase() {
  await loadResumes(true);
  const db = await openDB('local-resume-studio', 1);
  const tx = db.transaction(['resumes', 'snapshots', 'assets', 'settings'], 'readwrite');
  await Promise.all(tx.objectStoreNames ? Array.from(tx.objectStoreNames).map(name => tx.objectStore(name).clear()) : []);
  await tx.done; db.close();
}
beforeEach(clearDatabase);

describe('transactional resume storage', () => {
  it('allows one concurrent writer and returns the current document to the stale writer', async () => {
    const original = createResume();
    const saved = await saveResume(original);
    expect(saved.revision).toBe(1); expect(original.revision).toBe(0);
    const results = await Promise.allSettled([saveResume({ ...saved, title: '修改 A' }), saveResume({ ...saved, title: '修改 B' })]);
    const success = results.find(result => result.status === 'fulfilled');
    const rejected = results.find(result => result.status === 'rejected');
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(success?.status).toBe('fulfilled'); expect(rejected?.status).toBe('rejected');
    if (success?.status !== 'fulfilled' || rejected?.status !== 'rejected') throw new Error('并发测试未返回预期结果');
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    expect(rejected.reason.current).toEqual(success.value);
    expect(await getResume(saved.id)).toEqual(success.value);
    expect(await getSnapshots(saved.id)).toHaveLength(1);
  });

  it('soft deletes and restores without losing content, and rejects stale destructive actions', async () => {
    const saved = await saveResume(createResume());
    const deleted = await deleteResume(saved.id, saved.revision);
    expect(deleted.deletedAt).toBeGreaterThan(0); expect(await loadResumes()).toHaveLength(0); expect(await loadResumes(true)).toHaveLength(1);
    await expect(restoreResume(saved.id, saved.revision)).rejects.toBeInstanceOf(ConflictError);
    const restored = await restoreResume(saved.id, deleted.revision);
    expect(restored.deletedAt).toBeUndefined(); expect(restored.sections).toEqual(saved.sections); expect(restored.revision).toBe(3);
    expect(await loadResumes()).toHaveLength(1);
  });

  it('retains twenty previous versions and restores as a new revision', async () => {
    let document = await saveResume(createResume());
    for (let index = 0; index < 25; index++) document = await saveResume({ ...document, title: `版本 ${index}` });
    const snapshots = await getSnapshots(document.id);
    expect(snapshots).toHaveLength(20); expect(snapshots[0].document.revision).toBe(25); expect(snapshots[19].document.revision).toBe(6);
    const restored = await restoreSnapshot(document.id, snapshots[19].id, document.revision);
    expect(restored.title).toBe(snapshots[19].document.title); expect(restored.revision).toBe(27);
    expect((await getSnapshots(document.id))[0].document).toEqual(document);
    expect(await getSnapshots(document.id)).toHaveLength(20);
  });

  it('prunes history by key and preserves revision order for existing randomly keyed snapshots', async () => {
    let document = await saveResume(createResume());
    const fullReads = vi.spyOn(IDBIndex.prototype, 'getAll');
    try {
      for (let index = 0; index < 22; index++) document = await saveResume({ ...document, title: `快照 ${index}` });
      expect(fullReads).not.toHaveBeenCalled();
    } finally { fullReads.mockRestore(); }
    const db = await openDB('local-resume-studio', 1);
    const tx = db.transaction('snapshots', 'readwrite');
    for (const snapshot of await tx.store.getAll()) {
      await tx.store.delete(snapshot.id);
      await tx.store.add({ ...snapshot, id: crypto.randomUUID() });
    }
    await tx.done;db.close();
    await saveResume({ ...document, title: '新版本' });
    const retained = await getSnapshots(document.id);
    expect(retained.map(item => item.document.revision)).toEqual(Array.from({ length: 20 }, (_, i) => document.revision - i));
  });

  it('merges simultaneous favorite changes and canonically toggles equivalent templates', async () => {
    await setSetting('favorites', ['md-generous']);
    await Promise.all([toggleTemplateFavorite('neat'),toggleTemplateFavorite('steady')]);
    expect(await getSetting('favorites', [])).toEqual(['elegant','neat','steady']);
    await toggleTemplateFavorite('elegant');
    expect(await getSetting('favorites', [])).toEqual(['neat','steady']);
  });

  it('does not overwrite a document when revision zero is reused', async () => {
    const original = createResume(); const saved = await saveResume(original);
    await expect(saveResume({ ...original, title: '同 ID 的另一份' })).rejects.toBeInstanceOf(ConflictError);
    expect(await getResume(saved.id)).toEqual(saved); expect(await getSnapshots(saved.id)).toHaveLength(0);
  });

  it('stores settings and reports changes only while subscribed', async () => {
    expect(await getSetting('favorites', ['neat'])).toEqual(['neat']);
    let changes = 0; const unsubscribe = subscribeChanges(() => { changes++; });
    await setSetting('favorites', ['mono']); await Promise.resolve();
    expect(await getSetting('favorites', [])).toEqual(['mono']); expect(changes).toBe(1);
    unsubscribe(); await setSetting('lastBackupAt', 123); await Promise.resolve(); expect(changes).toBe(1);
  });

  it('retains the editor’s bounded indentation and inline font sizes after autosave', async () => {
    const document = createResume();
    document.sections[0].items[0].description = { type: 'doc', content: [{ type: 'paragraph', attrs: { indent: 3, textAlign: 'right', backgroundImage: 'url(https://example.com/track)' }, content: [{ type: 'text', text: '保留排版', marks: [{ type: 'textStyle', attrs: { fontSize: '14pt', color: '#5064ee', background: 'url(https://example.com/track)' } }] }] }, { type: 'paragraph', attrs: { indent: 9999 }, content: [{ type: 'text', text: '不执行任意样式', marks: [{ type: 'textStyle', attrs: { fontSize: 'url(https://example.com/font)' } }] }] }] };
    const saved = await saveResume(document), content = saved.sections[0].items[0].description.content!;
    expect(content[0].attrs).toEqual({ indent: 3, textAlign: 'right' });
    expect(content[0].content![0].marks).toEqual([{ type: 'textStyle', attrs: { fontSize: '14pt', color: '#5064ee' } }]);
    expect(content[1].attrs).toBeUndefined(); expect(content[1].content![0].marks).toEqual([]);
    expect(JSON.stringify((await getResume(saved.id))!.sections[0].items[0].description)).not.toContain('example.com');
  });

  it('keeps incomplete and bare URL input while strict rich-text links remain filtered', async () => {
    const document = createResume(); document.profile.website = 'htt'; document.profile.github = 'github.com/example'; document.sections[0].items[0].url = 'http:/';
    document.sections[0].items[0].description = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '网址草稿', marks: [{ type: 'link', attrs: { href: 'htt' } }] }] }] };
    let saved = await saveResume(document);
    expect(saved.profile.website).toBe('htt'); expect(saved.profile.github).toBe('github.com/example'); expect(saved.sections[0].items[0].url).toBe('http:/');
    expect(saved.sections[0].items[0].description.content![0].content![0].marks).toEqual([]);
    saved = await saveResume({ ...saved, profile: { ...saved.profile, website: 'https:' } }); expect(saved.profile.website).toBe('https:');
    saved = await saveResume({ ...saved, profile: { ...saved.profile, website: 'java\nscript:alert(1)' } }); expect(saved.profile.website).toBe('');
  });

  it('reopens exact Markdown source and restores it together with content from history', async () => {
    const originalSource = '@[name](示例)\r\n\r\n:::skill\r\n- **Java**  \r\n:::\r\n';
    const first = await saveResume(parseMarkdown(originalSource).document);
    const reopened = await getResume(first.id); expect(reopened?.editorMode).toBe('markdown'); expect(getMarkdownSource(reopened!)).toBe(originalSource);
    const nextSource = originalSource.replace('Java', 'Java 与 SQL');
    const second = await saveResume(updateMarkdownSource(first, nextSource).document);
    expect(getMarkdownSource((await getResume(first.id))!)).toBe(nextSource);
    const snapshots = await getSnapshots(first.id), restored = await restoreSnapshot(first.id, snapshots[0].id, second.revision);
    expect(restored.revision).toBe(3); expect(restored.markdownSource).toBe(originalSource); expect(JSON.stringify(restored.sections)).not.toContain('Java 与 SQL');
  });

  it('accepts legacy documents and validates additive Markdown fields without a DB migration', async () => {
    const legacy = await saveResume(createResume()); expect(getEditorMode(legacy)).toBe('visual'); expect(legacy.markdownSource).toBeUndefined();
    const sourceOnly = await saveResume({ ...createResume(), markdownSource: '# 原始源码\n' }); expect(sourceOnly.editorMode).toBe('markdown');
    await expect(saveResume({ ...createResume(), editorMode: 'unsupported' as 'visual' })).rejects.toThrow('编辑模式');
    await expect(saveResume({ ...createResume(), markdownSource: 'x'.repeat(2_000_001) })).rejects.toThrow('Markdown 源码');
  });

  it('preserves independent spacing while accepting documents without the additive layout fields', async () => {
    const document = createResume('neat');
    document.layout = { ...document.layout, marginLeft: 12, marginRight: 42, contentIndent: 18, titleTopGap: 0 };
    const saved = await saveResume(document);
    expect((await getResume(saved.id))?.layout).toEqual(document.layout);
    const legacy = createResume('classic');
    for(const field of ['marginLeft','marginRight','contentIndent','titleTopGap'] as const)delete legacy.layout[field];
    const old = await saveResume(legacy);
    for (const field of ['marginLeft', 'marginRight', 'contentIndent', 'titleTopGap'] as const) {
      expect(old.layout[field]).toBeUndefined();
      await expect(saveResume({ ...createResume(), layout: { ...document.layout, [field]: -1 } })).rejects.toThrow();
      await expect(saveResume({ ...createResume(), layout: { ...document.layout, [field]: 73 } })).rejects.toThrow();
      await expect(saveResume({ ...createResume(), layout: { ...document.layout, [field]: Number.NaN } })).rejects.toThrow();
    }
  });

  it('persists raw editor input even when its structured preview cannot yet be parsed', async () => {
    const base = await saveResume(createResume()), source = `@[name](${'张'.repeat(2001)})\n`;
    const pending = updateMarkdownSource(base, source); expect(pending.previewStale).toBe(true);
    const saved = await saveResume(pending.document), reopened = await getResume(saved.id);
    expect(reopened?.markdownSource).toBe(source); expect(reopened?.sections).toEqual(base.sections); expect(reopened?.profile).toEqual(base.profile);
  });
});
