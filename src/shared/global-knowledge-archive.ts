import { z } from 'zod';
import { globalKnowledgeFrozenSchema } from './global-knowledge-schema';

export const globalKnowledgeArchiveManifestSchema = z.object({
  format: z.literal('rainsoulknowledge'), formatVersion: z.literal(1), schemaVersion: z.literal(1),
  exportedAt: z.iso.datetime({ offset: true }), libraryId: z.uuid(), dataSha256: z.string().regex(/^[a-f0-9]{64}$/), count: z.number().int().nonnegative().max(100000),
}).strict();
export type GlobalKnowledgeArchiveManifest = z.infer<typeof globalKnowledgeArchiveManifestSchema>;
/** 可移植包仅包含已审核正式资产，来源/学习注释沿用冻结契约。 */
export const globalKnowledgeArchiveDataSchema = globalKnowledgeFrozenSchema.superRefine((value, ctx) => {
  const entries = new Map(value.entries.map(entry => [entry.id, entry]));
  const categories = new Map(value.categories.map(item => [item.id, item])), tags = new Set(value.tags.map(item => item.id));
  const documents = new Map(value.sourceAssets.documents.map(item => [item.id, item]));
  const allIds = [...entries.keys(), ...categories.keys(), ...tags, ...documents.keys(), ...value.sourceAssets.documents.flatMap(item => item.segments.map(segment => segment.id)), ...value.sourceAssets.annotations.map(item => item.id)];
  const problem = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (value.entries.length > 100000 || new Set(allIds).size !== allIds.length || entries.size !== value.entries.length || categories.size !== value.categories.length || tags.size !== value.tags.length) problem('归档身份重复或条目超限');
  if (!value.categories.some(item => item.systemKey === 'uncategorized' && !item.deletedAt)) problem('归档缺少未分类');
  for (const item of value.categories) {
    if (item.deletedAt) problem('归档包含已删除分类');
    const visited = new Set<string>(); let cursor: string | null = item.id;
    while (cursor) { if (visited.has(cursor) || !categories.has(cursor)) { problem('归档分类循环或父分类缺失'); break; } visited.add(cursor); cursor = categories.get(cursor)!.parentId; }
  }
  if (value.tags.some(item => item.deletedAt)) problem('归档包含已删除标签');
  for (const entry of value.entries) {
    if (entry.deletedAt || !categories.has(entry.categoryId) || entry.tagIds.some(id => !tags.has(id))) problem('归档条目分类或标签关系无效');
    if (entry.sourceDocumentId && !documents.get(entry.sourceDocumentId)?.segments.some(segment => segment.id === entry.segmentId && segment.text === entry.body)) problem('归档摘录与来源原文不符');
    const links = value.sourceAssets.links.filter(link => link.entryId === entry.id);
    if (entry.sourceDocumentId ? links.length !== 1 || links[0].sourceId !== entry.sourceDocumentId || links[0].segmentId !== entry.segmentId : links.length !== 0) problem('归档来源关联不一致');
  }
  if (value.sourceAssets.links.some(link => !entries.has(link.entryId)) || value.sourceAssets.annotations.some(item => !entries.has(item.entryId))) problem('归档存在孤立关联或学习注释');
  const metadataIds = value.metadata.map(item => item.sourceDocumentId);
  if (new Set(metadataIds).size !== metadataIds.length || metadataIds.length !== documents.size || metadataIds.some(id => !documents.has(id))) problem('归档来源元数据不完整');
  for (const document of value.sourceAssets.documents) if (document.segments.some(segment => !value.entries.some(entry => entry.sourceDocumentId === document.id && entry.segmentId === segment.id))) problem('归档不允许携带未审核来源全文');
});
export type GlobalKnowledgeArchiveData = z.infer<typeof globalKnowledgeArchiveDataSchema>;
