import { crc32 } from 'node:zlib';
import { fromBuffer, type Entry } from 'yauzl';
import type { ManuscriptDraft, ManuscriptOptions } from '../shared/manuscript';
import { parseWordXml } from './manuscript-xml';
import { splitManuscript } from './manuscript-text';

export interface DocxLimits { maxExpandedBytes?: number; maxEntries?: number }
/** 在内存里按项流读取，不把不可信 ZIP 路径写入文件系统。 */
export function readDocxPackage(input: Uint8Array, options: ManuscriptOptions & DocxLimits): Promise<Map<string, Buffer>> {
  const maxInput = options.maxInputBytes ?? 128 * 1024 * 1024;
  if (!Number.isSafeInteger(maxInput) || maxInput < 1 || input.byteLength > maxInput) return Promise.reject(new Error('DOCX 文件大小超限。'));
  const maxExpanded = options.maxExpandedBytes ?? 512 * 1024 * 1024;
  const maxEntries = options.maxEntries ?? 10_000;
  if (![maxExpanded, maxEntries].every(value => Number.isSafeInteger(value) && value > 0)) return Promise.reject(new Error('DOCX 解析限额必须是有限正整数。'));
  return new Promise((resolve, reject) => {
    fromBuffer(Buffer.from(input), { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error('DOCX ZIP 无效。')); return; }
      let failed = false, expanded = 0, declared = 0, entries = 0;
      const paths = new Set<string>(), files = new Map<string, Buffer>();
      const fail = (cause: unknown) => { if (!failed) { failed = true; zip.close(); reject(cause); } };
      zip.on('error', fail);
      zip.on('end', () => { if (!failed) resolve(files); });
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const name = entry.fileName;
          const normalized = name.normalize('NFC').toLowerCase();
          if (++entries > maxEntries) throw new Error('DOCX ZIP 条目数量超限。');
          const parts = name.replace(/\/$/, '').split('/');
          if (!name || name.includes('\\') || parts.some(part => !part || part === '.' || part === '..' || part.includes(':') || [...part].some(char => char.codePointAt(0)! < 32)
            || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || /[. ]$/.test(part))
            || paths.has(normalized) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 || entry.isEncrypted()) throw new Error('DOCX ZIP 包含非法路径、重复条目、链接或加密内容。');
          paths.add(normalized);
          declared += entry.uncompressedSize;
          if (!Number.isSafeInteger(declared) || declared > maxExpanded) throw new Error('DOCX 展开大小超限。');
          if (name.endsWith('/')) { zip.readEntry(); return; }
          const stream = await zip.openReadStreamPromise(entry);
          const chunks: Buffer[] = [], selected = name === 'word/document.xml' || name === 'word/styles.xml';
          let size = 0, checksum = 0;
          for await (const value of stream) {
            const chunk = Buffer.from(value);
            size += chunk.length; expanded += chunk.length; checksum = crc32(chunk, checksum);
            if (expanded > maxExpanded || (selected && size > 64 * 1024 * 1024)) { stream.destroy(); throw new Error('DOCX 实际展开大小超限。'); }
            if (selected) chunks.push(chunk);
          }
          if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw new Error('DOCX ZIP 大小或校验和损坏。');
          if (selected) files.set(name, Buffer.concat(chunks));
          if (!failed) zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
}

export async function parseDocxManuscript(bytes: Uint8Array, options: ManuscriptOptions & DocxLimits): Promise<ManuscriptDraft> {
  const files = await readDocxPackage(bytes, options);
  const document = files.get('word/document.xml');
  if (!document) throw new Error('DOCX 缺少 word/document.xml。');
  const decode = (value: Buffer) => new TextDecoder('utf-8', { fatal: true }).decode(value);
  const parsed = parseWordXml(decode(document), files.has('word/styles.xml') ? decode(files.get('word/styles.xml')!) : undefined);
  if (!parsed.blocks.some(block => block.text.trim())) throw new Error('DOCX 正文为空，复杂对象不作为正文导入。');
  return { title: options.title, format: 'docx', encoding: null, chapters: splitManuscript(parsed.blocks), warnings: parsed.warnings };
}
