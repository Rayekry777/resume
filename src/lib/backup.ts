import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { BackupPackage, ResumeAsset, ResumeDocument } from '../model';
import { getAsset, importDocuments, loadResumes, validateResumeDocument } from './storage';
import { MAX_IMAGE_BYTES, sniffImageType } from './images';
import { repairLegacyMarkdownProjection } from './markdown';

const MAX_BACKUP_BYTES = 40 * 1024 * 1024;
const MAX_BACKUP_BASE64_LENGTH = Math.ceil(MAX_BACKUP_BYTES / 3) * 4;
export const BACKUP_TEXT_PREFIX = 'resume-backup-v1:';
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const assetPathPattern = /^assets\/[a-zA-Z0-9_-]+\.(?:bin|jpg|jpeg|png|webp)$/;
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function string(value: unknown, field: string, max = 2000): string { if (typeof value !== 'string' || !value || value.length > max) throw new Error(`备份中的${field}无效`); return value; }

/** The ZIP contains editable JSON and only locally stored, referenced photos. */
export async function exportBackup(documents?: ResumeDocument[]): Promise<Blob> {
  const docs = (documents ?? await loadResumes(true)).map(document => validateResumeDocument(document));
  if (docs.length > 200) throw new Error('单个备份最多包含 200 份简历，请分批备份');
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  const assets: BackupPackage['assets'] = [];
  const ids = [...new Set(docs.map(document => document.profile.photoId).filter((id): id is string => Boolean(id)))];
  let totalSize = 0;
  for (const [index, id] of ids.entries()) {
    const asset = await getAsset(id);
    if (!asset) throw new Error('部分简历引用的照片不存在，请重新选择照片后备份');
    const bytes = new Uint8Array(await asset.blob.arrayBuffer()), type = sniffImageType(bytes);
    if (!type || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('备份照片无效，请重新选择照片');
    const path = `assets/${index}.bin`;
    files[path] = bytes; assets.push({ id, name: asset.name, type, path }); totalSize += bytes.byteLength;
  }
  const manifest: BackupPackage = { format: 'local-resume', version: 1, createdAt: Date.now(), documents: docs, assets };
  files['manifest.json'] = strToU8(JSON.stringify(manifest)); totalSize += files['manifest.json'].byteLength;
  if (files['manifest.json'].byteLength > MAX_MANIFEST_BYTES || totalSize > MAX_UNPACKED_BYTES) throw new Error('备份内容过大，请减少简历或分批导出');
  const bytes = zipSync(files, { level: 6 });
  if (bytes.byteLength > MAX_BACKUP_BYTES) throw new Error('备份超过 40 MB，请分批导出');
  return new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
}

/** Copyable transport for the same ZIP, including referenced local photos. */
export async function exportBackupText(documents?: ResumeDocument[]): Promise<string> {
  const bytes = new Uint8Array(await (await exportBackup(documents)).arrayBuffer());
  const chunks: string[] = [];
  // Each complete chunk is divisible by three, so only the final chunk has padding.
  for (let offset = 0; offset < bytes.length; offset += 24_576) {
    let binary = '';
    const end = Math.min(offset + 24_576, bytes.length);
    for (let index = offset; index < end; index++) binary += String.fromCharCode(bytes[index]);
    chunks.push(btoa(binary));
  }
  return BACKUP_TEXT_PREFIX + chunks.join('');
}

export interface ImportBackupResult { documents: ResumeDocument[]; warnings: string[] }

/** Decode only bounded canonical Base64, then reuse the transactional ZIP importer. */
export async function importBackupText(text: string): Promise<ImportBackupResult> {
  if (typeof text !== 'string' || !text.startsWith(BACKUP_TEXT_PREFIX)) throw new Error('请粘贴完整的文本备份');
  if (text.length > BACKUP_TEXT_PREFIX.length + MAX_BACKUP_BASE64_LENGTH) throw new Error('文本备份超过 40 MB，请分批导入');
  const encoded = text.slice(BACKUP_TEXT_PREFIX.length), length = encoded.length;
  if (!length || length % 4 || /[^A-Za-z0-9+/=]/.test(encoded)) throw new Error('文本备份不是有效的 Base64 格式');
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const firstPadding = encoded.indexOf('=');
  if (firstPadding !== -1 && firstPadding !== length - padding) throw new Error('文本备份不是有效的 Base64 格式');
  const bytesLength = length / 4 * 3 - padding;
  if (!bytesLength || bytesLength > MAX_BACKUP_BYTES) throw new Error('文本备份超过 40 MB，请分批导入');
  // Reject alternate encodings with nonzero unused bits in their final sextet.
  if (padding) {
    const sextet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(encoded[length - padding - 1]);
    if ((padding === 2 && (sextet & 15) !== 0) || (padding === 1 && (sextet & 3) !== 0)) throw new Error('文本备份不是有效的 Base64 格式');
  }
  const bytes = new Uint8Array(bytesLength);
  let destination = 0;
  for (let offset = 0; offset < length; offset += 32_768) {
    const binary = atob(encoded.slice(offset, offset + 32_768));
    for (let index = 0; index < binary.length; index++) bytes[destination++] = binary.charCodeAt(index);
  }
  return importBackup(new Blob([bytes], { type: 'application/zip' }));
}

/** Validate all entries before committing; never resolve ZIP paths as URLs or filesystem paths. */
export async function importBackup(blob: Blob): Promise<ImportBackupResult> {
  if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_BACKUP_BYTES) throw new Error('请选择不超过 40 MB 的简历 ZIP 备份');
  let files: Record<string, Uint8Array>;
  let unpackedBytes = 0, entryCount = 0;
  const seenEntries = new Set<string>();
  try {
    files = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
      filter(entry) {
        if (++entryCount > 501) throw new Error('备份文件数量过多');
        if (seenEntries.has(entry.name)) throw new Error('备份文件路径重复');
        seenEntries.add(entry.name);
        if (entry.name !== 'manifest.json' && !assetPathPattern.test(entry.name)) throw new Error('备份包含不允许的文件路径');
        const maximum = entry.name === 'manifest.json' ? MAX_MANIFEST_BYTES : MAX_IMAGE_BYTES;
        if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0 || entry.originalSize > maximum) throw new Error('备份文件过大');
        unpackedBytes += entry.originalSize;
        if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error('备份解压后的内容超过 64 MB');
        return true;
      },
    });
  } catch (error) { throw new Error(`无法读取备份：${error instanceof Error ? error.message : 'ZIP 文件损坏'}`); }
  if (!Object.hasOwn(files, 'manifest.json')) throw new Error('备份缺少 manifest.json');
  let manifest: unknown;
  try { manifest = JSON.parse(strFromU8(files['manifest.json'])); } catch { throw new Error('备份清单不是有效的 JSON'); }
  if (!isRecord(manifest) || manifest.format !== 'local-resume' || manifest.version !== 1) throw new Error('不支持的备份格式或版本');
  if (typeof manifest.createdAt !== 'number' || !Number.isFinite(manifest.createdAt) || !Array.isArray(manifest.documents) || manifest.documents.length > 200 || !Array.isArray(manifest.assets) || manifest.assets.length > 500) throw new Error('备份清单字段无效');
  const warnings: string[] = [];
  const documents = manifest.documents.map(document => repairLegacyMarkdownProjection(validateResumeDocument(document, warnings)));
  const documentIds = new Set<string>();
  for (const document of documents) { if (documentIds.has(document.id)) throw new Error('备份内出现重复简历 ID'); documentIds.add(document.id); }
  const assetIds = new Map<string, string>(), paths = new Set<string>(), assets: ResumeAsset[] = [];
  for (const value of manifest.assets) {
    if (!isRecord(value)) throw new Error('备份照片信息无效');
    const oldId = string(value.id, '照片 ID', 200), name = string(value.name, '照片名称'), path = string(value.path, '照片路径', 300), declaredType = string(value.type, '照片类型', 100);
    if (!assetPathPattern.test(path) || !Object.hasOwn(files, path)) throw new Error('备份照片路径无效或照片缺失');
    if (assetIds.has(oldId) || paths.has(path)) throw new Error('备份照片 ID 或路径重复');
    const bytes = files[path], type = sniffImageType(bytes);
    if (!type || type !== declaredType || !bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('备份中的照片格式无效，仅支持 JPG、PNG 和 WebP');
    const id = crypto.randomUUID(); assetIds.set(oldId, id); paths.add(path);
    assets.push({ id, name, createdAt: Date.now(), blob: new Blob([new Uint8Array(bytes)], { type }) });
  }
  for (const document of documents) {
    if (!document.profile.photoId) continue;
    const id = assetIds.get(document.profile.photoId);
    if (!id) throw new Error(`简历“${document.title}”引用的照片未包含在备份中`);
    document.profile.photoId = id;
  }
  const imported = await importDocuments(documents, assets);
  return { documents: imported, warnings: [...new Set(warnings)] };
}
