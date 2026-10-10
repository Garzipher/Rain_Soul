import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { bookExtractionCommitSchema, type BookExtractionCommit } from '../../shared/book-extraction';
import { applyAsset } from './assets';
import { createSnapshot } from './snapshots';
import { RepositoryError } from './errors';
import { writeKnowledge } from './assets-knowledge';
import { recordAssetHistory } from './assets-history';
import { commitSourceAssets } from './source-document';
import type { KnowledgeSourceLink, LearningAnnotation } from '../../shared/source-assets';
import { z } from 'zod';

export interface BookExtractionReceiptRequest { workId: string; operationId: string; requestHash: string }
/** 只读原操作回执；不得改revision或生成新的入库身份。 */
export function getBookExtractionReceipt(db: Database.Database, value: BookExtractionReceiptRequest): { status: 'missing' } | { status: 'committed'; revision: number } {
  const request = z.object({ workId: z.uuid(), operationId: z.uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(value);
  if (!request.success) throw new RepositoryError('INVALID_INPUT', '拆书回执查询身份无效。');
  const meta = db.prepare('SELECT id,revision,deleted_at FROM work_meta').get() as { id: string; revision: number; deleted_at: string | null } | undefined;
  if (!meta || meta.deleted_at || meta.id !== request.data.workId) throw new RepositoryError('NOT_FOUND', '拆书目标作品不存在或已删除。');
  const receipt = db.prepare('SELECT request_hash,result_json FROM operation_log WHERE operation_id=?').get(request.data.operationId) as { request_hash: string; result_json: string } | undefined;
  if (!receipt) return { status: 'missing' };
  if (receipt.request_hash !== request.data.requestHash) throw new RepositoryError('INVALID_INPUT', '操作标识已用于不同哈希的摘选内容。');
  let parsed: unknown;
  try { parsed = JSON.parse(receipt.result_json); } catch { throw new RepositoryError('INVALID_FILE', '拆书入库回执损坏。'); }
  const result = z.object({ revision: z.number().int().positive() }).strict().safeParse(parsed);
  if (!result.success || result.data.revision > meta.revision) throw new RepositoryError('INVALID_FILE', '拆书入库回执版本损坏。');
  return { status: 'committed', revision: result.data.revision };
}

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
    const links: KnowledgeSourceLink[] = [], annotations: LearningAnnotation[] = [];
    for (const item of request.items) {
      if (!request.sourceDocument) {
        applyAsset(db, { type: 'createKnowledge', body: item.body, source: item.source, categoryId: item.categoryId, tagIds: item.tagIds }, meta.revision + 1);
        continue;
      }
      const entryId = randomUUID();
      writeKnowledge(db, entryId, item.body, item.source, item.categoryId, item.tagIds, meta.revision + 1, null, true);
      recordAssetHistory(db, 'knowledge_entry', entryId, meta.revision + 1, 'after');
      links.push({ entryId, sourceId: request.sourceDocument.id, segmentId: item.segmentId! });
      if (item.annotation) annotations.push({ id: randomUUID(), entryId, ...item.annotation });
    }
    if (request.sourceDocument) commitSourceAssets(db, request.sourceDocument, links, annotations);
    db.prepare('UPDATE work_meta SET revision=revision+1,updated_at=? WHERE id=?').run(new Date().toISOString(), meta.id);
    db.prepare('INSERT INTO operation_log VALUES(?,?,?)').run(request.operationId, hash, JSON.stringify({ revision: meta.revision + 1 }));
  }).immediate();
}
