import { z } from 'zod';
import type { RetrievalModelStatus } from './retrieval-model';

export const retrievalQuerySchema = z.object({
  workId: z.uuid().nullable(), queryId: z.uuid(), query: z.string().trim().min(1).max(20000),
  mode: z.enum(['keyword', 'semantic', 'hybrid']), categoryId: z.uuid().optional(),
  tagIds: z.array(z.uuid()).max(100).refine(ids => new Set(ids).size === ids.length),
  page: z.number().int().min(1).max(10000), pageSize: z.number().int().min(1).max(100),
}).strict();
export type RetrievalQuery = z.infer<typeof retrievalQuerySchema>;
export interface RetrievalHit {
  workId: string; entryId: string; bodyHash: string; excerpt: string; source: string;
  matchedBy: ('keyword' | 'semantic')[]; reliable: boolean;
}
export interface RetrievalReply {
  queryId: string; hits: RetrievalHit[]; total: number; sourceRevisions: Record<string, number>;
  modelFingerprint: string | null; status: 'ready' | 'fallback' | 'indexing'; message?: string;
}
export interface RetrievalApi {
  queryKnowledge?(request: RetrievalQuery): Promise<RetrievalReply>;
  cancelKnowledgeQuery?(queryId: string): Promise<void>;
  getRetrievalModelStatus?(): Promise<RetrievalModelStatus>;
  importRetrievalModel?(): Promise<RetrievalModelStatus>;
  setRetrievalModelEnabled?(enabled: boolean): Promise<RetrievalModelStatus>;
  rebuildKnowledgeIndex?(workId: string | null): Promise<void>;
}
