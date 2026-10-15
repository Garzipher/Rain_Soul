import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, readFile, open, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { globalExtractionDraftSchema, type GlobalExtractionDraft } from '../shared/global-book-extraction';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
/** 全局草稿独立命名；不创建特殊作品，不把未审核全文写进正式全局库。 */
export class GlobalExtractionDraftStore {
  private readonly root: string;
  constructor(directory: string) { this.root = resolve(directory); }
  private async path() {
    await mkdir(this.root, { recursive: true });
    const stat = await lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || resolve(await realpath(this.root)).toLowerCase() !== this.root.toLowerCase())
      throw new Error('全局拆书草稿目录无效。');
    return join(this.root, 'global-extraction.json');
  }
  async read(): Promise<GlobalExtractionDraft | null> {
    const path = await this.path();
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw new Error('全局拆书草稿文件无效。');
      const draft = globalExtractionDraftSchema.parse(JSON.parse(await readFile(path, 'utf8')));
      if (sha(JSON.stringify(draft.source.segments.map(segment => segment.text))) !== draft.source.bodyHash
        || draft.source.segments.some(segment => sha(segment.text) !== segment.textHash)) throw new Error('全局拆书草稿原文校验失败。');
      const pending = draft.committing?.sourceDocument;
      if (pending && (sha(JSON.stringify(pending.segments.map(segment => segment.text))) !== pending.bodyHash
        || pending.segments.some(segment => sha(segment.text) !== segment.textHash))) throw new Error('全局拆书待核对摘录校验失败。');
      return draft;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async save(value: GlobalExtractionDraft) {
    const draft = globalExtractionDraftSchema.parse(value), path = await this.path(), temporary = join(this.root, `global-extraction.${randomUUID()}.tmp`);
    const bytes = Buffer.from(JSON.stringify(draft));
    if (bytes.length > 32 * 1024 * 1024) throw new Error('全局拆书草稿容量超限。');
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
  }
  async discard() { await unlink(await this.path()).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}
