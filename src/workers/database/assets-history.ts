import type Database from 'better-sqlite3';
import type { AssetAction } from '../../shared/assets';
import { assetDescendants, type AssetTable } from './assets-common';

export function recordAssetHistory(db: Database.Database, table: AssetTable, id: string, revision: number, phase: 'before' | 'after' = 'before') {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return;
  if (table === 'outline_node') row.knowledge_ids = db.prepare('SELECT knowledge_id FROM outline_knowledge WHERE node_id=? ORDER BY rowid').all(id);
  if (table === 'knowledge_entry') row.tag_ids = db.prepare('SELECT tag_id FROM knowledge_tag WHERE entry_id=? ORDER BY rowid').all(id);
  db.prepare('INSERT OR IGNORE INTO asset_history VALUES(?,?,?,?,?)').run(table, id, revision, phase, JSON.stringify(row));
}
export function recordAssetChanges(db: Database.Database, action: AssetAction, revision: number, phase: 'before' | 'after') {
  const table: AssetTable | null = action.type.endsWith('Outline') || action.type === 'setOutlineKnowledge' ? 'outline_node'
    : action.type.endsWith('Foreshadow') ? 'foreshadow' : action.type.endsWith('Evidence') ? 'evidence'
      : action.type.endsWith('Category') ? 'category' : action.type.endsWith('Tag') ? 'tag' : action.type.endsWith('Knowledge') ? 'knowledge_entry' : null;
  if (table && 'id' in action) recordAssetHistory(db, table, action.id, revision, phase);
  if (action.type === 'deleteOutline') {
    for (const nodeId of assetDescendants(db, 'outline_node', action.id)) {
      recordAssetHistory(db, 'outline_node', nodeId, revision, phase);
      for (const row of db.prepare('SELECT id FROM foreshadow WHERE outline_id=?').all(nodeId) as { id: string }[]) recordAssetHistory(db, 'foreshadow', row.id, revision, phase);
    }
  }
  if (action.type === 'assignForeshadows') {
    const ids = new Set([...action.foreshadowIds, ...(db.prepare('SELECT id FROM foreshadow WHERE outline_id=?').all(action.id) as { id: string }[]).map(row => row.id)]);
    for (const id of ids) recordAssetHistory(db, 'foreshadow', id, revision, phase);
  }
  if (action.type === 'deleteCategory' || action.type === 'deleteTag') {
    const entries = action.type === 'deleteCategory' ? db.prepare('SELECT id FROM knowledge_entry WHERE category_id=?').all(action.id)
      : db.prepare('SELECT entry_id AS id FROM knowledge_tag WHERE tag_id=?').all(action.id);
    for (const entry of entries as { id: string }[]) recordAssetHistory(db, 'knowledge_entry', entry.id, revision, phase);
  }
}
