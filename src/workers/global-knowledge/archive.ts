import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { globalKnowledgeArchiveDataSchema, type GlobalKnowledgeArchiveData } from '../../shared/global-knowledge-archive';
import { digest, putCategory, putEntry, putTag, readCategories, readSources, readTags, verifySource } from './records';
import type { GlobalKnowledgePage } from '../../shared/global-knowledge';

export function exportGlobalData(db: Database.Database, page: GlobalKnowledgePage): GlobalKnowledgeArchiveData {
  const assets = readSources(db, page.entries);
  const sourceAssets = { ...assets.sourceAssets, documents: assets.sourceAssets.documents.map(document => {
    const segments = document.segments.filter(segment => page.entries.some(entry => entry.segmentId === segment.id)).map((segment, index) => ({ ...segment, ordinal: index + 1 }));
    return { ...document, segments, bodyHash: digest(JSON.stringify(segments.map(segment => segment.text))) };
  }) };
  return globalKnowledgeArchiveDataSchema.parse({ libraryId: page.libraryId, revision: page.revision, entries: page.entries, categories: page.categories, tags: page.tags, sourceAssets, metadata: assets.metadata });
}

/** 全部身份重映射，导入总在一笔事务内完成，不覆盖同名现有条目。 */
export function importGlobalData(db: Database.Database, input: GlobalKnowledgeArchiveData): void {
  const data = globalKnowledgeArchiveDataSchema.parse(input), ids = new Map<string, string>();
  const map = (id: string): string => { if (!ids.has(id)) ids.set(id, randomUUID()); return ids.get(id)!; };
  const existingCategories = readCategories(db).filter(item => !item.deletedAt), existingTags = readTags(db).filter(item => !item.deletedAt);
  // 必要字典复用现有系统键；自定义同名分类以导入批次名保留，不覆盖。
  for (const category of data.categories) if (category.systemKey) { const existing = existingCategories.find(item => item.systemKey === category.systemKey); if (existing) ids.set(category.id, existing.id); }
  const batch = randomUUID().slice(0, 8);
  for (const category of data.categories) {
    if (category.systemKey && existingCategories.some(item => item.systemKey === category.systemKey)) continue;
    let name = category.name; const parentId = category.parentId ? map(category.parentId) : null;
    if (existingCategories.some(item => item.parentId === parentId && item.name === name)) name = `${name.slice(0, 180)}（导入 ${batch}）`;
    putCategory(db, { ...category, id: map(category.id), parentId, name, sortOrder: existingCategories.length + category.sortOrder });
  }
  for (const tag of data.tags) {
    const existing = existingTags.find(item => item.name.toLocaleLowerCase() === tag.name.toLocaleLowerCase());
    if (existing) ids.set(tag.id, existing.id); else putTag(db, { ...tag, id: map(tag.id) });
  }
  for (const document of data.sourceAssets.documents) {
    verifySource(document);
    const sourceId = map(document.id), segments = document.segments.map(segment => ({ ...segment, id: map(segment.id) }));
    const frozen = { ...document, id: sourceId, segments, ...(document.capture ? { capture: { ...document.capture, sourceId } } : {}) };
    const metadata = data.metadata.find(item => item.sourceDocumentId === document.id)!; const { sourceDocumentId: _sourceId, ...payload } = metadata; void _sourceId;
    db.prepare('INSERT INTO global_source_document VALUES(?,?,?)').run(sourceId, JSON.stringify(frozen), JSON.stringify(payload));
    for (const segment of segments) db.prepare('INSERT INTO global_source_segment VALUES(?,?,?)').run(segment.id, sourceId, JSON.stringify(segment));
  }
  for (const entry of data.entries) putEntry(db, { ...entry, id: map(entry.id), categoryId: map(entry.categoryId), tagIds: entry.tagIds.map(map), sourceDocumentId: entry.sourceDocumentId ? map(entry.sourceDocumentId) : null, segmentId: entry.segmentId ? map(entry.segmentId) : null });
  for (const annotation of data.sourceAssets.annotations) {
    const item = { ...annotation, id: map(annotation.id), entryId: map(annotation.entryId) };
    db.prepare('INSERT INTO global_learning_annotation VALUES(?,?,?)').run(item.id, item.entryId, JSON.stringify(item));
  }
}
