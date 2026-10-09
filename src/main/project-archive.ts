import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import JSZip from 'jszip';
import { fromBuffer, type Entry } from 'yauzl';
import { archiveManifestSchema, archiveMetadataSchema } from '../shared/archive';
import type { ArchiveMetadata, ParsedProjectArchive, ProjectArchiveLimits, ProjectArchiveManifest } from '../shared/archive';

const defaults: Required<ProjectArchiveLimits> = {
  maxInputBytes: 257 * 1024 * 1024, maxEntries: 2, maxExpandedBytes: 256 * 1024 * 1024,
  maxManifestBytes: 64 * 1024, maxCompressionRatio: 200,
};
const databaseHeader = Buffer.from('SQLite format 3\0', 'ascii');
function assertDatabase(bytes: Buffer): void {
  if (bytes.length < 100 || !bytes.subarray(0, 16).equals(databaseHeader)) throw new Error('归档缺少有效 SQLite 文件头。');
}
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** 调用者仅传入作品数据库备份；密钥、个人资料和全局配置不能作为归档条目。 */
export async function createProjectArchive(databaseBytes: Uint8Array, metadata: ArchiveMetadata): Promise<Buffer> {
  const parsed = archiveMetadataSchema.safeParse(metadata);
  if (!parsed.success) throw new Error('项目归档清单参数无效或包含不允许的字段。');
  if (databaseBytes.byteLength > defaults.maxExpandedBytes - defaults.maxManifestBytes) throw new Error('项目数据库大小超过归档限额。');
  const database = Buffer.from(databaseBytes);
  assertDatabase(database);
  const manifest: ProjectArchiveManifest = { formatVersion: 1, ...parsed.data, databaseSha256: sha256(database) };
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('project.sqlite', database);
  // 使用 STORE 避免合法的重复数据库页产生极高压缩比；解析外部包仍限制解压比例。
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

/** 严格固定两项；逐项校验、受限解压，全程不向文件系统释放不可信路径。 */
export async function parseProjectArchive(input: Uint8Array, options: ProjectArchiveLimits = {}): Promise<ParsedProjectArchive> {
  const limits = { ...defaults, ...options };
  if (!Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('归档解析限额必须为有限正整数。');
  if (input.byteLength > limits.maxInputBytes) throw new Error('归档文件大小超限。');
  const files = await new Promise<Map<string, Buffer>>((resolve, reject) => {
    fromBuffer(Buffer.from(input), { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error('归档 ZIP 格式无效。')); return; }
      let failed = false, entries = 0, declared = 0, expanded = 0;
      const result = new Map<string, Buffer>();
      const fail = (cause: unknown) => { if (!failed) { failed = true; zip.close(); reject(cause); } };
      zip.on('error', fail);
      zip.on('end', () => {
        if (failed) return;
        zip.close();
        if (result.size !== 2 || !result.has('manifest.json') || !result.has('project.sqlite')) { reject(new Error('归档缺少固定条目。')); return; }
        resolve(result);
      });
      if (zip.entryCount !== 2 || zip.entryCount > limits.maxEntries) { fail(new Error('归档条目数量无效或超限。')); return; }
      if (zip.comment) { fail(new Error('归档包含不允许的附加注释。')); return; }
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          if (++entries > limits.maxEntries) throw new Error('归档条目数量超限。');
          const name = entry.fileName;
          if (name !== 'manifest.json' && name !== 'project.sqlite') throw new Error('归档包含非法路径或非作品条目。');
          if (result.has(name)) throw new Error('归档包含重复路径。');
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('归档不允许符号链接。');
          if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x40)) throw new Error('归档不允许加密条目。');
          if (![0, 8].includes(entry.compressionMethod)) throw new Error('归档压缩方法不支持。');
          if (entry.fileComment) throw new Error('归档包含不允许的条目注释。');
          declared += entry.uncompressedSize;
          if (!Number.isSafeInteger(declared) || declared > limits.maxExpandedBytes) throw new Error('归档总展开大小超限。');
          if (name === 'manifest.json' && entry.uncompressedSize > limits.maxManifestBytes) throw new Error('归档清单大小超限。');
          if (entry.uncompressedSize / Math.max(1, entry.compressedSize) > limits.maxCompressionRatio) throw new Error('归档压缩比超限，可能为压缩炸弹。');
          const header = await zip.readLocalFileHeaderPromise(entry);
          if (header.fileName.toString('utf8') !== name || header.compressionMethod !== entry.compressionMethod || header.generalPurposeBitFlag !== entry.generalPurposeBitFlag) throw new Error('归档本地条目与目录信息不一致。');
          const stream = await zip.openReadStreamPromise(entry);
          const chunks: Buffer[] = [];
          let size = 0, checksum = 0;
          for await (const value of stream) {
            const chunk = Buffer.from(value);
            size += chunk.length; expanded += chunk.length; checksum = crc32(chunk, checksum);
            if (expanded > limits.maxExpandedBytes || size > entry.uncompressedSize || (name === 'manifest.json' && size > limits.maxManifestBytes)) {
              stream.destroy(); throw new Error('归档实际展开大小超限。');
            }
            chunks.push(chunk);
          }
          if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw new Error('归档条目大小或 CRC 校验失败。');
          result.set(name, Buffer.concat(chunks));
          if (!failed) zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.get('manifest.json')!)); }
  catch { throw new Error('归档清单不是有效 UTF-8 JSON。'); }
  const parsed = archiveManifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error('归档清单字段、格式版本或 schema 版本无效。');
  const database = files.get('project.sqlite')!;
  assertDatabase(database);
  if (sha256(database) !== parsed.data.databaseSha256) throw new Error('归档数据库 SHA256 哈希校验失败。');
  return { manifest: parsed.data, database };
}
