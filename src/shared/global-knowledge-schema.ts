import { z } from 'zod';
import { frozenSourceDocumentSchema } from './source-document';
import { learningAnnotationPayloadSchema, learningAnnotationSchema, sourceAssetsSchema } from './source-assets';
import type { GlobalKnowledgeMutation, GlobalExtractionCommit } from './global-knowledge';

const id = z.uuid(), revision = z.number().int().positive();
const ids = z.array(id).max(100).refine(values => new Set(values).size === values.length, '标签不能重复');
const name = z.string().trim().min(1).max(200);
const content = { body: z.string().min(1).max(20000).refine(value => !!value.trim()), source: z.string().max(6000), categoryId: id, tagIds: ids };
export const knowledgeLibraryTargetSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('work'), workId: id }).strict(), z.object({ kind: z.literal('global') }).strict()]);
export const knowledgeReferenceScopeSchema = z.union([knowledgeLibraryTargetSchema, z.object({ kind: z.literal('combined'), workId: id }).strict()]);
export const globalEntryRefSchema = z.object({ entryId: id, revision }).strict();
export const globalKnowledgeQuerySchema = z.object({ text: z.string().max(2000).optional(), categoryId: id.nullable().optional(), tagIds: ids.optional(), offset: z.number().int().nonnegative().max(1000000).optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
export const globalSourceMetadataSchema = z.object({
  author: z.string().max(200), workTitle: name, chapter: z.string().max(200),
  rightsBasis: z.enum(['owned', 'authorized', 'public-domain', 'open-license', 'public-excerpt']),
  capturedAt: z.iso.datetime({ offset: true }), verificationStatus: z.literal('verified'),
  metrics: z.array(z.object({ label: name, value: z.string().max(200), observedAt: z.iso.datetime({ offset: true }) }).strict()).max(20),
}).strict().superRefine((value, ctx) => {
  if (value.rightsBasis === 'public-excerpt' && (!value.author.trim() || !value.chapter.trim())) ctx.addIssue({ code: 'custom', message: '公开摘录必须核实作者和章节' });
});
export const globalKnowledgeMutationSchema: z.ZodType<GlobalKnowledgeMutation> = z.object({ operationId: id, expectedRevision: revision, action: z.discriminatedUnion('type', [
  z.object({ type: z.literal('createCategory'), name, parentId: id.nullable() }).strict(),
  z.object({ type: z.literal('updateCategory'), id, name, parentId: id.nullable() }).strict(),
  z.object({ type: z.literal('moveCategory'), id, direction: z.enum(['up', 'down']) }).strict(),
  z.object({ type: z.literal('deleteCategory'), id, destinationId: id.nullable() }).strict(),
  z.object({ type: z.literal('createTag'), name }).strict(), z.object({ type: z.literal('deleteTag'), id }).strict(),
  z.object({ type: z.literal('createKnowledge'), ...content }).strict(), z.object({ type: z.literal('updateKnowledge'), id, ...content }).strict(),
  z.object({ type: z.literal('deleteKnowledge'), id }).strict(),
]) }).strict();
export const globalExtractionCommitSchema: z.ZodType<GlobalExtractionCommit> = z.object({
  operationId: id, expectedRevision: revision, sourceDocument: frozenSourceDocumentSchema, metadata: globalSourceMetadataSchema,
  items: z.array(z.object({ segmentId: id, ...content, annotation: learningAnnotationPayloadSchema.optional() }).strict()).min(1).max(100)
    .refine(items => new Set(items.map(item => item.segmentId)).size === items.length, '同一段落不能重复审核'),
}).strict();
export const globalCategorySchema = z.object({ id, name, parentId: id.nullable(), sortOrder: z.number().int().nonnegative(), systemKey: z.string().nullable(), deletedAt: z.iso.datetime({ offset: true }).nullable() }).strict();
export const globalTagSchema = z.object({ id, name, deletedAt: z.iso.datetime({ offset: true }).nullable() }).strict();
export const globalKnowledgeEntrySchema = z.object({ id, ...content, origin: z.null(), revision, deletedAt: z.iso.datetime({ offset: true }).nullable(), reviewed: z.literal(true), sourceDocumentId: id.nullable(), segmentId: id.nullable() }).strict().refine(item => (item.sourceDocumentId === null) === (item.segmentId === null), '来源和段落身份必须同时存在');
export const globalKnowledgePageSchema = z.object({ libraryId: id, revision, entries: z.array(globalKnowledgeEntrySchema), categories: z.array(globalCategorySchema), tags: z.array(globalTagSchema), annotations: z.array(learningAnnotationSchema), total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().positive() }).strict();
export const globalKnowledgeFrozenSchema = z.object({ libraryId: id, revision, entries: z.array(globalKnowledgeEntrySchema), categories: z.array(globalCategorySchema), tags: z.array(globalTagSchema), sourceAssets: sourceAssetsSchema, metadata: z.array(globalSourceMetadataSchema.safeExtend({ sourceDocumentId: id })) }).strict();
export const globalFreezeRequestSchema = z.object({ entries: z.array(globalEntryRefSchema).min(1).max(100).refine(values => new Set(values.map(value => value.entryId)).size === values.length) }).strict();
export const globalUsageSchema = z.object({ operationId: id, workId: id, workRevision: revision, entries: z.array(globalEntryRefSchema).min(1).max(100) }).strict();
