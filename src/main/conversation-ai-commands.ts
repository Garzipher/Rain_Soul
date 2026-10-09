import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiSettings } from './ai-settings';
import type { ConversationAiService } from './conversation-ai-service';
import type { ConversationDetail } from '../shared/conversations';
import { conversationAiPrepareRequestSchema, type ConversationAiPrepareRequest } from '../shared/conversation-ai';

const schemas = {
  prepareConversationAi: conversationAiPrepareRequestSchema,
  executeConversationAi: z.object({ confirmationToken: z.string(), requestHash: z.string(), confirmed: z.boolean() }).strict(),
  cancelConversationAi: z.object({ confirmationToken: z.string() }).strict(),
};
interface Frozen { request: ConversationAiPrepareRequest; draft: string; providerHash: string; requestHash: string; operationId: string; userMessageId: string; assistantMessageId: string }

/** 会话云请求不能绕过显式授权，也没有正文修改权限。 */
export class ConversationAiCommands {
  private readonly confirmations = new Map<string, Frozen>();
  private readonly active = new Map<string, AbortController>();
  private readonly running = new Set<Promise<unknown>>();
  constructor(private readonly store: { execute: (command: string, payload: unknown) => Promise<unknown> }, private readonly settings: { get: () => AiSettings }, private readonly service: ConversationAiService) {}
  accepts(command: string): boolean { return Object.hasOwn(schemas, command); }
  execute(command: string, payload: unknown): Promise<unknown> {
    const operation = this.run(command, payload); this.running.add(operation);
    void operation.then(() => this.running.delete(operation), () => this.running.delete(operation)); return operation;
  }
  private async read(request: ConversationAiPrepareRequest): Promise<ConversationDetail> {
    const detail = await this.store.execute('readConversation', { workId: request.workId, conversationId: request.conversationId }) as ConversationDetail;
    if (detail.id !== request.conversationId || detail.revision !== request.expectedRevision) throw new Error('会话已变化，请保存并重新预览确认。');
    return detail;
  }
  private async validate(frozen: Frozen, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const settings = this.settings.get();
    if (!settings.hasCredential || frozen.providerHash !== JSON.stringify(settings.provider)) throw new Error('模型配置已变化，请重新预览确认。');
    const detail = await this.read(frozen.request);
    signal.throwIfAborted();
    if (detail.draft !== frozen.draft) throw new Error('会话草稿已变化，请重新预览确认。');
    if (frozen.providerHash !== JSON.stringify(this.settings.get().provider)) throw new Error('模型配置已变化，请重新预览确认。');
  }
  private async run(command: string, payload: unknown): Promise<unknown> {
    if (!this.accepts(command)) throw new Error('未知会话 AI 命令。');
    if (command === 'cancelConversationAi') {
      const { confirmationToken } = schemas.cancelConversationAi.parse(payload);
      this.confirmations.delete(confirmationToken); this.service.cancel(confirmationToken); this.active.get(confirmationToken)?.abort(); return;
    }
    if (command === 'prepareConversationAi') {
      const request = schemas.prepareConversationAi.parse(payload), settings = this.settings.get();
      if (!settings.provider || !settings.hasCredential) throw new Error('请先在设置中配置云端模型及凭据。');
      const detail = await this.read(request);
      const prepared = this.service.prepare({ ...request, provider: settings.provider, draft: detail.draft, messages: detail.messages.map(({ role, content }) => ({ role, content })) });
      if (this.confirmations.size >= 100) { const oldest = this.confirmations.keys().next().value; if (oldest) { this.service.cancel(oldest); this.confirmations.delete(oldest); } }
      this.confirmations.set(prepared.confirmationToken, { request, draft: detail.draft, providerHash: JSON.stringify(settings.provider), requestHash: prepared.requestHash, operationId: randomUUID(), userMessageId: randomUUID(), assistantMessageId: randomUUID() });
      return prepared;
    }
    const request = schemas.executeConversationAi.parse(payload), frozen = this.confirmations.get(request.confirmationToken);
    if (!frozen || frozen.requestHash !== request.requestHash) throw new Error('会话确认已失效，请重新预览。');
    if (request.confirmed !== true) throw new Error('请先明确确认服务、会话范围和计费提示。');
    this.confirmations.delete(request.confirmationToken);
    const controller = new AbortController(); this.active.set(request.confirmationToken, controller);
    try {
      await this.validate(frozen, controller.signal);
      const reply = await this.service.execute(request, { signal: controller.signal, beforeSend: () => this.validate(frozen, controller.signal) });
      await this.validate(frozen, controller.signal);
      return await this.store.execute('appendConversationTurn', { workId: frozen.request.workId, conversationId: frozen.request.conversationId,
        expectedRevision: frozen.request.expectedRevision, operationId: frozen.operationId, userMessageId: frozen.userMessageId, assistantMessageId: frozen.assistantMessageId,
        userContent: frozen.draft, assistantContent: reply.text, requestHash: reply.requestHash });
    } finally { this.service.cancel(request.confirmationToken); this.active.delete(request.confirmationToken); }
  }
  async drain(): Promise<void> { await Promise.allSettled([...this.running]); }
}
