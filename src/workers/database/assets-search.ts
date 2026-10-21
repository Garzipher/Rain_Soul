import type Database from 'better-sqlite3';
import type { AssetQuery, SearchResult } from '../../shared/assets';
import { assetQuerySchema } from '../../shared/assets-schema';
import { validateDocument } from '../../shared/document';
import { assetDescendants, assetRow } from './assets-common';
import { RepositoryError } from './errors';
import { recordAssetHistory } from './assets-history';
import { readableKnowledgeSource } from '../../shared/knowledge-source';
import { learningAnnotationPayloadSchema } from '../../shared/source-assets';

const normalize = (text: string) => text.normalize('NFC').toLowerCase();
const hasAnnotations = (db: Database.Database) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='learning_annotation'").get();
const repairedLearningIndexes = new WeakSet<Database.Database>();
const insertSearch = (db: Database.Database, id: string, kind: 'knowledge' | 'paragraph', chapterId: string | null, paragraphId: string | null, title: string, body: string, source: string, labels = '') =>
  db.prepare('INSERT INTO search_document VALUES(?,?,?,?,?,?,?,?)').run(id, kind, chapterId, paragraphId, title, body, source, normalize(`${body}\n${source}\n${labels}`));

export function refreshChapterSearch(db: Database.Database, chapterId: string): void {
  db.prepare('DELETE FROM search_document WHERE chapter_id=?').run(chapterId);
  const chapter = db.prepare('SELECT title,document_json,deleted_at FROM chapter WHERE id=?').get(chapterId) as { title: string; document_json: string; deleted_at: string | null } | undefined;
  if (!chapter || chapter.deleted_at) {
    const revision = (db.prepare('SELECT revision FROM work_meta').get() as { revision: number } | undefined)?.revision ?? 1;
    for (const outline of db.prepare('SELECT id FROM outline_node WHERE chapter_id=? AND deleted_at IS NULL').all(chapterId) as { id: string }[]) recordAssetHistory(db, 'outline_node', outline.id, revision);
    db.prepare('UPDATE outline_node SET chapter_id=NULL WHERE chapter_id=? AND deleted_at IS NULL').run(chapterId);
    return;
  }
  for (const paragraph of validateDocument(JSON.parse(chapter.document_json)).content) {
    const body = (paragraph.content ?? []).map(node => node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : '').join('');
    if (body.length) insertSearch(db, `p:${chapterId}:${paragraph.attrs.id}`, 'paragraph', chapterId, paragraph.attrs.id, chapter.title, body, chapter.title);
  }
}
export function refreshKnowledgeSearch(db: Database.Database, entryId?: string): void {
  if (entryId) db.prepare("DELETE FROM search_document WHERE id=? AND kind='knowledge'").run(`k:${entryId}`);
  else db.prepare("DELETE FROM search_document WHERE kind='knowledge'").run();
  const entries = db.prepare(`SELECT id,body,source FROM knowledge_entry WHERE deleted_at IS NULL${entryId ? ' AND id=?' : ''}`)
    .all(...(entryId ? [entryId] : [])) as { id: string; body: string; source: string }[];
  for (const entry of entries) {
    const labels = (db.prepare('SELECT t.name FROM tag t JOIN knowledge_tag kt ON kt.tag_id=t.id WHERE kt.entry_id=? AND t.deleted_at IS NULL ORDER BY t.id').all(entry.id) as { name: string }[]).map(tag => tag.name).join('\n');
    const notes = hasAnnotations(db) ? db.prepare('SELECT payload_json AS payload FROM learning_annotation WHERE entry_id=? ORDER BY rowid').all(entry.id) as { payload: string }[] : [];
    const annotationText = notes.map(row => {
      const note = learningAnnotationPayloadSchema.parse(JSON.parse(row.payload));
      return [note.technique, note.usage, note.exercise].join('\n');
    }).join('\n');
    insertSearch(db, `k:${entry.id}`, 'knowledge', null, null, '', entry.body, readableKnowledgeSource(entry.source), `${labels}\n${annotationText}`);
  }
}
export function rebuildAssetSearch(db: Database.Database): void {
  db.transaction(() => {
    db.prepare('DELETE FROM search_document').run();
    for (const chapter of db.prepare('SELECT id FROM chapter WHERE deleted_at IS NULL').all() as { id: string }[]) refreshChapterSearch(db, chapter.id);
    refreshKnowledgeSearch(db);
  })();
}
/** 兼容已安装作品的旧索引；只修正可确认的审计后缀，不改作者原始来源。 */
function repairKnowledgeSourceIndex(db: Database.Database): void {
  const stale = (db.prepare("SELECT id,source FROM search_document WHERE kind='knowledge' AND instr(source,'AI 审核来源：')>0").all() as { id: string; source: string }[])
    .filter(row => readableKnowledgeSource(row.source) !== row.source);
  if (stale.length) db.transaction(() => {
    for (const row of stale) refreshKnowledgeSearch(db, row.id.slice(2));
  }).immediate();
}
/** 旧安装库的学习注释已保存但未索引；按内容检测，仅修复缺失条目。 */
function repairLearningNoteIndex(db: Database.Database): void {
  if (repairedLearningIndexes.has(db) || !hasAnnotations(db)) return;
  const rows = db.prepare("SELECT a.entry_id AS id,a.payload_json AS payload,d.normalized_text AS text FROM learning_annotation a JOIN knowledge_entry k ON k.id=a.entry_id LEFT JOIN search_document d ON d.id='k:'||a.entry_id WHERE k.deleted_at IS NULL").all() as { id: string; payload: string; text: string | null }[];
  const stale = new Set(rows.filter(row => {
    const note = learningAnnotationPayloadSchema.parse(JSON.parse(row.payload));
    return [note.technique, note.usage, note.exercise].some(value => value && !row.text?.includes(normalize(value)));
  }).map(row => row.id));
  if (stale.size) db.transaction(() => { for (const id of stale) refreshKnowledgeSearch(db, id); }).immediate();
  repairedLearningIndexes.add(db);
}
export function searchAssets(db: Database.Database, input: AssetQuery): SearchResult[] {
  const parsed = assetQuerySchema.safeParse(input);
  if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '搜索条件无效。');
  const query = parsed.data;
  const tags = query.tagIds ?? [];
  for (const id of tags) assetRow(db, 'tag', id);
  const categoryIds = query.categoryId ? (assetRow(db, 'category', query.categoryId), assetDescendants(db, 'category', query.categoryId)) : [];
  repairKnowledgeSourceIndex(db);
  repairLearningNoteIndex(db);
  const text = normalize(query.text.trim());
  const conditions: string[] = []; const values: (string | number)[] = [];
  if (query.mode === 'knowledge') conditions.push("d.kind='knowledge'");
  if (text) {
    if (Array.from(text).length >= 3 && !text.includes('\0')) {
      conditions.push('d.rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?)');
      values.push(`"${text.replaceAll('"', '""')}"`);
    }
    conditions.push('instr(d.normalized_text,?)>0'); values.push(text);
  }
  const knowledgeFilters = ['k.id IS NOT NULL', 'k.deleted_at IS NULL'];
  if (categoryIds.length) { knowledgeFilters.push(`k.category_id IN (${categoryIds.map(() => '?').join(',')})`); values.push(...categoryIds); }
  for (const tagId of tags) { knowledgeFilters.push('EXISTS (SELECT 1 FROM knowledge_tag kt WHERE kt.entry_id=k.id AND kt.tag_id=?)'); values.push(tagId); }
  conditions.push(`((d.kind='paragraph' AND c.id IS NOT NULL AND c.deleted_at IS NULL) OR (d.kind='knowledge' AND ${knowledgeFilters.join(' AND ')}))`);
  values.push(query.limit ?? 100, query.offset ?? 0);
  const rows = db.prepare(`SELECT CASE WHEN d.kind='knowledge' THEN substr(d.id,3) ELSE d.paragraph_id END AS id,d.kind,d.chapter_id AS chapterId,
    d.paragraph_id AS paragraphId,d.title,d.body,d.source FROM search_document d
    LEFT JOIN knowledge_entry k ON k.id=CASE WHEN d.kind='knowledge' THEN substr(d.id,3) ELSE NULL END LEFT JOIN chapter c ON c.id=d.chapter_id
    WHERE ${conditions.join(' AND ')} ORDER BY d.kind,d.id LIMIT ? OFFSET ?`).all(...values) as (Omit<SearchResult, 'snippet'> & { body: string })[];
  return rows.map(({ body, ...row }) => {
    const start = text ? Math.max(0, normalize(body).indexOf(text) - 40) : 0;
    return { ...row, snippet: `${start ? '…' : ''}${body.slice(start, start + 240)}${body.length > start + 240 ? '…' : ''}` };
  });
}
