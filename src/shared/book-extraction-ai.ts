import { z } from 'zod';
import type { AiExecuteRequest, AiPreparedRequest } from './ai';

export interface BookExtractionAiSuggestion {
  segmentId: string; excerpt: string; categoryId: string; tagIds: string[];
  technique: string; usage: string; exercise: string;
}
export interface BookExtractionAiResult {
  workId: string; previewToken: string; requestHash: string;
  suggestions: BookExtractionAiSuggestion[]; rawText: string; validationError?: string;
}
export const bookExtractionAiPrepareRequestSchema = z.object({
  workId: z.uuid(), token: z.uuid(),
  segmentIds: z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
  permissionConfirmed: z.literal(true),
}).strict();
export type BookExtractionAiPrepareRequest = z.infer<typeof bookExtractionAiPrepareRequestSchema>;
export const bookExtractionAiLookupSchema = z.object({
  workId: z.uuid(), previewToken: z.uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type BookExtractionAiLookup = z.infer<typeof bookExtractionAiLookupSchema>;
export type BookExtractionAiStatus = { status: 'running' | 'missing' } | { status: 'ready'; result: BookExtractionAiResult };
export interface BookExtractionAiApi {
  prepareBookExtractionAi(request: BookExtractionAiPrepareRequest): Promise<AiPreparedRequest>;
  executeBookExtractionAi(request: AiExecuteRequest): Promise<BookExtractionAiResult>;
  getBookExtractionAiResult(request: BookExtractionAiLookup): Promise<BookExtractionAiStatus>;
  cancelBookExtractionAi(confirmationToken: string): Promise<void>;
}
