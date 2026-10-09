import { z } from 'zod';
import type { AiProvider } from './ai';

export const conversationAiPrepareRequestSchema = z.object({ workId: z.uuid(), conversationId: z.uuid(), expectedRevision: z.number().int().positive(), instruction: z.string().max(10000).optional() }).strict();
export type ConversationAiPrepareRequest = z.infer<typeof conversationAiPrepareRequestSchema>;
export interface ConversationAiInput extends ConversationAiPrepareRequest {
  provider: AiProvider; draft: string; messages: { role: 'user' | 'assistant'; content: string }[];
}
export interface ConversationAiReply { text: string; requestHash: string }
