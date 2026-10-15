import { z } from 'zod';

export const aiOperations = ['sentencePolish', 'paragraphPolish', 'continue', 'correct', 'consistency', 'plotFeel', 'extractKnowledge'] as const;
export type AiOperation = typeof aiOperations[number];
export interface AiProvider { id: string; name: string; baseUrl: string; model: string; billingHint?: string; contextWindowTokens?: number; enabled?: boolean }
export interface AiSelection { paragraphId: string; from: number; to: number; text: string }
export interface AiContext { workId: string; baselineRevision: number; paragraphIds: string[]; scopeLabel: string; text: string; selection?: AiSelection; referenceChapterIds?: string[] }
export interface AiPrepareRequest { provider: AiProvider; operation: AiOperation; context: AiContext; instruction?: string; maxOutputTokens?: number }
export interface AiPreparedRequest {
  confirmationToken: string; requestHash: string; expiresAt: number; service: string; model: string;
  scopeLabel: string; previewText: string; paragraphIds: string[]; billingHint: string; estimatedInputTokens: number; maxOutputTokens: number;
}
export interface AiExecuteRequest { confirmationToken: string; requestHash: string; confirmed: boolean }
export interface AiCandidate { id: string; operation: AiOperation; workId: string; baselineRevision: number; paragraphIds: string[]; text: string; requestHash: string; createdAt: string; selection?: AiSelection; referenceChapterIds?: string[]; referenceNotice?: string }
export const aiPrepareRequestSchema: z.ZodType<AiPrepareRequest> = z.object({
  provider: z.object({ id: z.string().min(1).max(120), name: z.string().min(1).max(120), baseUrl: z.string().min(1).max(2048), model: z.string().min(1).max(120), billingHint: z.string().max(500).optional(), contextWindowTokens: z.number().int().min(1024).max(2_000_000).optional(), enabled: z.boolean().optional() }).strict(),
  operation: z.enum(aiOperations),
  context: z.object({ workId: z.uuid(), baselineRevision: z.number().int().positive(), paragraphIds: z.array(z.uuid()).min(1).max(50000).refine(ids => new Set(ids).size === ids.length), scopeLabel: z.string().min(1).max(300), text: z.string().min(1).max(200000), referenceChapterIds: z.array(z.uuid()).min(1).max(50000).optional(), selection: z.object({ paragraphId: z.uuid(), from: z.number().int().min(0), to: z.number().int().min(0), text: z.string().min(1) }).strict().refine(value => value.to > value.from && value.to - value.from === value.text.length, '单句范围不匹配').optional() }).strict(),
  instruction: z.string().max(10000).optional(), maxOutputTokens: z.number().int().min(1).max(32768).optional(),
}).strict();
