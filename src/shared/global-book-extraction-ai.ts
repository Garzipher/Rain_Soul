import { z } from 'zod';
import type { AiExecuteRequest, AiPreparedRequest } from './ai';
import type { BookExtractionAiSuggestion } from './book-extraction-ai';
export const globalBookExtractionAiPrepareSchema = z.object({ token: z.uuid(),
  segmentIds: z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
  permissionConfirmed: z.literal(true),
}).strict();
export const globalBookExtractionAiLookupSchema = z.object({ previewToken: z.uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type GlobalBookExtractionAiPrepare = z.infer<typeof globalBookExtractionAiPrepareSchema>;
export type GlobalBookExtractionAiLookup = z.infer<typeof globalBookExtractionAiLookupSchema>;
export interface GlobalBookExtractionAiResult {
  target: { kind: 'global'; libraryId: string }; previewToken: string; requestHash: string;
  suggestions: BookExtractionAiSuggestion[]; rawText: string; validationError?: string;
}
export type GlobalBookExtractionAiStatus = { status: 'running' | 'missing' } | { status: 'ready'; result: GlobalBookExtractionAiResult };
export interface GlobalBookExtractionAiApi {
  prepareGlobalBookExtractionAi(request: GlobalBookExtractionAiPrepare): Promise<AiPreparedRequest>;
  executeGlobalBookExtractionAi(request: AiExecuteRequest): Promise<GlobalBookExtractionAiResult>;
  getGlobalBookExtractionAiResult(request: GlobalBookExtractionAiLookup): Promise<GlobalBookExtractionAiStatus>;
  cancelGlobalBookExtractionAi(confirmationToken: string): Promise<void>;
}
