import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AiSettings } from './ai-settings';
import type { AiExecuteRequest, AiPreparedRequest } from '../shared/ai';
import type { WorkDetail } from '../shared/contracts';
import type { BookExtractionPreview } from '../shared/book-extraction';
import { bookExtractionAiLookupSchema, bookExtractionAiPrepareRequestSchema, type BookExtractionAiPrepareRequest, type BookExtractionAiResult, type BookExtractionAiStatus } from '../shared/book-extraction-ai';
import type { BookExtractionAiInput, BookExtractionAiService } from './book-extraction-ai-service';

const schemas = {
  prepareBookExtractionAi: bookExtractionAiPrepareRequestSchema,
  executeBookExtractionAi: z.object({ confirmationToken: z.string().min(1).max(200), requestHash: z.string().min(1).max(200), confirmed: z.boolean() }).strict(),
  getBookExtractionAiResult: bookExtractionAiLookupSchema,
  cancelBookExtractionAi: z.object({ confirmationToken: z.string().min(1).max(200) }).strict(),
};
interface Frozen { request: BookExtractionAiPrepareRequest; prepared: AiPreparedRequest; baselineRevision: number; providerHash: string; previewHash: string; dictionaryHash: string }
interface Entry { frozen: Frozen; controller?: AbortController; result?: BookExtractionAiResult }
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dictionaries = (work: WorkDetail) => ({
  categories: (work.assets?.categories ?? []).filter(item => !item.deletedAt).map(({ id, name }) => ({ id, name })),
  tags: (work.assets?.tags ?? []).filter(item => !item.deletedAt).map(({ id, name }) => ({ id, name })),
});

/** 拆书 AI 与文件导入队列独立，回答仅缓存；任何写入都须经过人工摘选流程。 */
export class BookExtractionAiCommands {
  private readonly confirmations = new Map<string, Frozen>();
  private readonly entries = new Map<string, Entry>();
  private readonly tokenHashes = new Map<string, string>();
  private readonly attemptedHashes = new Set<string>();
  private readonly running = new Set<Promise<unknown>>();
  constructor(private readonly store: { execute: (command: string, payload: unknown) => Promise<unknown> }, private readonly settings: { get: () => AiSettings }, private readonly previews: { getPreview: (workId: string, token: string) => BookExtractionPreview }, private readonly service: BookExtractionAiService) {}
  accepts(command: string): boolean { return Object.hasOwn(schemas, command); }
  execute(command: string, payload: unknown): Promise<unknown> {
    const operation = this.run(command, payload); this.running.add(operation);
    void operation.then(() => this.running.delete(operation), () => this.running.delete(operation)); return operation;
  }
  private preview(request: BookExtractionAiPrepareRequest): BookExtractionPreview {
    const preview = this.previews.getPreview(request.workId, request.token);
    if (preview.workId !== request.workId || preview.token !== request.token) throw new Error('拆书预览已失效，请重新选择文件。');
    return preview;
  }
  private async work(workId: string): Promise<WorkDetail> {
    const work = await this.store.execute('freezeWork', { workId }) as WorkDetail;
    if (work.id !== workId || !Number.isInteger(work.revision) || work.revision < 1) throw new Error('仅允许当前作品的拆书分析。');
    return work;
  }
  private async interruptible<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('拆书请求已取消；未自动重新发送。'));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([operation, cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
  }
  private async validate(frozen: Frozen, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const settings = this.settings.get();
    if (!settings.hasCredential || fingerprint(settings.provider) !== frozen.providerHash) throw new Error('模型配置已变化，请重新预览确认。');
    if (fingerprint(this.preview(frozen.request)) !== frozen.previewHash) throw new Error('拆书预览已变化，请重新选择。');
    const work = await this.interruptible(this.work(frozen.request.workId), signal); signal.throwIfAborted();
    if (work.revision !== frozen.baselineRevision || fingerprint(dictionaries(work)) !== frozen.dictionaryHash) throw new Error('作品或分类标签已变化，请重新预览确认。');
    if (!this.settings.get().hasCredential || fingerprint(this.settings.get().provider) !== frozen.providerHash || fingerprint(this.preview(frozen.request)) !== frozen.previewHash) throw new Error('拆书预览或模型配置已变化，请重新确认。');
  }
  private async prepare(request: BookExtractionAiPrepareRequest): Promise<AiPreparedRequest> {
    const settings = this.settings.get();
    if (!settings.provider || !settings.hasCredential) throw new Error('请先在设置中配置云端模型及凭据。');
    if (this.entries.size >= 100) throw new Error('待审核拆书回答过多，请先核对或明确放弃已有结果。');
    if (this.attemptedHashes.size >= 1000) throw new Error('本次运行的拆书请求记录已达上限，请完成核对后重新启动。');
    const preview = this.preview(request), previewHash = fingerprint(preview), work = await this.work(request.workId), dictionary = dictionaries(work);
    if (fingerprint(this.preview(request)) !== previewHash || !this.settings.get().hasCredential || fingerprint(this.settings.get().provider) !== fingerprint(settings.provider)) throw new Error('拆书预览或模型配置已变化，请重新确认。');
    const selected = new Set(request.segmentIds), segments = preview.segments.filter(segment => selected.has(segment.id)).map(({ id, text }) => ({ id, text }));
    if (segments.length !== selected.size) throw new Error('所选拆书段落已失效，请重新选择。');
    const input: BookExtractionAiInput = { workId: work.id, previewToken: preview.token, baselineRevision: work.revision, provider: settings.provider, segments, ...dictionary };
    const prepared = this.service.prepare(input);
    if (this.entries.has(prepared.requestHash) || this.attemptedHashes.has(prepared.requestHash)) { this.service.cancel(prepared.confirmationToken); throw new Error('此拆书请求已执行或正在进行，请核对已有结果，禁止重复联网。'); }
    for (const [token, frozen] of this.confirmations) if (frozen.prepared.expiresAt <= Date.now()) { this.service.cancel(token); this.confirmations.delete(token); }
    if (this.confirmations.size >= 100) { this.service.cancel(prepared.confirmationToken); throw new Error('待确认拆书请求过多，请先取消旧请求。'); }
    this.confirmations.set(prepared.confirmationToken, { request, prepared: structuredClone(prepared), baselineRevision: work.revision, providerHash: fingerprint(settings.provider), previewHash, dictionaryHash: fingerprint(dictionary) });
    return prepared;
  }
  private async run(command: string, payload: unknown): Promise<unknown> {
    if (!this.accepts(command)) throw new Error('未知拆书 AI 命令。');
    if (command === 'cancelBookExtractionAi') {
      const { confirmationToken } = schemas.cancelBookExtractionAi.parse(payload), hash = this.tokenHashes.get(confirmationToken), entry = hash ? this.entries.get(hash) : undefined;
      this.confirmations.delete(confirmationToken); this.service.cancel(confirmationToken);
      if (entry?.controller) entry.controller.abort();
      else if (hash) { this.entries.delete(hash); this.tokenHashes.delete(confirmationToken); }
      return;
    }
    if (command === 'prepareBookExtractionAi') return this.prepare(schemas.prepareBookExtractionAi.parse(payload));
    if (command === 'getBookExtractionAiResult') {
      const lookup = schemas.getBookExtractionAiResult.parse(payload); await this.work(lookup.workId);
      const entry = this.entries.get(lookup.requestHash);
      if (!entry || entry.frozen.request.workId !== lookup.workId || entry.frozen.request.token !== lookup.previewToken) return { status: 'missing' } satisfies BookExtractionAiStatus;
      if (entry.controller) return { status: 'running' } satisfies BookExtractionAiStatus;
      try { await this.validate(entry.frozen, new AbortController().signal); }
      catch { entry.result!.validationError ??= '完整回答已保留，但作品、预览、配置或核对检查已变化；禁止应用，请核对原始回答。'; }
      return { status: 'ready', result: structuredClone(entry.result!) } satisfies BookExtractionAiStatus;
    }
    return this.send(schemas.executeBookExtractionAi.parse(payload));
  }
  private async send(request: AiExecuteRequest): Promise<BookExtractionAiResult> {
    const frozen = this.confirmations.get(request.confirmationToken);
    if (!frozen || frozen.prepared.requestHash !== request.requestHash) throw new Error('拆书确认已失效，请重新预览。');
    if (request.confirmed !== true) throw new Error('请先明确确认服务、发送范围和费用提示。');
    if (this.entries.has(request.requestHash) || this.attemptedHashes.has(request.requestHash)) throw new Error('此拆书请求已执行，禁止重复联网；请核对已有结果。');
    if (this.entries.size >= 100) throw new Error('待审核拆书回答过多，请先核对或明确放弃已有结果。');
    this.confirmations.delete(request.confirmationToken);
    const controller = new AbortController(), entry: Entry = { frozen, controller };
    this.entries.set(request.requestHash, entry); this.tokenHashes.set(request.confirmationToken, request.requestHash);
    try {
      await this.validate(frozen, controller.signal);
      const result = await this.service.execute(request, { signal: controller.signal, beforeSend: async () => {
        await this.validate(frozen, controller.signal);
        if (this.attemptedHashes.size >= 1000) throw new Error('拆书请求记录已达上限，请先完成核对。');
        this.attemptedHashes.add(request.requestHash);
      } });
      entry.result = structuredClone(result);
      try { await this.validate(frozen, controller.signal); }
      catch { entry.result.validationError = '完整回答已保留，但作品、预览、配置或后验检查已变化；禁止应用，请核对原始回答，未自动重新联网。'; }
      return structuredClone(entry.result);
    } finally {
      this.service.cancel(request.confirmationToken); entry.controller = undefined;
      if (!entry.result) { this.entries.delete(request.requestHash); this.tokenHashes.delete(request.confirmationToken); }
    }
  }
  async drain(): Promise<void> { await Promise.allSettled([...this.running]); }
}
