import { z } from 'zod';
import type { Category, KnowledgeEntry, KnowledgeTag, SearchResult } from './assets';

export interface KnowledgeOwner { workId: string; workTitle: string; sourceRevision: number; sourceEntryId: string }
export interface KnowledgeScope { knowledge: KnowledgeEntry[]; categories: Category[]; tags: KnowledgeTag[]; entryOwners: Record<string, KnowledgeOwner> }
export interface KnowledgeScopeResult extends SearchResult { workId: string; workTitle: string }
export interface KnowledgeCopyRequest { workId: string; expectedRevision: number; operationId: string; sourceWorkId: string; sourceEntryId: string; sourceExpectedRevision: number; categoryId: string; tagIds: string[] }
export const knowledgeCopyRequestSchema: z.ZodType<KnowledgeCopyRequest> = z.object({
  workId: z.uuid(), expectedRevision: z.number().int().positive(), operationId: z.uuid(),
  sourceWorkId: z.uuid(), sourceEntryId: z.uuid(), sourceExpectedRevision: z.number().int().positive(),
  categoryId: z.uuid(), tagIds: z.array(z.uuid()).refine(ids => new Set(ids).size === ids.length, '标签不能重复'),
}).strict();
