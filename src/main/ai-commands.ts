import { z } from 'zod';
import type { WorkDetail } from '../shared/contracts';
import type { AiCandidate, AiProvider } from '../shared/ai';
import { aiOperations } from '../shared/ai';
import { aiContextRequestSchema, buildAiContext } from '../shared/ai-context';
import type { AiService } from './ai-service';
import type { AiSettings } from './ai-settings';
import { buildAiReferences } from '../shared/ai-reference';
import { operationError } from '../shared/operation-errors';
import { aiKnowledgeApprovalSchema } from '../shared/ai-extraction';
const mutation = { workId: z.uuid(), candidateId: z.uuid(), operationId: z.uuid() };
const schemas = {
  getAiSettings: z.object({}).strict(),
  saveAiSettings: z.object({ provider: z.unknown(), key: z.string().optional() }).strict(), clearAiSettings: z.object({}).strict(),
  prepareAi: aiContextRequestSchema.extend({ workId: z.uuid(), operation: z.enum(aiOperations), instruction: z.string().max(10000).optional(), referenceKnowledgeIds: z.array(z.uuid()).max(5).refine(ids => new Set(ids).size === ids.length).optional() }).strict(),
  executeAi: z.object({ confirmationToken: z.string(), requestHash: z.string(), confirmed: z.boolean() }).strict(),
  cancelAi: z.object({ confirmationToken: z.string() }).strict(),
  applyAiCandidate: z.object(mutation).strict(),
  approveAiKnowledge: z.object({ ...mutation, items: z.array(aiKnowledgeApprovalSchema).min(1).max(100) }).strict(),
};
interface Settings { get: () => AiSettings; save: (provider: unknown, key?: string) => AiSettings; clear: () => void }
interface Frozen { workId: string; providerHash: string; requestHash: string }
export class AiCommands {
  private readonly confirmations = new Map<string, Frozen>();
  private readonly candidates = new Map<string, AiCandidate>();
  private readonly running = new Set<Promise<unknown>>();
  private readonly activeTokens = new Set<string>();
  private closing = false;
  constructor(private readonly store: { execute: (command: string, payload: unknown) => Promise<unknown> }, private readonly settings: Settings, private readonly service: AiService) {}
  accepts(command: string) { return Object.hasOwn(schemas, command); }
  execute(command: string, payload: unknown): Promise<unknown> {
    if (this.closing && command !== 'cancelAi') return Promise.reject(new Error('程序正在关闭，已停止新的 AI 操作。'));
    const operation = this.run(command, payload); this.running.add(operation);
    void operation.then(() => this.running.delete(operation), () => this.running.delete(operation)); return operation;
  }
  private async run(command: string, payload: unknown): Promise<unknown> {
    if (!this.accepts(command)) throw new Error('未知 AI 命令。');
    if (command === 'getAiSettings') { schemas.getAiSettings.parse(payload); return this.settings.get(); }
    if (command === 'saveAiSettings') { const request = schemas.saveAiSettings.parse(payload); return this.settings.save(request.provider, request.key); }
    if (command === 'clearAiSettings') { schemas.clearAiSettings.parse(payload); this.settings.clear(); return this.settings.get(); }
    if (command === 'cancelAi') { const request = schemas.cancelAi.parse(payload); this.service.cancel(request.confirmationToken); this.confirmations.delete(request.confirmationToken); return; }
    if (command === 'prepareAi') {
      const request = schemas.prepareAi.parse(payload), provider = this.settings.get().provider;
      if (!provider || !this.settings.get().hasCredential) throw new Error('请先在设置中配置云端模型及凭据。');
      if (request.operation === 'sentencePolish' && !request.sentenceText) throw new Error('单句润色请指定目标单句。');
      const work = await this.store.execute('freezeWork', { workId: request.workId }) as WorkDetail;
      if (this.closing) throw new Error('程序正在关闭，已取消 AI 请求。');
      const context = buildAiContext(work, { chapterId: request.chapterId, scope: request.scope, ...(request.chapterIds ? { chapterIds: request.chapterIds } : {}), ...(request.targetParagraphIds ? { targetParagraphIds: request.targetParagraphIds } : {}), ...(request.sentenceText ? { sentenceText: request.sentenceText } : {}), ...(request.sentenceFrom !== undefined ? { sentenceFrom: request.sentenceFrom } : {}) });
      if (['paragraphPolish', 'continue', 'correct'].includes(request.operation)) {
        const paragraphs = work.chapters.find(chapter => chapter.id === request.chapterId)!.document.content;
        const positions = context.paragraphIds.map(id => paragraphs.findIndex(paragraph => paragraph.attrs.id === id));
        if (positions.some((position, index) => position !== positions[0] + index)) throw new Error('正文候选请选择按顺序连续的目标段落，未发送请求。');
      }
      if (request.referenceKnowledgeIds?.some(id => !work.assets?.knowledge.some(entry => entry.id === id && !entry.deletedAt))) throw new Error('所选知识参考已变化或不属于当前作品，请重新选择。');
      const references = buildAiReferences(work, request.chapterId, context.text, context.referenceChapterIds, request.referenceKnowledgeIds);
      if (references) { context.text += `\n\n作者作品资料与知识参考：\n${references}`; context.scopeLabel += '；含范围内写作特点、大纲、伏笔及本作品匹配知识'; }
      const prepared = this.service.prepare({ provider, operation: request.operation, context, instruction: request.instruction });
      if (this.confirmations.size >= 100) { const oldest = this.confirmations.keys().next().value; if (oldest) { this.service.cancel(oldest); this.confirmations.delete(oldest); } }
      this.confirmations.set(prepared.confirmationToken, { workId: work.id, providerHash: JSON.stringify(provider), requestHash: prepared.requestHash });
      return prepared;
    }
    if (command === 'executeAi') {
      const request = schemas.executeAi.parse(payload), frozen = this.confirmations.get(request.confirmationToken);
      if (!frozen || frozen.requestHash !== request.requestHash) throw new Error('AI 确认已失效，请重新预览。');
      if (frozen.providerHash !== JSON.stringify(this.settings.get().provider)) { this.service.cancel(request.confirmationToken); this.confirmations.delete(request.confirmationToken); throw new Error('模型配置已变化，请重新预览确认。'); }
      await this.store.execute('freezeWork', { workId: frozen.workId });
      if (this.closing || !this.confirmations.has(request.confirmationToken)) { this.service.cancel(request.confirmationToken); throw new Error('AI 请求已取消。'); }
      this.confirmations.delete(request.confirmationToken);
      this.activeTokens.add(request.confirmationToken);
      try {
        const candidate = await this.service.execute(request);
        if (this.candidates.size >= 100) { const oldest = this.candidates.keys().next().value; if (oldest) this.candidates.delete(oldest); }
        this.candidates.set(candidate.id, structuredClone(candidate)); return candidate;
      } finally { this.activeTokens.delete(request.confirmationToken); }
    }
    const request = command === 'applyAiCandidate' ? schemas.applyAiCandidate.parse(payload) : schemas.approveAiKnowledge.parse(payload);
    const candidate = this.candidates.get(request.candidateId);
    if (!candidate || candidate.workId !== request.workId) throw operationError('候选不存在或不属于当前作品，请重新生成。', 'NOT_FOUND');
    return this.store.execute(command, { workId: request.workId, operationId: request.operationId, candidate, ...('items' in request ? { items: request.items } : {}) });
  }
  async drain() {
    this.closing = true;
    try {
      for (const token of this.confirmations.keys()) this.service.cancel(token);
      this.confirmations.clear();
      for (const token of this.activeTokens) this.service.cancel(token);
      await Promise.allSettled([...this.running]);
    } finally { this.closing = false; }
  }
}
export type AiSettingsProvider = AiProvider;
