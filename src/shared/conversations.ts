import { z } from 'zod';

export interface ConversationMessage { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; requestHash?: string }
export interface ConversationSummary { id: string; title: string; revision: number; createdAt: string; updatedAt: string; messageCount: number }
export interface ConversationDetail extends ConversationSummary { draft: string; messages: ConversationMessage[]; hasMore: boolean; nextBeforeMessageId?: string }
const id = z.uuid(), revision = z.number().int().positive();
const title = z.string().max(200).refine(value => !!value.trim(), '会话名称不能为空');
const content = z.string().min(1).max(200000).refine(value => !!value.trim(), '消息不能为空');
export const conversationMessageInputSchema = z.object({ id, role: z.enum(['user', 'assistant']), content, requestHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export const conversationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), id, title }).strict(),
  z.object({ type: z.literal('rename'), id, expectedRevision: revision, title }).strict(),
  z.object({ type: z.literal('delete'), id, expectedRevision: revision }).strict(),
  z.object({ type: z.literal('saveDraft'), id, expectedRevision: revision, draft: z.string().max(200000) }).strict(),
  z.object({ type: z.literal('appendMessage'), id, expectedRevision: revision, message: conversationMessageInputSchema, clearDraft: z.boolean().optional() }).strict(),
]);
export const conversationRequestSchema = z.object({ workId: id, operationId: id, action: conversationActionSchema }).strict();
export type ConversationAction = z.infer<typeof conversationActionSchema>;
export type ConversationRequest = z.infer<typeof conversationRequestSchema>;
/** 仅由主进程在真实回复到达后构造，不通过渲染层暴露 AI 消息写入口。 */
export const conversationTurnSchema = z.object({ workId: id, conversationId: id, expectedRevision: revision, operationId: id,
  userMessageId: id, assistantMessageId: id, userContent: content, assistantContent: content,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(value => value.userMessageId !== value.assistantMessageId, '两条消息身份不能相同');
export type ConversationTurnRequest = z.infer<typeof conversationTurnSchema>;
