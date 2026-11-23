import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createResume } from '../src/sample';
import { exportBackup, importBackup } from '../src/lib/backup';
import { exportStructuredMarkdown, parseMarkdown, updateMarkdownSource } from '../src/lib/markdown';
import { getResume, getSnapshots, loadResumes, restoreSnapshot, saveResume, validateResumeDocument } from '../src/lib/storage';

const degree = { key: 'highestDegree', label: '学历', value: '本科' };

beforeEach(async () => {
  await loadResumes(true);
  const db = await openDB('local-resume-studio', 1);
  const tx = db.transaction(['resumes', 'snapshots', 'assets', 'settings'], 'readwrite');
  await Promise.all(Array.from(tx.objectStoreNames).map(name => tx.objectStore(name).clear()));
  await tx.done;
  db.close();
});

describe('migrated profile information', () => {
  it('accepts legacy documents and retains education through autosave, ordinary editing and history', async () => {
    const legacy = await saveResume(createResume());
    expect((await getResume(legacy.id))!.profile.extraFields).toBeUndefined();

    const migrated = await saveResume({ ...legacy, profile: { ...legacy.profile, extraFields: [degree] } });
    const edited = await saveResume({ ...migrated, profile: { ...migrated.profile, name: '修改后的姓名' } });
    expect((await getResume(edited.id))!.profile.extraFields).toEqual([degree]);

    const beforeEdit = (await getSnapshots(edited.id)).find(snapshot => snapshot.document.revision === migrated.revision)!;
    const restored = await restoreSnapshot(edited.id, beforeEdit.id, edited.revision);
    expect(restored.profile.name).toBe(migrated.profile.name);
    expect(restored.profile.extraFields).toEqual([degree]);
  });

  it('accepts empty extra fields and their documented size boundaries', () => {
    const base = createResume();
    expect(validateResumeDocument({ ...base, profile: { ...base.profile, extraFields: [] } }).profile.extraFields).toEqual([]);
    const fields = Array.from({ length: 30 }, (_, index) => ({ key: String(index).padEnd(200, 'k'), label: '学'.repeat(200), value: index ? '' : '历'.repeat(2000) }));
    expect(validateResumeDocument({ ...base, profile: { ...base.profile, extraFields: fields } }).profile.extraFields).toEqual(fields);
  });

  it.each([
    ['a non-array value', {}],
    ['more than 30 entries', Array.from({ length: 31 }, (_, index) => ({ ...degree, key: `degree-${index}` }))],
    ['duplicate keys', [degree, { ...degree, label: '另一学历' }]],
    ['an empty key', [{ ...degree, key: ' ' }]],
    ['an overlong key', [{ ...degree, key: 'k'.repeat(201) }]],
    ['an empty label', [{ ...degree, label: ' ' }]],
    ['an overlong label', [{ ...degree, label: '学'.repeat(201) }]],
    ['an overlong value', [{ ...degree, value: '本'.repeat(2001) }]],
    ['a non-string value', [{ ...degree, value: 42 }]],
    ['a control character in a key', [{ ...degree, key: 'highest\u007fDegree' }]],
    ['a control character in a label', [{ ...degree, label: '学\n历' }]],
    ['a control character in a value', [{ ...degree, value: '本\t科' }]],
  ])('rejects %s before storing profile extras', (_name, fields) => {
    const base = createResume();
    expect(() => validateResumeDocument({ ...base, profile: { ...base.profile, extraFields: fields } })).toThrow();
  });

  it('keeps migrated education in a ZIP import copy and subsequent ordinary edits', async () => {
    const base = createResume();
    const original = await saveResume({ ...base, profile: { ...base.profile, extraFields: [degree] } });
    const result = await importBackup(await exportBackup([original]));
    const copy = result.documents[0];
    expect(result.warnings).toEqual([]);
    expect(copy.id).not.toBe(original.id);
    expect(copy.profile.extraFields).toEqual([degree]);

    const edited = await saveResume({ ...copy, profile: { ...copy.profile, title: 'Java 后端开发' } });
    expect((await getResume(edited.id))!.profile.extraFields).toEqual([degree]);
    const secondCopy = (await importBackup(await exportBackup([edited]))).documents[0];
    expect(secondCopy.profile.extraFields).toEqual([degree]);
  });

  it('round-trips all extra-field text through structured Markdown without turning it into body text', () => {
    const base = createResume();
    const fields = [degree, { key: 'certificate', label: '附件 (学位)', value: 'C:\\资料\\degree(2026).pdf "已核验" [副本]' }, { key: 'optional', label: '补充', value: '' }];
    base.profile.extraFields = fields;
    const source = exportStructuredMarkdown(base);
    expect(source).toContain('@[profileExtra](');
    const parsed = parseMarkdown(source);
    expect(parsed.document.profile.extraFields).toEqual(fields);
    expect(parsed.document.sections).toHaveLength(base.sections.length);
    expect(parsed.warnings.some(warning => warning.includes('自定义元信息'))).toBe(false);

    const updated = updateMarkdownSource(parsed.document, source.replace(`@[name](${base.profile.name})`, '@[name](新姓名)'));
    expect(updated.previewStale).toBe(false);
    expect(updated.document.profile.name).toBe('新姓名');
    expect(updated.document.profile.extraFields).toEqual(fields);
  });

  it('preserves extras when updating original-site source that lacks extra metadata', () => {
    const base = createResume();
    base.profile.extraFields = [degree];
    const updated = updateMarkdownSource(base, '@[name](新的姓名)\n:::skill\n- Java\n:::\n');
    expect(updated.previewStale).toBe(false);
    expect(updated.document.profile.name).toBe('新的姓名');
    expect(updated.document.profile.extraFields).toEqual([degree]);
  });

  it('uses explicit source extras instead of duplicating inherited values', () => {
    const base = createResume();
    base.profile.extraFields = [degree];
    const sourceDocument = createResume();
    const changed = [{ ...degree, value: '硕士' }, { key: 'language', label: '语言', value: '英语' }];
    sourceDocument.profile.extraFields = changed;
    const updated = updateMarkdownSource(base, exportStructuredMarkdown(sourceDocument));
    expect(updated.previewStale).toBe(false);
    expect(updated.document.profile.extraFields).toEqual(changed);
  });
});
