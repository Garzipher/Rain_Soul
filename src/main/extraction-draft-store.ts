import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { extractionDraftSchema, extractionDraftSaveSchema, type ExtractionDraft } from '../shared/extraction-draft';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const queues = new Map<string, Promise<unknown>>();
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
interface DraftDependencies { rename?: typeof rename }
/** 临时任务仅保存在本机；读回不会发送网络请求或恢复旧授权。 */
export class ExtractionDraftStore {
  private readonly root: string;
  constructor(root: string, private readonly dependencies: DraftDependencies = {}) { this.root = resolve(root); }
  private async location(workId: string): Promise<string> {
    z.uuid().parse(workId);
    await mkdir(this.root, { recursive: true });
    const directory = await lstat(this.root);
    if (!directory.isDirectory() || directory.isSymbolicLink() || resolve(await realpath(this.root)).toLowerCase() !== this.root.toLowerCase())
      throw new Error('拆文草稿目录路径无效。');
    return join(this.root, `${workId}.json`);
  }
  private serial<T>(workId: string, action: () => Promise<T>): Promise<T> {
    const key = join(this.root, z.uuid().parse(workId));
    const result = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    queues.set(key, result);
    void result.finally(() => { if (queues.get(key) === result) queues.delete(key); }).catch(() => {});
    return result;
  }
  private validate(value: unknown): ExtractionDraft {
    const draft = extractionDraftSchema.parse(value);
    if (sha(JSON.stringify(draft.source.segments.map(segment => segment.text))) !== draft.source.bodyHash
      || draft.source.segments.some(segment => sha(segment.text) !== segment.textHash)) throw new Error('拆文草稿原文哈希损坏。');
    if (draft.committing && sha(JSON.stringify(['book-extraction', draft.committing.request])) !== draft.committing.requestHash)
      throw new Error('拆文草稿提交请求哈希损坏。');
    return draft;
  }
  private async read(workId: string): Promise<ExtractionDraft | null> {
    const path = await this.location(workId);
    let content: string;
    try {
      const file = await lstat(path);
      if (!file.isFile() || file.isSymbolicLink()) throw new Error('拆文草稿文件路径无效。');
      if (file.size > 32 * 1024 * 1024) throw new Error('拆文草稿文件损坏或过大。');
      content = await readFile(path, 'utf8');
    } catch (error) { if (missing(error)) return null; throw error; }
    let draft: ExtractionDraft;
    try { draft = this.validate(JSON.parse(content)); }
    catch { throw new Error('拆文草稿损坏，请保留文件并重新选择素材。'); }
    if (draft.workId !== workId) throw new Error('拆文草稿作品身份损坏。');
    // 授权不入协议；未完成批次只恢复为取消状态，必须重新获得发送授权。
    return { ...draft, batches: draft.batches.map(batch => batch.status === 'running' ? { ...batch, status: 'cancelled' } : batch) };
  }
  async readExtractionDraft(workId: string): Promise<ExtractionDraft | null> { return this.serial(workId, () => this.read(workId)); }
  async saveExtractionDraft(value: unknown): Promise<ExtractionDraft> {
    return this.save(value);
  }
  /** 仅主进程回执协调器调用；hash/操作身份CAS使晚回执无法清空后续请求。 */
  async settleExtractionDraft(value: unknown, expectedOperationId: string, expectedCommittingHash: string): Promise<ExtractionDraft> {
    z.uuid().parse(expectedOperationId); z.string().regex(/^[a-f0-9]{64}$/).parse(expectedCommittingHash);
    return this.save(value,{operationId:expectedOperationId,requestHash:expectedCommittingHash});
  }
  private async save(value: unknown, settlement?: {operationId:string;requestHash:string}): Promise<ExtractionDraft> {
    const request = extractionDraftSaveSchema.parse(value), draft = this.validate(request.draft);
    return this.serial(draft.workId, async () => {
      const current = await this.read(draft.workId);
      if ((current?.taskId ?? null) !== request.expectedTaskId) throw new Error('拆文任务已被替换，请重新读取草稿。');
      if (settlement) {
        if (!current?.committing || current.committing.request.operationId!==settlement.operationId || current.committing.requestHash!==settlement.requestHash
          || draft.committing!==null || draft.taskId!==current.taskId) throw new Error('入库回执已变化，不能清除新的冻结请求。');
      } else if (current?.committing && (draft.taskId!==current.taskId || JSON.stringify(current.committing)!==JSON.stringify(draft.committing)))
        throw new Error('待核对入库回执的冻结请求不能改写或清除。');
      if (current?.taskId === draft.taskId && (current.previewToken !== draft.previewToken || JSON.stringify(current.source) !== JSON.stringify(draft.source)))
        throw new Error('同一拆文任务不能替换冻结来源。');
      if (current?.taskId === draft.taskId && current.committing && draft.committing && JSON.stringify(current.committing) !== JSON.stringify(draft.committing))
        throw new Error('待核对入库回执的冻结请求不能改写。');
      const path = await this.location(draft.workId), temporary = join(this.root, `${draft.workId}.${randomUUID()}.tmp`);
      const bytes = Buffer.from(JSON.stringify(draft));
      if (bytes.length > 32 * 1024 * 1024) throw new Error('拆文草稿容量超过限制。');
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await (this.dependencies.rename ?? rename)(temporary, path);
      } finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error; }); }
      return structuredClone(draft);
    });
  }
  async discardExtractionDraft(workId: string, taskId: string): Promise<void> {
    z.uuid().parse(taskId);
    return this.serial(workId, async () => {
      const current = await this.read(workId);
      if (!current) return;
      if (current.taskId !== taskId) throw new Error('拆文任务已被替换，不能删除新的草稿。');
      if (current.committing) throw new Error('待核对入库回执的冻结请求不能删除。');
      await unlink(await this.location(workId));
    });
  }
}
