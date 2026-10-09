import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AssetAction, OutlineKind } from '../../shared/assets';
import { assetDescendants, assetRow, moveAsset, nextAssetOrder } from './assets-common';
import { recordAssetHistory } from './assets-history';
import { RepositoryError } from './errors';

type OutlineRow = { id: string; type: OutlineKind; parent_id: string | null };
export function applyPlotAsset(db: Database.Database, action: AssetAction): boolean {
  switch (action.type) {
    case 'createOutline': {
      const parent = action.parentId === null ? null : assetRow<OutlineRow>(db, 'outline_node', action.parentId);
      if ((action.kind === 'volume' && parent) || (action.kind === 'chapter' && parent && parent.type !== 'volume')
        || (action.kind === 'detail' && parent?.type !== 'chapter')) throw new RepositoryError('INVALID_INPUT', '剧情树层级必须为卷、章、详细节点，卷可省略。');
      db.prepare("INSERT INTO outline_node(id,type,parent_id,title,summary,sort_order) VALUES(?,?,?,?, '',?)")
        .run(randomUUID(), action.kind, action.parentId, action.title, nextAssetOrder(db, 'outline_node', action.parentId));
      return true;
    }
    case 'updateOutline':
      assetRow(db, 'outline_node', action.id);
      if (action.chapterId !== null) assetRow(db, 'chapter', action.chapterId);
      db.prepare('UPDATE outline_node SET title=?,summary=?,chapter_id=? WHERE id=?').run(action.title, action.summary, action.chapterId, action.id);
      return true;
    case 'moveOutline': moveAsset(db, 'outline_node', action.id, action.direction); return true;
    case 'setOutlineKnowledge':
      assetRow(db, 'outline_node', action.id);
      for (const id of action.knowledgeIds) assetRow(db, 'knowledge_entry', id);
      db.prepare('DELETE FROM outline_knowledge WHERE node_id=?').run(action.id);
      for (const id of action.knowledgeIds) db.prepare('INSERT INTO outline_knowledge VALUES (?,?)').run(action.id, id);
      return true;
    case 'assignForeshadows':
      assetRow(db, 'outline_node', action.id);
      for (const id of action.foreshadowIds) assetRow(db, 'foreshadow', id);
      // 未勾选项只解除此节点的归属；勾选其他节点中的伏笔即明确迁移。
      db.prepare('UPDATE foreshadow SET outline_id=NULL WHERE outline_id=? AND deleted_at IS NULL').run(action.id);
      for (const id of action.foreshadowIds) db.prepare('UPDATE foreshadow SET outline_id=? WHERE id=?').run(action.id, id);
      return true;
    case 'deleteOutline': {
      assetRow(db, 'outline_node', action.id);
      const timestamp = new Date().toISOString();
      for (const id of assetDescendants(db, 'outline_node', action.id)) {
        const revision = (db.prepare('SELECT revision FROM work_meta').get() as { revision: number }).revision;
        recordAssetHistory(db, 'outline_node', id, revision, 'before');
        db.prepare('UPDATE outline_node SET deleted_at=?,chapter_id=NULL WHERE id=?').run(timestamp, id);
        db.prepare('DELETE FROM outline_knowledge WHERE node_id=?').run(id);
        for (const row of db.prepare('SELECT id FROM foreshadow WHERE outline_id=?').all(id) as { id: string }[]) recordAssetHistory(db, 'foreshadow', row.id, revision, 'before');
        db.prepare('UPDATE foreshadow SET outline_id=NULL WHERE outline_id=?').run(id);
      }
      return true;
    }
    case 'createForeshadow':
      db.prepare("INSERT INTO foreshadow(id,name,status,description) VALUES (?,?,'未埋设','')").run(randomUUID(), action.name); return true;
    case 'updateForeshadow':
      assetRow(db, 'foreshadow', action.id);
      if (action.outlineId !== null) assetRow(db, 'outline_node', action.outlineId);
      db.prepare('UPDATE foreshadow SET name=?,status=?,description=?,outline_id=? WHERE id=?')
        .run(action.name, action.status, action.description, action.outlineId, action.id); return true;
    case 'deleteForeshadow':
      assetRow(db, 'foreshadow', action.id);
      db.prepare('UPDATE foreshadow SET deleted_at=?,outline_id=NULL WHERE id=?').run(new Date().toISOString(), action.id); return true;
    case 'restoreForeshadow':
      assetRow(db, 'foreshadow', action.id, true);
      db.prepare('UPDATE foreshadow SET deleted_at=NULL WHERE id=?').run(action.id); return true;
    default: return false;
  }
}
