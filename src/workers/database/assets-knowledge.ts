import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AssetAction, KnowledgeEntry, KnowledgeOrigin } from '../../shared/assets';
import { assetDescendants, assetRow, moveAsset, nextAssetOrder } from './assets-common';
import { RepositoryError } from './errors';
import { refreshKnowledgeSearch } from './assets-search';

interface CategoryRow { id: string; parent_id: string | null; system_key: string | null }
function categoryParent(db: Database.Database, id: string | null) { if (id !== null) assetRow(db, 'category', id); }
function tags(db: Database.Database, ids: string[]) { for (const id of ids) assetRow(db, 'tag', id); }
export function writeKnowledge(db: Database.Database, id: string, body: string, source: string, categoryId: string, tagIds: string[], revision: number, origin: KnowledgeOrigin | null, create: boolean) {
  assetRow(db, 'category', categoryId); tags(db, tagIds);
  if (create) db.prepare('INSERT INTO knowledge_entry(id,body,source,category_id,origin_json,revision) VALUES(?,?,?,?,?,?)').run(id, body, source, categoryId, origin ? JSON.stringify(origin) : null, revision);
  else {
    assetRow(db, 'knowledge_entry', id);
    db.prepare('UPDATE knowledge_entry SET body=?,source=?,category_id=?,revision=? WHERE id=?').run(body, source, categoryId, revision, id);
    db.prepare('DELETE FROM knowledge_tag WHERE entry_id=?').run(id);
  }
  for (const tagId of tagIds) db.prepare('INSERT INTO knowledge_tag VALUES(?,?)').run(id, tagId);
  db.prepare('INSERT INTO knowledge_history VALUES(?,?,?,?)').run(id, revision, body, source);
  refreshKnowledgeSearch(db, id);
}
export function applyKnowledgeAsset(db: Database.Database, action: AssetAction, revision: number): boolean {
  switch (action.type) {
    case 'createCategory':
      categoryParent(db, action.parentId);
      db.prepare('INSERT INTO category(id,name,parent_id,sort_order) VALUES(?,?,?,?)').run(randomUUID(), action.name, action.parentId, nextAssetOrder(db, 'category', action.parentId)); return true;
    case 'updateCategory': {
      const current = assetRow<CategoryRow>(db, 'category', action.id);
      if (current.system_key === 'uncategorized') throw new RepositoryError('INVALID_INPUT', '未分类为系统保留项，不可改名或移动。');
      categoryParent(db, action.parentId);
      if (action.parentId !== null && assetDescendants(db, 'category', action.id).includes(action.parentId)) throw new RepositoryError('INVALID_INPUT', '分类不能移入自身或后代形成环。');
      const order = current.parent_id === action.parentId ? null : nextAssetOrder(db, 'category', action.parentId);
      db.prepare('UPDATE category SET name=?,parent_id=?,sort_order=COALESCE(?,sort_order) WHERE id=?').run(action.name, action.parentId, order, action.id); return true;
    }
    case 'moveCategory': moveAsset(db, 'category', action.id, action.direction); return true;
    case 'deleteCategory': {
      const category = assetRow<CategoryRow>(db, 'category', action.id);
      if (category.system_key === 'uncategorized') throw new RepositoryError('INVALID_INPUT', '未分类为系统保留项，不可删除。');
      if (db.prepare('SELECT id FROM category WHERE parent_id=? AND deleted_at IS NULL').get(action.id)) throw new RepositoryError('INVALID_INPUT', '请先移动子分类，再删除父分类。');
      if (action.destinationId === action.id) throw new RepositoryError('INVALID_INPUT', '迁移目标不能是被删除分类。');
      categoryParent(db, action.destinationId);
      if (db.prepare('SELECT id FROM knowledge_entry WHERE category_id=? AND deleted_at IS NULL').get(action.id) && action.destinationId === null) throw new RepositoryError('INVALID_INPUT', '请先指定条目迁移目标。');
      if (action.destinationId !== null) db.prepare('UPDATE knowledge_entry SET category_id=?,revision=? WHERE category_id=? AND deleted_at IS NULL').run(action.destinationId, revision, action.id);
      db.prepare('UPDATE category SET deleted_at=? WHERE id=?').run(new Date().toISOString(), action.id); return true;
    }
    case 'createTag':
      if (db.prepare('SELECT id FROM tag WHERE name=? AND deleted_at IS NULL').get(action.name)) throw new RepositoryError('INVALID_INPUT', '同名标签已存在，请选择已有标签。');
      db.prepare('INSERT INTO tag(id,name) VALUES(?,?)').run(randomUUID(), action.name); return true;
    case 'deleteTag': {
      assetRow(db, 'tag', action.id);
      const affected = db.prepare('SELECT entry_id AS id FROM knowledge_tag WHERE tag_id=?').all(action.id) as { id: string }[];
      db.prepare('DELETE FROM knowledge_tag WHERE tag_id=?').run(action.id);
      db.prepare('UPDATE tag SET deleted_at=? WHERE id=?').run(new Date().toISOString(), action.id);
      for (const entry of affected) refreshKnowledgeSearch(db, entry.id);
      return true;
    }
    case 'createKnowledge': writeKnowledge(db, randomUUID(), action.body, action.source, action.categoryId, action.tagIds, revision, null, true); return true;
    case 'updateKnowledge': writeKnowledge(db, action.id, action.body, action.source, action.categoryId, action.tagIds, revision, null, false); return true;
    case 'deleteKnowledge':
      assetRow(db, 'knowledge_entry', action.id); db.prepare('UPDATE knowledge_entry SET deleted_at=?,revision=? WHERE id=?').run(new Date().toISOString(), revision, action.id);
      refreshKnowledgeSearch(db, action.id); return true;
    default: return false;
  }
}
export interface KnowledgeCopySource { workId: string; workTitle: string; revision: number; entry: KnowledgeEntry }
export function copyKnowledge(db: Database.Database, source: KnowledgeCopySource, categoryId: string, tagIds: string[], revision: number): string {
  if (source.entry.deletedAt) throw new RepositoryError('NOT_FOUND', '来源知识已删除，无法复制。');
  const id = randomUUID();
  writeKnowledge(db, id, source.entry.body, source.entry.source, categoryId, tagIds, revision,
    { workId: source.workId, entryId: source.entry.id, sourceRevision: source.revision, workTitle: source.workTitle }, true);
  return id;
}
