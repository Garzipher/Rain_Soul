import { z } from 'zod';
import { globalEntryRefSchema, globalSourceMetadataSchema } from './global-knowledge-schema';
import type { WorkDetail } from './contracts';

/** 与跨作品来源分离；不存在虚构的来源作品 ID。 */
export const globalKnowledgeOriginSchema = z.object({
  kind: z.literal('global'), libraryId: z.uuid(), entryId: z.uuid(), revision: z.number().int().positive(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  metadata: z.array(globalSourceMetadataSchema).max(100),
}).strict();
export type GlobalKnowledgeOrigin = z.infer<typeof globalKnowledgeOriginSchema>;
export const globalWorkCopyRequestSchema = z.object({
  workId: z.uuid(), expectedRevision: z.number().int().positive(), operationId: z.uuid(),
  entries: z.array(globalEntryRefSchema).min(1).max(100)
    .refine(values => new Set(values.map(value => value.entryId)).size === values.length),
}).strict();
export type GlobalWorkCopyRequest = z.infer<typeof globalWorkCopyRequestSchema>;
export interface GlobalWorkCopyApi { freezeGlobalKnowledge(request: GlobalWorkCopyRequest): Promise<WorkDetail> }
