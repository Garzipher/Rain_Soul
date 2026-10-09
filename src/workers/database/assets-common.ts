import type Database from 'better-sqlite3';
import { RepositoryError } from './errors';

export type AssetTable = 'outline_node' | 'foreshadow' | 'evidence' | 'category' | 'tag' | 'knowledge_entry' | 'chapter';
export interface OrderedRow { id: string; parent_id: string | null; sort_order: number }
export function assetRow<T>(db: Database.Database, table: AssetTable, id: string, deleted = false): T {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=? AND deleted_at IS ${deleted ? 'NOT NULL' : 'NULL'}`).get(id);
  if (!row) throw new RepositoryError('NOT_FOUND', '对象不属于当前作品，已删除或不符合当前状态。');
  return row as T;
}
export function nextAssetOrder(db: Database.Database, table: 'category' | 'outline_node', parentId: string | null): number {
  return (db.prepare(`SELECT COALESCE(MAX(sort_order),-1)+1 AS value FROM ${table} WHERE parent_id IS ? AND deleted_at IS NULL`).get(parentId) as { value: number }).value;
}
export function assetDescendants(db: Database.Database, table: 'category' | 'outline_node', id: string): string[] {
  return (db.prepare(`WITH RECURSIVE tree(id) AS (SELECT id FROM ${table} WHERE id=? AND deleted_at IS NULL
    UNION SELECT n.id FROM ${table} n JOIN tree t ON n.parent_id=t.id WHERE n.deleted_at IS NULL) SELECT id FROM tree`).all(id) as { id: string }[]).map(row => row.id);
}
export function moveAsset(db: Database.Database, table: 'category' | 'outline_node', id: string, direction: 'up' | 'down') {
  const item = assetRow<OrderedRow>(db, table, id);
  const peers = db.prepare(`SELECT id,sort_order FROM ${table} WHERE parent_id IS ? AND deleted_at IS NULL ORDER BY sort_order,id`).all(item.parent_id) as OrderedRow[];
  const index = peers.findIndex(peer => peer.id === id);
  const neighbor = peers[index + (direction === 'up' ? -1 : 1)];
  if (!neighbor) return;
  const update = db.prepare(`UPDATE ${table} SET sort_order=? WHERE id=?`);
  update.run(neighbor.sort_order, id); update.run(item.sort_order, neighbor.id);
}
