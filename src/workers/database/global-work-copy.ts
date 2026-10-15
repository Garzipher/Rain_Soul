import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { globalWorkCopyRequestSchema, type GlobalWorkCopyRequest } from '../../shared/global-work-copy';
import { globalKnowledgeFrozenSchema } from '../../shared/global-knowledge-schema';
import type { GlobalKnowledgeFrozen } from '../../shared/global-knowledge';
import { readAssets } from './assets';
import { writeKnowledge } from './assets-knowledge';
import { copyKnowledgeSources } from './source-copy';
import { recordAssetHistory } from './assets-history';
import { createSnapshot } from './snapshots';
import { RepositoryError } from './errors';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const globalCopyHash = (request: GlobalWorkCopyRequest) => hash(['global-work-copy', request]);

/** 先查作品回执；全局来源删除后仍能取回既有成功结果。 */
export function globalWorkCopyReceipt(db: Database.Database, request: GlobalWorkCopyRequest): boolean {
  const row = db.prepare('SELECT request_hash FROM operation_log WHERE operation_id=?').get(request.operationId) as { request_hash: string } | undefined;
  if (row && row.request_hash !== globalCopyHash(request)) throw new RepositoryError('INVALID_INPUT', '操作标识已用于其他内容。');
  return !!row;
}

/** 分类按完整路径、标签按名称映射；来源身份与作品身份互相隔离。 */
export function freezeGlobalIntoWork(db: Database.Database, input: GlobalWorkCopyRequest, value: GlobalKnowledgeFrozen): void {
  const request = globalWorkCopyRequestSchema.parse(input), frozen = globalKnowledgeFrozenSchema.parse(value);
  if (request.entries.some(ref => !frozen.entries.some(entry => entry.id === ref.entryId && entry.revision === ref.revision && !entry.deletedAt)))
    throw new RepositoryError('REVISION_CONFLICT', '全局参考版本已变化，请重新确认。');
  db.transaction(() => {
    if (globalWorkCopyReceipt(db, request)) return;
    const meta = db.prepare('SELECT id,revision,deleted_at FROM work_meta').get() as { id: string; revision: number; deleted_at: string | null };
    if (meta.id !== request.workId || meta.deleted_at) throw new RepositoryError('NOT_FOUND', '当前作品不存在。');
    if (meta.revision !== request.expectedRevision) throw new RepositoryError('REVISION_CONFLICT', '作品版本已变化，请重新读取。');
    const assets = readAssets(db), categoryMap = new Map<string, string>();
    const category = (id: string, visiting = new Set<string>()): string => {
      if (categoryMap.has(id)) return categoryMap.get(id)!;
      const source = frozen.categories.find(item => item.id === id && !item.deletedAt);
      if (!source || visiting.has(id)) throw new RepositoryError('INVALID_INPUT', '全局分类路径损坏。');
      visiting.add(id);
      const parentId = source.parentId ? category(source.parentId, visiting) : null;
      let match = assets.categories.find(item => !item.deletedAt && (source.systemKey === 'uncategorized'
        ? item.systemKey === 'uncategorized' : item.parentId === parentId && item.name.toLocaleLowerCase() === source.name.toLocaleLowerCase()));
      if (!match) {
        match = { ...source, id: randomUUID(), parentId, systemKey: null };
        db.prepare('INSERT INTO category(id,name,parent_id,sort_order,system_key) VALUES(?,?,?,?,NULL)').run(match.id, match.name, parentId, match.sortOrder);
        assets.categories.push(match);
      }
      categoryMap.set(id, match.id); return match.id;
    };
    createSnapshot(db, '冻结全局知识前安全快照', 'safety');
    const copiedIds: string[] = [];
    for (const ref of request.entries) {
      const prior = assets.knowledge.find(item => !item.deletedAt && item.globalOrigin?.libraryId === frozen.libraryId
        && item.globalOrigin.entryId === ref.entryId && item.globalOrigin.revision === ref.revision);
      if (prior) { copiedIds.push(prior.id); continue; }
      const entry = frozen.entries.find(item => item.id === ref.entryId)!, id = randomUUID();
      const tagIds = entry.tagIds.map(tagId => {
        const source = frozen.tags.find(tag => tag.id === tagId && !tag.deletedAt);
        if (!source) throw new RepositoryError('INVALID_INPUT', '全局标签已失效。');
        let tag = assets.tags.find(item => !item.deletedAt && item.name.toLocaleLowerCase() === source.name.toLocaleLowerCase());
        if (!tag) { tag = { ...source, id: randomUUID() }; db.prepare('INSERT INTO tag(id,name) VALUES(?,?)').run(tag.id, tag.name); assets.tags.push(tag); }
        return tag.id;
      });
      writeKnowledge(db, id, entry.body, `${entry.source}\n来自全局库 v${entry.revision}`, category(entry.categoryId), tagIds, meta.revision + 1, null, true);
      const metadata = frozen.metadata.filter(item => item.sourceDocumentId === entry.sourceDocumentId)
        .map(item => ({ author: item.author, workTitle: item.workTitle, chapter: item.chapter, rightsBasis: item.rightsBasis,
          capturedAt: item.capturedAt, verificationStatus: item.verificationStatus, metrics: item.metrics }));
      const origin = { kind: 'global', libraryId: frozen.libraryId, entryId: entry.id, revision: entry.revision, sourceHash: hash(entry.body), metadata };
      db.prepare('UPDATE knowledge_entry SET origin_json=? WHERE id=?').run(JSON.stringify(origin), id);
      const links = frozen.sourceAssets.links.filter(link => link.entryId === entry.id);
      const documents = frozen.sourceAssets.documents.filter(source => links.some(link => link.sourceId === source.id)).map(source => {
        const segments = source.segments.filter(segment => links.some(link => link.segmentId === segment.id))
          .map((segment, index) => ({ ...segment, ordinal: index + 1 }));
        return { ...source, segments, bodyHash: hash(segments.map(segment => segment.text)) };
      });
      copyKnowledgeSources(db, { ...frozen.sourceAssets, documents, links }, entry.id, id);
      recordAssetHistory(db, 'knowledge_entry', id, meta.revision + 1, 'after'); copiedIds.push(id);
    }
    db.prepare('UPDATE work_meta SET revision=revision+1,updated_at=? WHERE id=?').run(new Date().toISOString(), meta.id);
    db.prepare('INSERT INTO operation_log VALUES(?,?,?)').run(request.operationId, globalCopyHash(request), JSON.stringify({ revision: meta.revision + 1, copiedIds }));
  }).immediate();
}
