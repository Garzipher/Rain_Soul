import type Database from 'better-sqlite3';
import { globalExtractionCommitSchema, globalFreezeRequestSchema, globalKnowledgeMutationSchema, globalKnowledgeQuerySchema, globalUsageSchema } from '../../shared/global-knowledge-schema';
import type { GlobalExtractionCommit, GlobalKnowledgeFrozen, GlobalKnowledgeMutation, GlobalKnowledgePage, GlobalKnowledgeQuery } from '../../shared/global-knowledge';
import { openGlobalDatabase } from './migration';
import { digest, fail, readAnnotations, readCategories, readEntries, readSources, readTags } from './records';
import { applyGlobalAction } from './mutations';
import { ingestGlobalExtraction } from './extraction';
import { filterGlobalEntries } from './search';
import { exportGlobalData, importGlobalData } from './archive';
import { globalKnowledgeArchiveDataSchema, type GlobalKnowledgeArchiveData } from '../../shared/global-knowledge-archive';

export class GlobalKnowledgeRepository {
  constructor(private readonly db: Database.Database) {}
  static async open(directory: string) { return new GlobalKnowledgeRepository(await openGlobalDatabase(directory)); }
  status(): { available: true; libraryId: string; revision: number } { const meta = this.meta(); return { available: true, libraryId: meta.library_id, revision: meta.revision }; }
  private meta(): { library_id: string; revision: number } {
    const meta = this.db.prepare('SELECT library_id,revision FROM global_meta WHERE id=1').get() as { library_id: string; revision: number } | undefined;
    if (!meta) return fail('全局知识库元信息损坏。'); return meta;
  }
  private change(operationId: string, expectedRevision: number, value: unknown, action: () => void): GlobalKnowledgePage {
    const hash = digest(JSON.stringify(value));
    this.db.transaction(() => {
      const receipt = this.db.prepare('SELECT request_hash FROM global_operation WHERE operation_id=?').get(operationId) as { request_hash: string } | undefined;
      if (receipt) { if (receipt.request_hash !== hash) fail('同一操作身份不能用于不同内容。'); return; }
      const meta = this.meta(); if (expectedRevision !== meta.revision) fail('全局知识库已更新，请刷新后重试。', 'REVISION_CONFLICT');
      action(); this.db.prepare('UPDATE global_meta SET revision=revision+1 WHERE id=1').run();
      this.db.prepare('INSERT INTO global_operation VALUES(?,?,?)').run(operationId, hash, meta.revision + 1);
    })();
    return this.read({});
  }
  read(input: GlobalKnowledgeQuery = {}): GlobalKnowledgePage {
    const query = globalKnowledgeQuerySchema.parse(input); return this.readPage(query);
  }
  private readPage(query: GlobalKnowledgeQuery, all = false): GlobalKnowledgePage {
    return this.db.transaction(() => {
      const meta = this.meta(), categories = readCategories(this.db).filter(item => !item.deletedAt), tags = readTags(this.db).filter(item => !item.deletedAt);
      const found = filterGlobalEntries(readEntries(this.db), categories, query).reverse(), offset = query.offset ?? 0, limit = all ? Math.max(1, found.length) : query.limit ?? 30;
      const entries = all ? found : found.slice(offset, offset + limit), ids = new Set(entries.map(item => item.id));
      return { libraryId: meta.library_id, revision: meta.revision, entries, categories, tags, annotations: readAnnotations(this.db).filter(item => ids.has(item.entryId)), total: found.length, offset, limit };
    })();
  }
  readAll(): GlobalKnowledgePage { return this.readPage({}, true); }
  exportData(): GlobalKnowledgeArchiveData { return this.db.transaction(() => exportGlobalData(this.db, this.readAll()))(); }
  importData(operationId: string, input: GlobalKnowledgeArchiveData): GlobalKnowledgePage {
    const data = globalKnowledgeArchiveDataSchema.parse(input);
    return this.change(operationId, this.meta().revision, { kind: 'archive', data }, () => importGlobalData(this.db, data));
  }
  mutate(input: GlobalKnowledgeMutation): GlobalKnowledgePage {
    const request = globalKnowledgeMutationSchema.parse(input); return this.change(request.operationId, request.expectedRevision, request, () => applyGlobalAction(this.db, request.action));
  }
  ingestExtraction(input: GlobalExtractionCommit): GlobalKnowledgePage {
    const request = globalExtractionCommitSchema.parse(input); return this.change(request.operationId, request.expectedRevision, request, () => ingestGlobalExtraction(this.db, request));
  }
  readFrozen(input: unknown): GlobalKnowledgeFrozen {
    const request = globalFreezeRequestSchema.parse(input);
    return this.db.transaction(() => {
      const meta = this.meta(), all = readEntries(this.db);
      const entries = request.entries.map(ref => {
        const item = all.find(entry => entry.id === ref.entryId && !entry.deletedAt);
        if (!item) return fail('全局条目不存在或已删除。', 'NOT_FOUND');
        if (item.revision !== ref.revision) fail('全局参考版本已变化，请重新确认。', 'REVISION_CONFLICT'); return item;
      });
      const categories = readCategories(this.db).filter(item => !item.deletedAt), tags = readTags(this.db).filter(item => !item.deletedAt);
      return { libraryId: meta.library_id, revision: meta.revision, entries, categories, tags, ...readSources(this.db, entries) };
    })();
  }
  recordUsage(input: unknown): void {
    const request = globalUsageSchema.parse(input);
    this.db.transaction(() => {
      const hash = digest(JSON.stringify({ kind: 'usage', request }));
      const receipt = this.db.prepare('SELECT request_hash FROM global_operation WHERE operation_id=?').get(request.operationId) as { request_hash: string } | undefined;
      if (receipt) { if (receipt.request_hash !== hash) fail('同一使用操作身份不能用于不同内容。'); return; }
      const add = this.db.prepare('INSERT OR IGNORE INTO global_usage VALUES(?,?,?,?,?)');
      for (const entry of request.entries) {
        const prior = this.db.prepare('SELECT work_id,revision,work_revision FROM global_usage WHERE operation_id=? AND entry_id=?').get(request.operationId, entry.entryId) as { work_id: string; revision: number; work_revision: number } | undefined;
        if (prior && (prior.work_id !== request.workId || prior.revision !== entry.revision || prior.work_revision !== request.workRevision)) fail('使用台账操作身份冲突。');
        add.run(request.operationId, request.workId, entry.entryId, entry.revision, request.workRevision);
      }
      this.db.prepare('INSERT INTO global_operation VALUES(?,?,?)').run(request.operationId, hash, this.meta().revision);
    })();
  }
  close() { this.db.close(); }
}
