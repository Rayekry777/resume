import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResume, richText } from '../src/sample';
import { BACKUP_TEXT_PREFIX, exportBackup, exportBackupText, importBackup, importBackupText } from '../src/lib/backup';
import { getAsset, loadResumes, putAsset, saveResume } from '../src/lib/storage';
import { parseMarkdown } from '../src/lib/markdown';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=', 'base64'));
const maxBackupBytes = 40 * 1024 * 1024;
const maxBase64Length = Math.ceil(maxBackupBytes / 3) * 4;
const textEnvelope = (bytes: Uint8Array) => BACKUP_TEXT_PREFIX + Buffer.from(bytes).toString('base64');

beforeEach(async () => {
  await loadResumes(true);
  const db = await openDB('local-resume-studio', 1);
  const tx = db.transaction(['resumes', 'snapshots', 'assets', 'settings'], 'readwrite');
  await Promise.all(Array.from(tx.objectStoreNames).map(name => tx.objectStore(name).clear()));
  await tx.done;
  db.close();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('editable text backup', () => {
  it('round-trips photo bytes, original Markdown and extra fields without networking', async () => {
    expect(BACKUP_TEXT_PREFIX).toBe('resume-backup-v1:');
    const asset = await putAsset({ id: crypto.randomUUID(), name: '照片.png', createdAt: Date.now(), blob: new Blob([png], { type: 'image/png' }) });
    const source = '\uFEFF@[name](迁移姓名)\r\n\r\n:::project\r\n@[name](实际项目)\r\n- **原始格式**\r\n:::\r\n';
    const document = parseMarkdown(source).document;
    document.profile.photoId = asset.id;
    document.profile.extraFields = [{ key: 'highestDegree', label: '学历', value: '本科' }];
    const original = await saveResume(document);
    const fetch = vi.fn(() => { throw new Error('不应联网'); });
    vi.stubGlobal('fetch', fetch);

    const text = await exportBackupText();
    expect(text.startsWith(BACKUP_TEXT_PREFIX)).toBe(true);
    expect(text.slice(BACKUP_TEXT_PREFIX.length)).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    const restored = await importBackupText(text);
    expect(restored.warnings).toEqual([]);
    expect(restored.documents).toHaveLength(1);
    const copy = restored.documents[0];
    expect(copy.id).not.toBe(original.id);
    expect(copy.markdownSource).toBe(source);
    expect(copy.profile.extraFields).toEqual(original.profile.extraFields);
    expect(copy.profile.photoId).not.toBe(asset.id);
    const photo = (await getAsset(copy.profile.photoId!))!;
    expect(photo.blob.type).toBe('image/png');
    expect(new Uint8Array(await photo.blob.arrayBuffer())).toEqual(png);

    const second = await importBackupText(await exportBackupText([copy]));
    expect(second.documents[0].profile.extraFields).toEqual(original.profile.extraFields);
    expect(new Uint8Array(await (await getAsset(second.documents[0].profile.photoId!))!.blob.arrayBuffer())).toEqual(png);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the original ZIP export and import API usable', async () => {
    const original = await saveResume(createResume());
    const zip = await exportBackup([original]);
    expect(zip.type).toBe('application/zip');
    const restored = await importBackup(zip);
    expect(restored.documents).toHaveLength(1);
    expect(restored.documents[0].sections).toEqual(original.sections);
  });

  it('round-trips a large resume across multiple base64 encoding and decoding chunks', async () => {
    let seed = 20261118;
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const body = Array.from({ length: 100_000 }, () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return alphabet[(seed >>> 0) % alphabet.length];
    }).join('');
    const document = createResume();
    document.sections[0].items[0].description = richText(body);
    const text = await exportBackupText([document]);
    expect(text.length - BACKUP_TEXT_PREFIX.length).toBeGreaterThan(32_768);
    const restored = await importBackupText(text);
    expect(restored.documents[0].sections).toEqual(document.sections);
  });

  it.each([
    ['missing prefix', 'UEsDBA=='],
    ['unsupported prefix', 'resume-backup-v2:UEsDBA=='],
    ['empty payload', 'resume-backup-v1:'],
    ['invalid alphabet', 'resume-backup-v1:UEsD_A=='],
    ['embedded whitespace', 'resume-backup-v1:UEsD BA=='],
    ['leading whitespace', ' resume-backup-v1:UEsDBA=='],
    ['trailing newline', 'resume-backup-v1:UEsDBA==\n'],
    ['bad length', 'resume-backup-v1:AAA'],
    ['padding in the middle', 'resume-backup-v1:AA==AAAA'],
    ['too much padding', 'resume-backup-v1:A==='],
    ['noncanonical one-byte ending', 'resume-backup-v1:AB=='],
    ['noncanonical two-byte ending', 'resume-backup-v1:AAB='],
  ])('rejects %s before touching stored documents', async (_name, text) => {
    await expect(importBackupText(text)).rejects.toThrow();
    expect(await loadResumes(true)).toEqual([]);
  });

  it('rejects a text payload exceeding the maximum encoded length', async () => {
    await expect(importBackupText(BACKUP_TEXT_PREFIX + 'A'.repeat(maxBase64Length + 4))).rejects.toThrow(/40|过大|大小|长度/);
    expect(await loadResumes(true)).toEqual([]);
  });

  it('rejects a base64 payload whose decoded bytes exceed 40 MiB even at the maximum encoded length', async () => {
    // 40 MiB has a remainder of 1 modulo 3. Omitting padding at the same
    // encoded length describes two extra bytes and must be rejected pre-ZIP.
    await expect(importBackupText(BACKUP_TEXT_PREFIX + 'A'.repeat(maxBase64Length))).rejects.toThrow(/40|过大|大小|长度/);
    expect(await loadResumes(true)).toEqual([]);
  });

  it('reuses ZIP photo validation and commits no documents for a disguised SVG', async () => {
    const document = createResume();
    document.profile.photoId = 'photo';
    const manifest = { format: 'local-resume', version: 1, createdAt: Date.now(), documents: [document], assets: [{ id: 'photo', name: 'photo.png', type: 'image/png', path: 'assets/0.bin' }] };
    const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'assets/0.bin': strToU8('<svg onload="alert(1)"></svg>') });
    await expect(importBackupText(textEnvelope(bytes))).rejects.toThrow('照片格式');
    expect(await loadResumes(true)).toEqual([]);
    const db = await openDB('local-resume-studio', 1);
    expect(await db.getAll('assets')).toEqual([]);
    db.close();
  });
});
