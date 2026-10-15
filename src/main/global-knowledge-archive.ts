import { createHash, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import JSZip from 'jszip';
import { fromBuffer, type Entry } from 'yauzl';
import { z } from 'zod';
import { globalKnowledgeArchiveDataSchema, globalKnowledgeArchiveManifestSchema, type GlobalKnowledgeArchiveData } from '../shared/global-knowledge-archive';
import { globalKnowledgePageSchema } from '../shared/global-knowledge-schema';
import type { GlobalKnowledgeTransport } from './global-knowledge-commands';
import { operationError } from '../shared/operation-errors';

const limits = { input: 257 * 1024 * 1024, expanded: 256 * 1024 * 1024, manifest: 64 * 1024, ratio: 200 };
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export async function createGlobalKnowledgeArchive(value: GlobalKnowledgeArchiveData): Promise<Buffer> {
  const data = globalKnowledgeArchiveDataSchema.parse(value), bytes = Buffer.from(JSON.stringify(data), 'utf8');
  if (bytes.length > limits.expanded - limits.manifest) throw new Error('全局知识库超过归档大小上限。');
  const manifest = globalKnowledgeArchiveManifestSchema.parse({ format: 'rainsoulknowledge', formatVersion: 1, schemaVersion: 1, exportedAt: new Date().toISOString(), libraryId: data.libraryId, dataSha256: sha(bytes), count: data.entries.length });
  const zip = new JSZip(); zip.file('manifest.json', JSON.stringify(manifest)); zip.file('knowledge.json', bytes);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

/** 固定两项、限制解压并验证本地头/CRC/SHA；不向磁盘释放外部ZIP路径。 */
export async function parseGlobalKnowledgeArchive(input: Uint8Array): Promise<GlobalKnowledgeArchiveData> {
  if (input.byteLength > limits.input) throw new Error('全局知识归档大小超限。');
  const files = await new Promise<Map<string, Buffer>>((resolve, reject) => {
    fromBuffer(Buffer.from(input), { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new Error('全局知识归档ZIP格式无效。')); return; }
      let failed = false, count = 0, declared = 0, expanded = 0;
      const result = new Map<string, Buffer>();
      const fail = (reason: unknown) => { if (!failed) { failed = true; zip.close(); reject(reason); } };
      zip.on('error', fail);
      zip.on('end', () => { if (failed) return; zip.close(); if (result.size !== 2 || !result.has('manifest.json') || !result.has('knowledge.json')) reject(new Error('全局知识归档缺少固定条目。')); else resolve(result); });
      if (zip.entryCount !== 2 || zip.comment) { fail(new Error('全局知识归档条目数量或附加注释无效。')); return; }
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const name = entry.fileName;
          if (++count > 2 || !['manifest.json', 'knowledge.json'].includes(name) || result.has(name)) throw new Error('全局知识归档包含非法或重复路径。');
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 || entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x40) || ![0, 8].includes(entry.compressionMethod) || entry.fileComment) throw new Error('全局知识归档条目属性无效。');
          declared += entry.uncompressedSize;
          if (!Number.isSafeInteger(declared) || declared > limits.expanded || (name === 'manifest.json' && entry.uncompressedSize > limits.manifest) || entry.uncompressedSize / Math.max(1, entry.compressedSize) > limits.ratio) throw new Error('全局知识归档解压大小或比例超限。');
          const header = await zip.readLocalFileHeaderPromise(entry);
          if (header.fileName.toString('utf8') !== name || header.compressionMethod !== entry.compressionMethod || header.generalPurposeBitFlag !== entry.generalPurposeBitFlag) throw new Error('全局知识归档本地头与目录不一致。');
          const stream = await zip.openReadStreamPromise(entry), chunks: Buffer[] = [];
          let size = 0, checksum = 0;
          for await (const value of stream) {
            const chunk = Buffer.from(value); size += chunk.length; expanded += chunk.length; checksum = crc32(chunk, checksum);
            if (expanded > limits.expanded || size > entry.uncompressedSize || (name === 'manifest.json' && size > limits.manifest)) { stream.destroy(); throw new Error('全局知识归档实际展开大小超限。'); }
            chunks.push(chunk);
          }
          if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw new Error('全局知识归档CRC或大小校验失败。');
          result.set(name, Buffer.concat(chunks)); if (!failed) zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
  const decode = (name: string) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files.get(name)!)) as unknown;
  const manifest = globalKnowledgeArchiveManifestSchema.parse(decode('manifest.json'));
  if (sha(files.get('knowledge.json')!) !== manifest.dataSha256) throw new Error('全局知识归档SHA256校验失败。');
  const data = globalKnowledgeArchiveDataSchema.parse(decode('knowledge.json'));
  if (data.libraryId !== manifest.libraryId || data.entries.length !== manifest.count) throw new Error('全局知识归档清单与内容不一致。');
  for (const document of data.sourceAssets.documents) {
    if (sha(JSON.stringify(document.segments.map(segment => segment.text))) !== document.bodyHash || document.segments.some(segment => sha(segment.text) !== segment.textHash)) throw new Error('全局知识归档来源原文哈希不匹配。');
  }
  return data;
}

const confirmation = z.object({ token: z.uuid(), operationId: z.uuid() }).strict();
export class GlobalKnowledgeArchiveCommands {
  private preview: { token: string; data: GlobalKnowledgeArchiveData } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly client: GlobalKnowledgeTransport, private readonly files: { choose(): Promise<{ name: string; bytes: Buffer } | null>; save(name: string, bytes: Buffer): Promise<boolean> }) {}
  accepts(command: string) { return ['chooseGlobalKnowledgeArchive', 'confirmGlobalKnowledgeArchive', 'exportGlobalKnowledgeArchive'].includes(command); }
  execute(command: string, payload: unknown): Promise<unknown> {
    const task = this.queue.then(async () => {
      if (!this.accepts(command)) throw new Error('未知全局知识归档命令。');
      if (command === 'confirmGlobalKnowledgeArchive') {
        const request = confirmation.parse(payload);
        if (!this.preview || this.preview.token !== request.token) throw operationError('全局知识归档预览已失效，请重新选择。', 'INVALID_ARCHIVE_TOKEN');
        return globalKnowledgePageSchema.parse(await this.client.request('importData', { operationId: request.operationId, data: this.preview.data }));
      }
      z.object({}).strict().parse(payload);
      if (command === 'chooseGlobalKnowledgeArchive') {
        this.preview = null; const file = await this.files.choose(); if (!file) return null;
        if (!file.name.toLowerCase().endsWith('.rainsoulknowledge')) throw new Error('请选择 .rainsoulknowledge 全局知识归档。');
        const data = await parseGlobalKnowledgeArchive(file.bytes), token = randomUUID(); this.preview = { token, data };
        return { token, filename: file.name, count: data.entries.length };
      }
      const data = globalKnowledgeArchiveDataSchema.parse(await this.client.request('exportData', {}));
      return this.files.save(`RainSoul全局知识库-${new Date().toISOString().slice(0, 10)}.rainsoulknowledge`, await createGlobalKnowledgeArchive(data));
    });
    this.queue = task.catch(() => {}); return task;
  }
  async drain(): Promise<void> { await this.queue; }
}
