import { z } from 'zod';
import { frozenSourceDocumentSchema } from './source-document';

export const knowledgeSourceLinkSchema = z.object({ entryId: z.uuid(), sourceId: z.uuid(), segmentId: z.uuid() }).strict();
export type KnowledgeSourceLink = z.infer<typeof knowledgeSourceLinkSchema>;
/** AI写法讲解与原著摘录分开保存；此处保存作者已审核、可编辑的讲解。 */
export const learningAnnotationPayloadSchema = z.object({
  technique: z.string().max(20000), usage: z.string().max(20000), exercise: z.string().max(20000),
}).strict();
export const learningAnnotationSchema = learningAnnotationPayloadSchema.extend({ id: z.uuid(), entryId: z.uuid() }).strict();
export type LearningAnnotation = z.infer<typeof learningAnnotationSchema>;
export const sourceAssetsSchema = z.object({
  documents: z.array(frozenSourceDocumentSchema), links: z.array(knowledgeSourceLinkSchema), annotations: z.array(learningAnnotationSchema),
}).strict();
export type SourceAssets = z.infer<typeof sourceAssetsSchema>;
