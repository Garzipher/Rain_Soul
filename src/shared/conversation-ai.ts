import { z } from 'zod';
import type { AiProvider } from './ai';

export const conversationAiPrepareRequestSchema = z.object({ workId: z.uuid(), conversationId: z.uuid(), expectedRevision: z.number().int().positive(), instruction: z.string().max(10000).optional() }).strict();
export type ConversationAiPrepareRequest = z.infer<typeof conversationAiPrepareRequestSchema>;
export interface ConversationAiInput extends ConversationAiPrepareRequest {
  provider: AiProvider; draft: string; messages: { role: 'user' | 'assistant'; content: string }[]; totalMessageCount?: number;
}
export interface ConversationAiReply { text: string; requestHash: string }
export interface PendingConversationReply {
  workId: string; conversationId: string; requestHash: string; userContent: string; assistantContent: string;
  currentDraft: string; currentRevision: number; expectedRevision: number;
  /** 已写入独立恢复文件，可在切页或下次启动后继续保存。 */
  durable?: boolean;
}
