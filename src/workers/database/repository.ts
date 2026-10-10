import type { AiKnowledgeApproval } from '../../shared/ai-extraction';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Chapter, DeletedItem, DeletedWork, SaveResult, StructureRequest, Volume, WorkDetail, WorkSummary, WritingDocument } from '../../shared/contracts';
import { countDocumentWords, emptyDocument, validateDocument } from '../../shared/document';
import { structureRequestSchema } from '../../shared/structure-schema';
import { initializeSchema, RepositoryError } from './schema';
import { applyStructure, assertVolume, nextChapterOrder } from './structure';
import { applyAsset, readAssets } from './assets';
import { searchAssets, refreshChapterSearch } from './assets-search';
import { assetRequestSchema, assetQuerySchema } from '../../shared/assets-schema';
import type { AssetRequest, AssetQuery } from '../../shared/assets';
import { knowledgeCopyRequestSchema, type KnowledgeCopyRequest } from '../../shared/knowledge-scope';
import { knowledgeScope, assertGlobalKnowledgeQuery, scopeEntryId } from './knowledge-scope';
import { copyKnowledge as insertKnowledgeCopy } from './assets-knowledge';
import { readSourceAssets } from './source-document';
import { copyKnowledgeSources } from './source-copy';
import { createImportedProject } from './manuscript-import';
import type { ManuscriptImportRequest } from '../../shared/manuscript-schema';
import { exportProjectDatabase, importArchivedProject } from './archive-project';
import type { ParsedProjectArchive } from '../../shared/archive';
import type { AiCandidate } from '../../shared/ai';
import { applyAiCandidate, approveAiKnowledge } from './ai-apply';
import { snapshotCreateRequestSchema, snapshotRestoreRequestSchema, type SnapshotCreateRequest, type SnapshotRestoreRequest } from '../../shared/snapshots';
import { listSnapshots as readSnapshots, createSnapshot as captureSnapshot, restoreSnapshot as applySnapshot, previewSnapshot as readSnapshotPreview, freezeSnapshotExport } from './snapshots';
import { listConversations, readConversation, manageConversation, appendConversationTurn } from './conversations';
import type { ConversationRequest, ConversationTurnRequest } from '../../shared/conversations';
import { importBookExtraction, getBookExtractionReceipt, type BookExtractionReceiptRequest } from './book-extraction';
import type { BookExtractionCommit } from '../../shared/book-extraction';
export { RepositoryError } from './schema';

interface Meta { id: string; title: string; revision: number; updated_at: string; deleted_at: string | null }
interface ChapterRow { id: string; title: string; document_json: string; word_count: number; volume_id: string | null }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (value: string) => {
  if (typeof value !== 'string' || !uuid.test(value)) throw new RepositoryError('INVALID_INPUT', '标识无效。');
  return value;
};
const validTitle = (value: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new RepositoryError('INVALID_INPUT', '名称不能为空。');
  return value.trim();
};

export class WorkRepository {
  private readonly projects: string;
  private catalog!: Database.Database;
  private current?: { id: string; db: Database.Database };
  private closed = false;
  private readonly pending = new Set<string>();

  constructor(directory: string) {
    const base = resolve(directory);
    this.projects = join(base, 'Projects');
    mkdirSync(this.projects, { recursive: true });
    try {
      this.catalog = new Database(join(base, 'catalog.sqlite'));
      initializeSchema(this.catalog, 'catalog');
      this.reconcileCatalog();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private assertOpen() {
    if (this.closed) throw new RepositoryError('SAVE_FAILED', '存储服务已关闭。');
  }

  private projectDb(id: string) {
    this.assertOpen();
    validId(id);
    if (this.current?.id === id) return this.current.db;
    const directory = join(this.projects, id);
    const file = join(directory, 'project.sqlite');
    if (!existsSync(file)) throw new RepositoryError('NOT_FOUND', '作品不存在。');
    if (lstatSync(directory).isSymbolicLink() || lstatSync(file).isSymbolicLink()) {
      throw new RepositoryError('INVALID_INPUT', '作品路径不允许符号链接。');
    }
    const db = new Database(file, { fileMustExist: true });
    try {
      const version = db.pragma('user_version', { simple: true });
      if (version === 1 || version === 2 || version === 3 || version === 4 || version === 5 || version === 6) this.checkMetadata(db, id);
      initializeSchema(db, 'project');
      this.checkMetadata(db, id);
    } catch (error) { db.close(); throw error; }
    this.current?.db.close();
    this.current = { id, db };
    return db;
  }

  private checkMetadata(db: Database.Database, id: string) {
    let rows: { id: string }[];
    try { rows = db.prepare('SELECT id FROM work_meta LIMIT 2').all() as { id: string }[]; }
    catch { throw new RepositoryError('INVALID_FILE', '作品元数据结构缺失。'); }
    if (rows.length !== 1 || rows[0].id !== id) {
      throw new RepositoryError('INVALID_FILE', '作品元数据必须唯一且标识与目录一致。');
    }
  }

  private meta(db: Database.Database): Meta {
    const meta = db.prepare('SELECT * FROM work_meta').get() as Meta | undefined;
    if (!meta) throw new RepositoryError('INVALID_FILE', '作品元数据缺失。');
    return meta;
  }

  private updateCatalog(id: string) {
    const db = this.projectDb(id);
    const meta = this.meta(db);
    if (meta.deleted_at) {
      this.catalog.prepare('DELETE FROM work_catalog WHERE work_id = ?').run(id);
      this.pending.delete(id);
      return;
    }
    const totals = db.prepare('SELECT COALESCE(SUM(word_count), 0) AS words, COUNT(*) AS chapters FROM chapter WHERE deleted_at IS NULL')
      .get() as { words: number; chapters: number };
    this.catalog.prepare(`INSERT INTO work_catalog VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(work_id) DO UPDATE SET title=excluded.title, word_count=excluded.word_count,
      chapter_count=excluded.chapter_count, updated_at=excluded.updated_at, cached_revision=excluded.cached_revision`)
      .run(id, meta.title, totals.words, totals.chapters, meta.updated_at, meta.revision);
    this.pending.delete(id);
  }

  private reconcileCatalog() {
    const ids = readdirSync(this.projects, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && uuid.test(entry.name)
        && existsSync(join(this.projects, entry.name, 'project.sqlite'))).map((entry) => entry.name);
    this.catalog.transaction(() => {
      this.catalog.prepare('DELETE FROM work_catalog').run();
      for (const id of ids) this.updateCatalog(id);
    }).immediate();
    this.current?.db.close();
    this.current = undefined;
  }

  listWorks(): WorkSummary[] {
    this.assertOpen();
    for (const id of this.pending) this.updateCatalog(id);
    return this.catalog.prepare(`SELECT work_id AS id, title, word_count AS wordCount,
      chapter_count AS chapterCount, updated_at AS updatedAt FROM work_catalog
      ORDER BY updated_at DESC, work_id`).all() as WorkSummary[];
  }

  listConversations(workId: string) {
    const db = this.projectDb(workId); if (this.meta(db).deleted_at) throw new RepositoryError('NOT_FOUND', '作品已删除。');
    return listConversations(db);
  }
  readConversation(workId: string, conversationId: string, beforeMessageId?: string) {
    const db = this.projectDb(workId); if (this.meta(db).deleted_at) throw new RepositoryError('NOT_FOUND', '作品已删除。');
    return readConversation(db, conversationId, beforeMessageId);
  }
  manageConversation(request: ConversationRequest) { return manageConversation(this.projectDb(request.workId), request); }
  appendConversationTurn(request: ConversationTurnRequest) { return appendConversationTurn(this.projectDb(request.workId), request); }
  importBookExtraction(request: BookExtractionCommit) {
    importBookExtraction(this.projectDb(request.workId), request); this.pending.add(request.workId); return this.openWork(request.workId);
  }
  getBookExtractionReceipt(request: BookExtractionReceiptRequest) {
    const receipt = getBookExtractionReceipt(this.projectDb(request.workId), request);
    return receipt.status === 'missing' ? receipt : { ...receipt, result: this.openWork(request.workId) };
  }

  listDeletedWorks(): DeletedWork[] {
    this.assertOpen();
    const deleted: DeletedWork[] = [];
    for (const entry of readdirSync(this.projects, { withFileTypes: true })) {
      if (!entry.isDirectory() || !uuid.test(entry.name) || !existsSync(join(this.projects, entry.name, 'project.sqlite'))) continue;
      const db = this.projectDb(entry.name);
      const meta = this.meta(db);
      if (!meta.deleted_at) continue;
      const totals = db.prepare('SELECT COALESCE(SUM(word_count), 0) AS wordCount, COUNT(*) AS chapterCount FROM chapter WHERE deleted_at IS NULL')
        .get() as { wordCount: number; chapterCount: number };
      deleted.push({ id: meta.id, title: meta.title, revision: meta.revision, updatedAt: meta.updated_at, ...totals });
    }
    return deleted.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt) || first.id.localeCompare(second.id));
  }

  createWork(title: string): WorkDetail {
    this.assertOpen();
    title = validTitle(title);
    const id = randomUUID();
    const staging = join(this.projects, `.creating-${id}`);
    mkdirSync(staging);
    let db: Database.Database | undefined;
    try {
      db = new Database(join(staging, 'project.sqlite'));
      initializeSchema(db, 'project');
      const project = db;
      project.transaction(() => {
        project.prepare('INSERT INTO work_meta (id, title, revision, updated_at) VALUES (?, ?, 1, ?)').run(id, title, new Date().toISOString());
        project.prepare('INSERT INTO chapter (id, title, document_json, word_count, sort_order) VALUES (?, ?, ?, 0, 0)')
          .run(randomUUID(), '第一章', JSON.stringify(emptyDocument()));
      }).immediate();
      project.close();
      db = undefined;
      renameSync(staging, join(this.projects, id));
    } catch (error) {
      db?.close();
      rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    this.refreshCache(id);
    return this.openWork(id);
  }

  importManuscript(request: ManuscriptImportRequest): WorkDetail {
    this.assertOpen();
    const id = createImportedProject(this.projects, request);
    this.refreshCache(id);
    return this.openWork(id);
  }
  async exportProject(workId: string, expectedRevision: number): Promise<Buffer> {
    const db = this.projectDb(workId);
    if (this.meta(db).deleted_at) throw new RepositoryError('NOT_FOUND', '作品已删除。');
    return exportProjectDatabase(this.projects, workId, expectedRevision);
  }
  importProject(input: ParsedProjectArchive, operationId: string): WorkDetail {
    this.assertOpen();
    const id = importArchivedProject(this.projects, input, operationId);
    this.refreshCache(id); return this.openWork(id);
  }
  applyAi(candidate: AiCandidate, operationId: string): WorkDetail {
    applyAiCandidate(this.projectDb(candidate.workId), candidate, operationId);
    this.refreshCache(candidate.workId); return this.openWork(candidate.workId);
  }
  approveKnowledge(candidate: AiCandidate, items: AiKnowledgeApproval[], operationId: string): WorkDetail {
    approveAiKnowledge(this.projectDb(candidate.workId), candidate, items, operationId);
    this.refreshCache(candidate.workId); return this.openWork(candidate.workId);
  }

  private refreshCache(id: string) {
    // 正文已提交；目录缓存失败只标记待刷新，禁止把成功落盘伪装成保存失败。
    try { this.updateCatalog(id); } catch { this.pending.add(id); }
  }

  openWork(id: string): WorkDetail {
    const db = this.projectDb(id);
    const meta = this.meta(db);
    if (meta.deleted_at) throw new RepositoryError('NOT_FOUND', '作品已删除，可从设置的本机数据恢复。');
    const chapters = (db.prepare(`SELECT chapter.* FROM chapter LEFT JOIN volume ON chapter.volume_id = volume.id
      WHERE chapter.deleted_at IS NULL ORDER BY CASE WHEN chapter.volume_id IS NULL THEN 0 ELSE 1 END,
      volume.sort_order, chapter.sort_order, chapter.id`).all() as ChapterRow[])
      .map((row): Chapter => ({ id: row.id, title: row.title,
        document: validateDocument(JSON.parse(row.document_json)), wordCount: row.word_count, volumeId: row.volume_id }));
    const volumes = db.prepare('SELECT id, title FROM volume WHERE deleted_at IS NULL ORDER BY sort_order, id').all() as Volume[];
    const deletedItems = db.prepare(`SELECT id, title, 'chapter' AS kind, deleted_at AS deletedAt FROM chapter WHERE deleted_at IS NOT NULL
      UNION ALL SELECT id, title, 'volume' AS kind, deleted_at AS deletedAt FROM volume WHERE deleted_at IS NOT NULL
      ORDER BY deletedAt DESC, kind, id`).all() as DeletedItem[];
    return { id: meta.id, title: meta.title, revision: meta.revision, chapters, volumes, deletedItems, assets: readAssets(db) };
  }

  manageAssets(value: AssetRequest): WorkDetail {
    const parsed = assetRequestSchema.safeParse(value);
    if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '作品资产操作参数无效。');
    const { workId, expectedRevision, operationId, action } = parsed.data;
    this.commit(workId, expectedRevision, operationId, ['assets', action, expectedRevision], (db, revision) => {
      applyAsset(db, action, revision);
      return { revision };
    });
    return this.openWork(workId);
  }

  searchWork(workId: string, value: AssetQuery) {
    const parsed = assetQuerySchema.safeParse(value);
    if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '作品搜索参数无效。');
    const db = this.projectDb(workId);
    if (this.meta(db).deleted_at) throw new RepositoryError('NOT_FOUND', '作品已删除，可从设置的本机数据恢复。');
    return searchAssets(db, parsed.data);
  }

  readKnowledgeScope(scopeId: string | null) {
    const ids = scopeId === null ? this.listWorks().map(work => work.id) : [scopeId];
    const works = ids.map(id => {
      const db = this.projectDb(id); const meta = this.meta(db);
      if (meta.deleted_at) throw new RepositoryError('NOT_FOUND', '作品已删除。');
      return { id: meta.id, title: meta.title, revision: meta.revision, assets: readAssets(db) };
    });
    return knowledgeScope(works, scopeId === null);
  }

  searchKnowledgeScope(scopeId: string | null, value: AssetQuery) {
    const parsed = assetQuerySchema.safeParse(value);
    if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '知识搜索参数无效。');
    const query = parsed.data;
    if (scopeId === null) assertGlobalKnowledgeQuery(query);
    const works = scopeId === null ? this.listWorks() : [this.meta(this.projectDb(scopeId))];
    const offset = query.offset ?? 0; const limit = query.limit ?? 100;
    const results = [];
    for (const work of works) {
      // 按作品分批读取，最后统一分页，避免每部作品都跳过同一 offset。
      let page = 0;
      while (true) {
        const rows = this.searchWork(work.id, { ...query, offset: page, limit: 200 });
        results.push(...rows.map(row => ({ ...row, id: scopeId === null ? scopeEntryId(work.id, row.id) : row.id, workId: work.id, workTitle: work.title })));
        if (rows.length < 200 || results.length >= offset + limit) break;
        page += 200;
      }
      if (results.length >= offset + limit) break;
    }
    return results.slice(offset, offset + limit);
  }

  copyKnowledge(value: KnowledgeCopyRequest): WorkDetail {
    const parsed = knowledgeCopyRequestSchema.safeParse(value);
    if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '知识复制参数无效。');
    const request = parsed.data;
    if (request.workId === request.sourceWorkId) throw new RepositoryError('INVALID_INPUT', '跨作品复用需选择其他作品。');
    this.commit(request.workId, request.expectedRevision, request.operationId, ['copyKnowledge', request], (target, revision) => {
      const file = join(this.projects, request.sourceWorkId, 'project.sqlite');
      if (!existsSync(file) || lstatSync(file).isSymbolicLink() || lstatSync(join(this.projects, request.sourceWorkId)).isSymbolicLink()) {
        throw new RepositoryError('NOT_FOUND', '来源作品不存在或路径无效。');
      }
      const source = new Database(file, { readonly: true, fileMustExist: true });
      try {
        // 来源版本、知识及原文证据从同一只读快照获取，不能跨读混入新版本。
        source.transaction(() => {
          this.checkMetadata(source, request.sourceWorkId); const meta = this.meta(source);
          if (meta.deleted_at) throw new RepositoryError('NOT_FOUND', '来源作品已删除。');
          if (meta.revision !== request.sourceExpectedRevision) throw new RepositoryError('REVISION_CONFLICT', '来源作品已变化，请重新查看后确认复制。');
          const entry = readAssets(source).knowledge.find(item => item.id === request.sourceEntryId && !item.deletedAt);
          if (!entry) throw new RepositoryError('NOT_FOUND', '来源知识已删除或不存在。');
          const evidence = readSourceAssets(source, entry.id);
          const entryId = insertKnowledgeCopy(target, { workId: meta.id, workTitle: meta.title, revision: meta.revision, entry }, request.categoryId, request.tagIds, revision);
          copyKnowledgeSources(target, evidence, entry.id, entryId);
        })();
        return { revision };
      } finally { source.close(); }
    });
    return this.openWork(request.workId);
  }

  listSnapshots(workId: string) {
    const db = this.projectDb(workId);
    if (this.meta(db).deleted_at) throw new RepositoryError('NOT_FOUND', '作品已删除。');
    return readSnapshots(db);
  }

  previewSnapshot(workId: string, snapshotId: string) {
    validId(snapshotId); const db = this.projectDb(workId);
    if (this.meta(db).deleted_at) throw new RepositoryError('NOT_FOUND', '作品已删除。');
    return readSnapshotPreview(db, snapshotId);
  }

  freezeSnapshot(workId: string, snapshotId: string) {
    validId(snapshotId); const db = this.projectDb(workId);
    if (this.meta(db).deleted_at) throw new RepositoryError('NOT_FOUND', '作品已删除。');
    return freezeSnapshotExport(db, snapshotId);
  }

  createSnapshot(value: SnapshotCreateRequest): WorkDetail {
    const parsed = snapshotCreateRequestSchema.safeParse(value);
    if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '快照创建参数无效。');
    return this.commitSnapshot('create', parsed.data);
  }

  restoreSnapshot(value: SnapshotRestoreRequest): WorkDetail {
    const parsed = snapshotRestoreRequestSchema.safeParse(value);
    if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '快照恢复参数无效。');
    return this.commitSnapshot('restore', parsed.data);
  }

  private commitSnapshot(kind: 'create' | 'restore', request: SnapshotCreateRequest | SnapshotRestoreRequest): WorkDetail {
    const db = this.projectDb(request.workId);
    const hash = createHash('sha256').update(JSON.stringify(['snapshot', kind, request])).digest('hex');
    db.transaction(() => {
      if (this.meta(db).deleted_at) throw new RepositoryError('NOT_FOUND', '作品已删除。');
      const prior = db.prepare('SELECT request_hash FROM operation_log WHERE operation_id=?').get(request.operationId) as { request_hash: string } | undefined;
      if (prior) {
        if (prior.request_hash !== hash) throw new RepositoryError('INVALID_INPUT', '操作标识已用于不同内容。');
        return;
      }
      if (this.meta(db).revision !== request.expectedRevision) throw new RepositoryError('REVISION_CONFLICT', '作品版本已变化，请重新读取后操作快照。');
      // 快照先捕获输入版本；恢复助手内部递增一次，避免通用commit预先递增后再恢复。
      if ('title' in request) {
        captureSnapshot(db, request.title);
        db.prepare('UPDATE work_meta SET revision=revision+1,updated_at=? WHERE revision=?').run(new Date().toISOString(), request.expectedRevision);
      } else applySnapshot(db, request.snapshotId, request.expectedRevision);
      db.prepare('INSERT INTO operation_log VALUES(?,?,?)').run(request.operationId, hash, JSON.stringify({ revision: request.expectedRevision + 1 }));
    }).immediate();
    this.refreshCache(request.workId);
    return this.openWork(request.workId);
  }

  private commit<T>(workId: string, expectedRevision: number, operationId: string,
    request: unknown[], mutate: (db: Database.Database, revision: number) => T, allowDeleted = false): T {
    validId(operationId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new RepositoryError('INVALID_INPUT', '版本号无效。');
    }
    const db = this.projectDb(workId);
    if (!allowDeleted && this.meta(db).deleted_at) throw new RepositoryError('NOT_FOUND', '作品已删除，可从设置的本机数据恢复。');
    const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const result = db.transaction(() => {
      const prior = db.prepare('SELECT request_hash, result_json FROM operation_log WHERE operation_id = ?')
        .get(operationId) as { request_hash: string; result_json: string } | undefined;
      if (prior) {
        if (prior.request_hash !== hash) throw new RepositoryError('INVALID_INPUT', '操作标识已用于不同内容。');
        return JSON.parse(prior.result_json) as T;
      }
      const changed = db.prepare(`UPDATE work_meta SET revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?`).run(new Date().toISOString(), workId, expectedRevision);
      if (!changed.changes) throw new RepositoryError('REVISION_CONFLICT', '正文版本已变化，请重新读取后保存。');
      const value = mutate(db, expectedRevision + 1);
      db.prepare('INSERT INTO operation_log VALUES (?, ?, ?)').run(operationId, hash, JSON.stringify(value));
      return value;
    }).immediate();
    this.refreshCache(workId);
    return result;
  }

  manageStructure(value: StructureRequest): WorkDetail | null {
    const parsed = structureRequestSchema.safeParse(value);
    if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '卷章操作参数无效。');
    const { workId, expectedRevision, operationId, action } = parsed.data;
    this.commit(workId, expectedRevision, operationId, ['structure', action, expectedRevision],
      (db, revision) => {
        applyStructure(db, action, revision);
        if (action.type === 'deleteChapter' || action.type === 'restoreChapter') {
          refreshChapterSearch(db, action.chapterId);
        } else if (action.type === 'deleteVolume' || action.type === 'restoreVolume') {
          const volumeId = action.volumeId;
          for (const chapter of db.prepare('SELECT id FROM chapter WHERE volume_id = ?').all(volumeId) as { id: string }[]) {
            refreshChapterSearch(db, chapter.id);
          }
        }
        return { revision };
      }, true);
    return this.meta(this.projectDb(workId)).deleted_at ? null : this.openWork(workId);
  }

  addChapter(workId: string, title: string, expectedRevision: number, operationId: string, volumeId: string | null = null): WorkDetail {
    title = validTitle(title);
    if (volumeId !== null) validId(volumeId);
    const request = volumeId === null ? ['addChapter', title, expectedRevision] : ['addChapter', title, expectedRevision, volumeId];
    this.commit(workId, expectedRevision, operationId, request, (db, revision) => {
      assertVolume(db, volumeId);
      const chapterId = randomUUID();
      db.prepare('INSERT INTO chapter (id, title, document_json, word_count, sort_order, volume_id) VALUES (?, ?, ?, 0, ?, ?)')
        .run(chapterId, title, JSON.stringify(emptyDocument()), nextChapterOrder(db, volumeId), volumeId);
      return { chapterId, revision };
    });
    return this.openWork(workId);
  }

  saveChapter(workId: string, chapterId: string, title: string, value: WritingDocument,
    expectedRevision: number, operationId: string): SaveResult {
    title = validTitle(title);
    validId(chapterId);
    let document: WritingDocument;
    try { document = validateDocument(value); } catch {
      throw new RepositoryError('INVALID_INPUT', '正文结构无效，请保留草稿并检查内容。');
    }
    const words = countDocumentWords(document);
    const receipt = this.commit(workId, expectedRevision, operationId,
      ['saveChapter', chapterId, title, document, expectedRevision], (db, revision) => {
        const changed = db.prepare('UPDATE chapter SET title = ?, document_json = ?, word_count = ? WHERE id = ? AND deleted_at IS NULL')
          .run(title, JSON.stringify(document), words, chapterId);
        if (!changed.changes) throw new RepositoryError('NOT_FOUND', '章节不属于当前作品。');
        refreshChapterSearch(db, chapterId);
        return { revision, wordCount: words };
      });
    // 回执只存版本与字数；资产按当前库读取，避免自动保存重复复制及重放旧资产。
    return { ...receipt, assets: readAssets(this.projectDb(workId)) };
  }

  close() {
    if (this.closed) return;
    this.current?.db.close();
    this.catalog?.close();
    this.current = undefined;
    this.closed = true;
  }
}
