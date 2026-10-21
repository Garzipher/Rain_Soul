import { z } from 'zod';
import type { AssetAction, AssetQuery, AssetRequest } from './assets';
import { learningAnnotationPayloadSchema } from './source-assets';

const id = z.uuid();
const name = z.string().trim().min(1, '名称不能为空');
const text = z.string();
const ids = z.array(id).refine(value => new Set(value).size === value.length, '不能重复选择');
const nullableId = id.nullable();
const direction = z.enum(['up', 'down']);
const style = z.object({ narrativePerson: text, pace: text, prohibited: z.array(text), referenceWorks: z.array(text) }).strict();
const knowledge = { body: z.string().refine(value => !!value.trim(), '知识内容不能为空'), source: text, categoryId: id, tagIds: ids,
  learningNotes: z.array(learningAnnotationPayloadSchema).max(100).optional() };
const evidence = { chapterId: id, paragraphId: nullableId, excerpt: text };
export const assetActionSchema: z.ZodType<AssetAction> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('createOutline'), kind: z.enum(['volume', 'chapter', 'detail']), parentId: nullableId, title: name }).strict(),
  z.object({ type: z.literal('updateOutline'), id, title: name, summary: text, chapterId: nullableId }).strict(),
  z.object({ type: z.literal('moveOutline'), id, direction }).strict(),
  z.object({ type: z.literal('deleteOutline'), id }).strict(),
  z.object({ type: z.literal('setOutlineKnowledge'), id, knowledgeIds: ids }).strict(),
  z.object({ type: z.literal('assignForeshadows'), id, foreshadowIds: ids }).strict(),
  z.object({ type: z.literal('createForeshadow'), name }).strict(),
  z.object({ type: z.literal('updateForeshadow'), id, name, status: z.enum(['未埋设', '已埋设', '已触发', '已回收', '废弃']), description: text, outlineId: nullableId }).strict(),
  z.object({ type: z.literal('deleteForeshadow'), id }).strict(),
  z.object({ type: z.literal('restoreForeshadow'), id }).strict(),
  z.object({ type: z.literal('addEvidence'), foreshadowId: id, kind: z.enum(['埋设', '触发', '回收']), ...evidence }).strict(),
  z.object({ type: z.literal('relinkEvidence'), id, ...evidence }).strict(),
  z.object({ type: z.literal('deleteEvidence'), id }).strict(),
  z.object({ type: z.literal('createCategory'), name, parentId: nullableId }).strict(),
  z.object({ type: z.literal('updateCategory'), id, name, parentId: nullableId }).strict(),
  z.object({ type: z.literal('moveCategory'), id, direction }).strict(),
  z.object({ type: z.literal('deleteCategory'), id, destinationId: nullableId }).strict(),
  z.object({ type: z.literal('createTag'), name }).strict(),
  z.object({ type: z.literal('deleteTag'), id }).strict(),
  z.object({ type: z.literal('createKnowledge'), ...knowledge }).strict(),
  z.object({ type: z.literal('updateKnowledge'), id, ...knowledge }).strict(),
  z.object({ type: z.literal('deleteKnowledge'), id }).strict(),
  z.object({ type: z.literal('publishStyle'), payload: style }).strict(),
  z.object({ type: z.literal('setChapterStyle'), chapterId: id, profileId: nullableId }).strict(),
]);
export const assetRequestSchema: z.ZodType<AssetRequest> = z.object({ workId: id, expectedRevision: z.number().int().positive(), operationId: id, action: assetActionSchema }).strict();
export const assetQuerySchema: z.ZodType<AssetQuery> = z.object({ text, mode: z.enum(['knowledge', 'all']), categoryId: nullableId.optional(), tagIds: ids.optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200).optional() }).strict();
