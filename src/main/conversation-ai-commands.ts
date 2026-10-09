import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiSettings } from './ai-settings';
import type { ConversationAiService } from './conversation-ai-service';
import type { ConversationDetail, ConversationTurnRequest } from '../shared/conversations';
import { conversationAiPrepareRequestSchema, type ConversationAiPrepareRequest, type PendingConversationReply } from '../shared/conversation-ai';
import { operationError } from '../shared/operation-errors';

const replyRequestSchema = z.object({ requestHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const schemas = {
  prepareConversationAi: conversationAiPrepareRequestSchema,
  executeConversationAi: z.object({ confirmationToken: z.string(), requestHash: z.string(), confirmed: z.boolean() }).strict(),
  cancelConversationAi: z.object({ confirmationToken: z.string() }).strict(),
  retryConversationReply: replyRequestSchema,
  readPendingConversationReply: replyRequestSchema, discardConversationReply: replyRequestSchema,
};
interface Frozen { request: ConversationAiPrepareRequest; draft: string; providerHash: string; requestHash: string; operationId: string; userMessageId: string; assistantMessageId: string }

/** 会话云请求不能绕过显式授权，也没有正文修改权限。 */
export class ConversationAiCommands {
  private readonly confirmations = new Map<string, Frozen>();
  private readonly active = new Map<string, AbortController>();
  private readonly activeHashes = new Set<string>();
  private readonly running = new Set<Promise<unknown>>();
  private readonly replies = new Map<string, { request: ConversationTurnRequest; committed: boolean }>();
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
    if (command === 'retryConversationReply') {
      const { requestHash } = schemas.retryConversationReply.parse(payload);
      this.assertCompleted(requestHash);
      if (!this.replies.has(requestHash)) throw operationError('未收到可恢复的完整回答，或本次运行的回答记录已失效；请先重新读取会话核对已保存消息。', 'NOT_FOUND');
      return this.persistReply(requestHash);
    }
    if (command === 'readPendingConversationReply' || command === 'discardConversationReply') {
      const { requestHash } = replyRequestSchema.parse(payload), entry = this.replies.get(requestHash);
      this.assertCompleted(requestHash);
      if (!entry) throw operationError('未收到可恢复的完整回答，或本次运行的回答记录已失效。', 'NOT_FOUND');
      const detail = await this.store.execute('readConversation', { workId: entry.request.workId, conversationId: entry.request.conversationId }) as ConversationDetail;
      if (command === 'discardConversationReply') { this.replies.delete(requestHash); return; }
      const result: PendingConversationReply = { workId: entry.request.workId, conversationId: entry.request.conversationId, requestHash,
        userContent: entry.request.userContent, assistantContent: entry.request.assistantContent, currentDraft: detail.draft, currentRevision: detail.revision, expectedRevision: entry.request.expectedRevision };
      return result;
    }
    if (command === 'cancelConversationAi') {
      const { confirmationToken } = schemas.cancelConversationAi.parse(payload);
      this.confirmations.delete(confirmationToken); this.service.cancel(confirmationToken); this.active.get(confirmationToken)?.abort(); return;
    }
    if (command === 'prepareConversationAi') {
      const request = schemas.prepareConversationAi.parse(payload), settings = this.settings.get();
      if (!settings.provider || !settings.hasCredential) throw new Error('请先在设置中配置云端模型及凭据。');
      this.assertReplyCapacity(request);
      const detail = await this.read(request);
      const prepared = this.service.prepare({ ...request, provider: settings.provider, draft: detail.draft, messages: detail.messages.map(({ role, content }) => ({ role, content })), totalMessageCount: detail.messageCount });
      if (this.confirmations.size >= 100) { const oldest = this.confirmations.keys().next().value; if (oldest) { this.service.cancel(oldest); this.confirmations.delete(oldest); } }
      this.confirmations.set(prepared.confirmationToken, { request, draft: detail.draft, providerHash: JSON.stringify(settings.provider), requestHash: prepared.requestHash, operationId: randomUUID(), userMessageId: randomUUID(), assistantMessageId: randomUUID() });
      return prepared;
    }
    const request = schemas.executeConversationAi.parse(payload), frozen = this.confirmations.get(request.confirmationToken);
    if (!frozen || frozen.requestHash !== request.requestHash) throw new Error('会话确认已失效，请重新预览。');
    if (request.confirmed !== true) throw new Error('请先明确确认服务、会话范围和计费提示。');
    this.assertCompleted(request.requestHash);
    this.assertReplyCapacity(frozen.request);
    this.confirmations.delete(request.confirmationToken);
    this.activeHashes.add(request.requestHash);
    const controller = new AbortController(); this.active.set(request.confirmationToken, controller);
    try {
      await this.validate(frozen, controller.signal);
      const reply = await this.service.execute(request, { signal: controller.signal, beforeSend: () => this.validate(frozen, controller.signal) });
      this.replies.set(reply.requestHash, { committed: false, request: { workId: frozen.request.workId, conversationId: frozen.request.conversationId,
        expectedRevision: frozen.request.expectedRevision, operationId: frozen.operationId, userMessageId: frozen.userMessageId, assistantMessageId: frozen.assistantMessageId,
        userContent: frozen.draft, assistantContent: reply.text, requestHash: reply.requestHash } });
      try { await this.validate(frozen, controller.signal); }
      catch { throw operationError('完整回答已收到，但会话或配置变化、保存检查未完成；请核对待保存回答，不会自动重新联网。', 'CONVERSATION_REPLY_PENDING'); }
      return await this.persistReply(reply.requestHash);
    } finally { this.service.cancel(request.confirmationToken); this.active.delete(request.confirmationToken); this.activeHashes.delete(request.requestHash); }
  }
  private assertCompleted(requestHash: string) { if (this.activeHashes.has(requestHash)) throw operationError('本次会话请求仍在进行，请稍后核对，不能判定没有回答或再次发送。', 'CONVERSATION_IN_PROGRESS'); }
  private assertReplyCapacity(request: ConversationAiPrepareRequest) {
    for (const entry of this.replies.values()) if (!entry.committed && entry.request.workId === request.workId && entry.request.conversationId === request.conversationId) throw operationError('此会话已有完整回答等待确认保存，请先重试保存回答；不会自动重新联网。', 'CONVERSATION_REPLY_PENDING');
    for (const [hash, entry] of this.replies) {
      if (this.replies.size + this.active.size < 100) break;
      if (entry.committed) this.replies.delete(hash);
    }
    if (this.replies.size + this.active.size >= 100) throw new Error('待保存的会话回答过多，请先重试保存已有回答。');
  }
  private async persistReply(requestHash: string): Promise<ConversationDetail> {
    const entry = this.replies.get(requestHash)!;
    try {
      const result = await this.store.execute('appendConversationTurn', structuredClone(entry.request)) as ConversationDetail;
      entry.committed = true; return result;
    } catch {
      throw operationError('完整回答已收到，但保存尚未确认；请重试保存回答，保持原操作标识且不会重新联网。', 'CONVERSATION_REPLY_PENDING');
    }
  }
  async drain(): Promise<void> { await Promise.allSettled([...this.running]); }
}
