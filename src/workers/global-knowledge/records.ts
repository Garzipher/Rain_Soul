import type Database from 'better-sqlite3';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { globalCategorySchema, globalKnowledgeEntrySchema, globalSourceMetadataSchema, globalTagSchema } from '../../shared/global-knowledge-schema';
import type { Category, KnowledgeTag } from '../../shared/assets';
import type { GlobalKnowledgeEntry, GlobalKnowledgeFrozen } from '../../shared/global-knowledge';
import { frozenSourceDocumentSchema, type FrozenSourceDocument } from '../../shared/source-document';
import { learningAnnotationSchema, type LearningAnnotation } from '../../shared/source-assets';
import { RepositoryError } from '../database/errors';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const fail = (message: string, code = 'INVALID_INPUT'): never => { throw new RepositoryError(code, message); };
type GlobalTable = 'global_category' | 'global_tag' | 'global_source_document' | 'global_source_segment' | 'global_knowledge_entry' | 'global_learning_annotation';
export function rows<T>(db: Database.Database, table: GlobalTable, schema: z.ZodType<T>): T[] {
  return (db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all() as { payload: string }[]).map(row => schema.parse(JSON.parse(row.payload)));
}
export const readCategories = (db: Database.Database): Category[] => rows(db, 'global_category', globalCategorySchema).sort((a, b) => a.sortOrder - b.sortOrder);
export const readTags = (db: Database.Database): KnowledgeTag[] => rows(db, 'global_tag', globalTagSchema);
export const readEntries = (db: Database.Database): GlobalKnowledgeEntry[] => rows(db, 'global_knowledge_entry', globalKnowledgeEntrySchema);
export const readAnnotations = (db: Database.Database): LearningAnnotation[] => rows(db, 'global_learning_annotation', learningAnnotationSchema);
export function putCategory(db: Database.Database, value: Category): void { db.prepare('INSERT OR REPLACE INTO global_category VALUES(?,?)').run(value.id, JSON.stringify(globalCategorySchema.parse(value))); }
export function putTag(db: Database.Database, value: KnowledgeTag): void { db.prepare('INSERT OR REPLACE INTO global_tag VALUES(?,?)').run(value.id, JSON.stringify(globalTagSchema.parse(value))); }
export function putEntry(db: Database.Database, value: GlobalKnowledgeEntry): void {
  const entry = globalKnowledgeEntrySchema.parse(value);
  db.prepare('INSERT OR REPLACE INTO global_knowledge_entry VALUES(?,?)').run(entry.id, JSON.stringify(entry));
  db.prepare('DELETE FROM global_search_document WHERE entry_id=?').run(entry.id); db.prepare('DELETE FROM global_search_fts WHERE entry_id=?').run(entry.id);
  if (!entry.deletedAt) { db.prepare('INSERT INTO global_search_document VALUES(?,?,?)').run(entry.id, entry.body, entry.source); db.prepare('INSERT INTO global_search_fts VALUES(?,?,?)').run(entry.id, entry.body, entry.source); }
}
export function verifySource(value: FrozenSourceDocument): FrozenSourceDocument {
  const source = frozenSourceDocumentSchema.parse(value);
  if (digest(JSON.stringify(source.segments.map(item => item.text))) !== source.bodyHash || source.segments.some(item => digest(item.text) !== item.textHash)) fail('全局来源哈希不匹配。');
  return source;
}
export function readSources(db: Database.Database, entries: GlobalKnowledgeEntry[]): Pick<GlobalKnowledgeFrozen, 'sourceAssets' | 'metadata'> {
  const sourceIds = new Set(entries.flatMap(entry => entry.sourceDocumentId ? [entry.sourceDocumentId] : []));
  const sourceRows = db.prepare('SELECT payload,metadata FROM global_source_document').all() as { payload: string; metadata: string }[];
  const selected = sourceRows.map(row => ({ document: verifySource(JSON.parse(row.payload)), metadata: globalSourceMetadataSchema.parse(JSON.parse(row.metadata)) })).filter(row => sourceIds.has(row.document.id));
  const documents = selected.map(row => {
    const segments = row.document.segments.filter(segment => entries.some(entry => entry.segmentId === segment.id)).map((segment, index) => ({ ...segment, ordinal: index + 1 }));
    return { ...row.document, segments, bodyHash: digest(JSON.stringify(segments.map(segment => segment.text))) };
  }), metadata = selected.map(row => ({ ...row.metadata, sourceDocumentId: row.document.id }));
  const entryIds = new Set(entries.map(entry => entry.id));
  const links = entries.filter(entry => entry.sourceDocumentId).map(entry => ({ entryId: entry.id, sourceId: entry.sourceDocumentId!, segmentId: entry.segmentId! }));
  if (links.some(link => !documents.some(document => document.id === link.sourceId && document.segments.some(segment => segment.id === link.segmentId && segment.text === entries.find(entry => entry.id === link.entryId)!.body)))) fail('全局知识来源关联损坏。');
  return { sourceAssets: { documents, links, annotations: readAnnotations(db).filter(item => entryIds.has(item.entryId)) }, metadata };
}
