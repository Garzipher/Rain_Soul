import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiSettings } from './ai-settings';
import type { AiPreparedRequest, AiExecuteRequest } from '../shared/ai';
import { globalBookExtractionAiPrepareSchema, globalBookExtractionAiLookupSchema, type GlobalBookExtractionAiPrepare,
  type GlobalBookExtractionAiResult, type GlobalBookExtractionAiStatus } from '../shared/global-book-extraction-ai';
import type { GlobalKnowledgePage } from '../shared/global-knowledge';
import type { GlobalExtractionDraft } from '../shared/global-book-extraction';
import type { GlobalBookExtractionCommands } from './global-book-extraction-commands';
import type { BookExtractionAiService } from './book-extraction-ai-service';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const executeSchema = z.object({ confirmationToken: z.string().min(1).max(200), requestHash: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.boolean() }).strict();
const cancelSchema = z.object({ confirmationToken: z.string().min(1).max(200) }).strict();
interface Frozen { request: GlobalBookExtractionAiPrepare; prepared: AiPreparedRequest; libraryId: string; revision: number;
  providerHash: string; sourceHash: string; dictionaryHash: string; categories: string[]; tags: string[] }
interface Active { frozen: Frozen; controller: AbortController; done: Promise<void>; result?: GlobalBookExtractionAiResult }
/** 全局拆书独立授权、可取消；AI 结果仅存本机草稿，永不直接写知识库。 */
export class GlobalBookExtractionAiCommands {
  private readonly pending = new Map<string, Frozen>();
  private readonly active = new Map<string, Active>();
  private readonly attempted = new Set<string>();
  private readonly running = new Set<Promise<unknown>>();
  constructor(private readonly global: { request(command: string, payload: unknown): Promise<unknown> },
    private readonly settings: { get(): AiSettings }, private readonly drafts: GlobalBookExtractionCommands,
    private readonly service: BookExtractionAiService) {}
  accepts(command: string) { return ['prepareGlobalBookExtractionAi', 'executeGlobalBookExtractionAi', 'getGlobalBookExtractionAiResult', 'cancelGlobalBookExtractionAi'].includes(command); }
  execute(command: string, payload: unknown): Promise<unknown> {
    const operation = this.run(command, payload); this.running.add(operation);
    void operation.then(() => this.running.delete(operation), () => this.running.delete(operation)); return operation;
  }
  private async library() {
    const page = await this.global.request('readGlobalKnowledge', { limit: 1 }) as GlobalKnowledgePage;
    return { page, dictionary: { categories: page.categories.filter(item => !item.deletedAt).map(({ id, name }) => ({ id, name })),
      tags: page.tags.filter(item => !item.deletedAt).map(({ id, name }) => ({ id, name })) } };
  }
  private async validate(frozen: Frozen, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const context = await this.drafts.getAiContext(frozen.request.token), { page, dictionary } = await this.library(), settings = this.settings.get();
    signal?.throwIfAborted();
    if (!settings.hasCredential || hash(settings.provider) !== frozen.providerHash || page.libraryId !== frozen.libraryId
      || hash(dictionary) !== frozen.dictionaryHash || hash(context.preview.source) !== frozen.sourceHash)
      throw new Error('来源、全局分类标签或模型配置已变化，请重新准备发送范围。');
    return context;
  }
  private async run(command: string, payload: unknown): Promise<unknown> {
    if (!this.accepts(command)) throw new Error('未知全局拆书 AI 命令。');
    if (command === 'cancelGlobalBookExtractionAi') {
      const { confirmationToken } = cancelSchema.parse(payload); this.pending.delete(confirmationToken); this.service.cancel(confirmationToken);
      const active = [...this.active.values()].find(item => item.frozen.prepared.confirmationToken === confirmationToken);
      if (active) { active.controller.abort(); await active.done; } return;
    }
    if (command === 'prepareGlobalBookExtractionAi') {
      const request = globalBookExtractionAiPrepareSchema.parse(payload), context = await this.drafts.getAiContext(request.token);
      const { page, dictionary } = await this.library(), settings = this.settings.get();
      if (!settings.provider || !settings.hasCredential) throw new Error('请先在设置配置云服务、模型和密钥。');
      if (this.attempted.size >= 1000 || this.active.size >= 100) throw new Error('本次拆书任务过多，请先核对并结束已有任务。');
      const selected = new Set(request.segmentIds), segments = context.preview.segments.filter(item => selected.has(item.id)).map(({ id, text }) => ({ id, text }));
      if (segments.length !== selected.size) throw new Error('所选原文段落已失效。');
      const prepared = this.service.prepareGlobal({ target: { kind: 'global', libraryId: page.libraryId }, previewToken: request.token,
        baselineRevision: page.revision, provider: settings.provider, segments, ...dictionary });
      const frozen: Frozen = { request, prepared, libraryId: page.libraryId, revision: page.revision,
        providerHash: hash(settings.provider), sourceHash: hash(context.preview.source), dictionaryHash: hash(dictionary),
        categories: dictionary.categories.map(item => item.id), tags: dictionary.tags.map(item => item.id) };
      try { await this.validate(frozen); } catch (error) { this.service.cancel(prepared.confirmationToken); throw error; }
      for (const [token, item] of this.pending) if (item.prepared.expiresAt <= Date.now()) { this.service.cancel(token); this.pending.delete(token); }
      if (this.pending.size >= 100) { this.service.cancel(prepared.confirmationToken); throw new Error('待确认请求过多，请先取消。'); }
      this.pending.set(prepared.confirmationToken, frozen); return prepared;
    }
    if (command === 'getGlobalBookExtractionAiResult') {
      const lookup = globalBookExtractionAiLookupSchema.parse(payload), active = this.active.get(lookup.requestHash);
      if (active?.frozen.request.token === lookup.previewToken && !active.result && !active.controller.signal.aborted) return { status: 'running' } satisfies GlobalBookExtractionAiStatus;
      const { preview, draft } = await this.drafts.getAiContext(lookup.previewToken);
      const batch = draft.batches.find(item => item.requestHash === lookup.requestHash && item.status === 'ready');
      if (!batch) return active?.result ? { status: 'ready', result: { ...active.result, validationError: active.result.validationError ?? '回答未能持久化，请复制原始回答；禁止带入审核。' } } : { status: 'missing' };
      const { page, dictionary } = await this.library();
      const result: GlobalBookExtractionAiResult = { target: { kind: 'global', libraryId: page.libraryId }, previewToken: lookup.previewToken,
        requestHash: lookup.requestHash, suggestions: batch.suggestions, rawText: batch.rawText ?? '', ...(batch.validationError ? { validationError: batch.validationError } : {}) };
      if (hash(dictionary) !== batch.dictionaryHash || preview.token !== draft.previewToken) result.validationError ??= '分类标签或来源已变化，禁止带入审核；原始回答已保留。';
      return { status: 'ready', result } satisfies GlobalBookExtractionAiStatus;
    }
    return this.send(executeSchema.parse(payload));
  }
  private async send(request: AiExecuteRequest) {
    const frozen = this.pending.get(request.confirmationToken);
    if (!frozen || frozen.prepared.requestHash !== request.requestHash || !request.confirmed) throw new Error('请重新确认服务、发送原文和费用。');
    this.pending.delete(request.confirmationToken);
    if (this.attempted.has(request.requestHash) || this.active.has(request.requestHash)) throw new Error('此请求已发送，请核对本机结果；不会重复联网。');
    await this.drafts.setAiBusy(frozen.request.token, true);
    let settle!: () => void;
    const active: Active = { frozen, controller: new AbortController(), done: new Promise<void>(resolve => { settle = resolve; }) };
    this.active.set(request.requestHash, active);
    const batch: GlobalExtractionDraft['batches'][number] = { id: randomUUID(), requestHash: request.requestHash, segmentIds: frozen.request.segmentIds,
      status: 'running', categoryIds: frozen.categories, tagIds: frozen.tags, dictionaryHash: frozen.dictionaryHash, suggestions: [], rawText: '' };
    let recorded = false;
    try {
      await this.validate(frozen, active.controller.signal);
      const result = await this.service.executeGlobal(request, { signal: active.controller.signal, beforeSend: async () => {
        await this.validate(frozen, active.controller.signal); await this.drafts.recordAiBatch(frozen.request.token, batch); recorded = true;
        await this.validate(frozen, active.controller.signal); this.attempted.add(request.requestHash);
      } });
      active.result = result;
      try { await this.validate(frozen); } catch { result.validationError ??= '来源、分类标签或模型配置已变化；仅保留回答，禁止带入审核。'; }
      try { await this.drafts.recordAiBatch(frozen.request.token, { ...batch, status: 'ready', suggestions: result.suggestions,
        rawText: result.rawText, ...(result.validationError ? { validationError: result.validationError } : {}) }); }
      catch { result.validationError ??= '回答尚未成功落盘，请复制原始回答；禁止带入审核。'; }
      return structuredClone(result);
    } catch (error) {
      if (recorded) await this.drafts.recordAiBatch(frozen.request.token, { ...batch, status: active.controller.signal.aborted ? 'cancelled' : 'failed' }).catch(() => {});
      throw error;
    } finally {
      this.service.cancel(request.confirmationToken);
      if (!active.result) this.active.delete(request.requestHash);
      await this.drafts.setAiBusy(frozen.request.token, false).catch(() => {});
      settle();
    }
  }
  async drain() {
    for (const item of this.active.values()) { item.controller.abort(); this.service.cancel(item.frozen.prepared.confirmationToken); }
    for (const token of this.pending.keys()) this.service.cancel(token);
    this.pending.clear(); await Promise.allSettled([...this.running]);
  }
}
