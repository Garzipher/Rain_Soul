import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { bookExtractionCommitSchema, type BookExtractionCommit } from '../../shared/book-extraction';
import { applyAsset } from './assets';
import { createSnapshot } from './snapshots';
import { RepositoryError } from './errors';

/** 整批审核原子落库，既有 operation_log 记录重试；不引入虚构 AI 来源。 */
export function importBookExtraction(db: Database.Database, value: BookExtractionCommit): void {
  const parsed = bookExtractionCommitSchema.safeParse(value);
  if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '拆书审核内容无效，请逐段确认。');
  const request = parsed.data, hash = createHash('sha256').update(JSON.stringify(['book-extraction', request])).digest('hex');
  db.transaction(() => {
    const meta = db.prepare('SELECT id,revision,deleted_at FROM work_meta').get() as { id: string; revision: number; deleted_at: string | null };
    if (!meta || meta.deleted_at || meta.id !== request.workId) throw new RepositoryError('NOT_FOUND', '拆书目标作品不存在或已删除。');
    const receipt = db.prepare('SELECT request_hash FROM operation_log WHERE operation_id=?').get(request.operationId) as { request_hash: string } | undefined;
    if (receipt) {
      if (receipt.request_hash !== hash) throw new RepositoryError('INVALID_INPUT', '操作标识已用于其他摘选内容。');
      return;
    }
    if (meta.revision !== request.expectedRevision) throw new RepositoryError('REVISION_CONFLICT', '作品版本已变化，请刷新并重新审核。');
    createSnapshot(db, '拆书入库前安全快照', 'safety');
    for (const item of request.items) applyAsset(db, { type: 'createKnowledge', ...item }, meta.revision + 1);
    db.prepare('UPDATE work_meta SET revision=revision+1,updated_at=? WHERE id=?').run(new Date().toISOString(), meta.id);
    db.prepare('INSERT INTO operation_log VALUES(?,?,?)').run(request.operationId, hash, JSON.stringify({ revision: meta.revision + 1 }));
  }).immediate();
}
