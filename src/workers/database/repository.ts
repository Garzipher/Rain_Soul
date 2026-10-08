import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Chapter, SaveResult, WorkDetail, WorkSummary, WritingDocument } from '../../shared/contracts';
import { countDocumentWords, emptyDocument, validateDocument } from '../../shared/document';
import { initializeSchema, RepositoryError } from './schema';
export { RepositoryError } from './schema';

interface Meta { id: string; title: string; revision: number; updated_at: string }
interface ChapterRow { id: string; title: string; document_json: string; word_count: number }
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
      initializeSchema(db, 'project');
      if (this.meta(db).id !== id) throw new RepositoryError('INVALID_FILE', '作品标识与目录不一致。');
    } catch (error) { db.close(); throw error; }
    this.current?.db.close();
    this.current = { id, db };
    return db;
  }

  private meta(db: Database.Database): Meta {
    const meta = db.prepare('SELECT * FROM work_meta').get() as Meta | undefined;
    if (!meta) throw new RepositoryError('INVALID_FILE', '作品元数据缺失。');
    return meta;
  }

  private updateCatalog(id: string) {
    const db = this.projectDb(id);
    const meta = this.meta(db);
    const totals = db.prepare('SELECT COALESCE(SUM(word_count), 0) AS words, COUNT(*) AS chapters FROM chapter')
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
        project.prepare('INSERT INTO work_meta VALUES (?, ?, 1, ?)').run(id, title, new Date().toISOString());
        project.prepare('INSERT INTO chapter VALUES (?, ?, ?, 0, 0)')
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

  private refreshCache(id: string) {
    // 正文已提交；目录缓存失败只标记待刷新，禁止把成功落盘伪装成保存失败。
    try { this.updateCatalog(id); } catch { this.pending.add(id); }
  }

  openWork(id: string): WorkDetail {
    const db = this.projectDb(id);
    const meta = this.meta(db);
    const chapters = (db.prepare('SELECT * FROM chapter ORDER BY sort_order').all() as ChapterRow[])
      .map((row): Chapter => ({ id: row.id, title: row.title,
        document: validateDocument(JSON.parse(row.document_json)), wordCount: row.word_count }));
    return { id: meta.id, title: meta.title, revision: meta.revision, chapters };
  }

  private commit<T>(workId: string, expectedRevision: number, operationId: string,
    request: unknown[], mutate: (db: Database.Database, revision: number) => T): T {
    validId(operationId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new RepositoryError('INVALID_INPUT', '版本号无效。');
    }
    const db = this.projectDb(workId);
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

  addChapter(workId: string, title: string, expectedRevision: number, operationId: string): WorkDetail {
    title = validTitle(title);
    this.commit(workId, expectedRevision, operationId, ['addChapter', title, expectedRevision], (db, revision) => {
      const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM chapter')
        .get() as { next: number };
      const chapterId = randomUUID();
      db.prepare('INSERT INTO chapter VALUES (?, ?, ?, 0, ?)')
        .run(chapterId, title, JSON.stringify(emptyDocument()), order.next);
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
    return this.commit(workId, expectedRevision, operationId,
      ['saveChapter', chapterId, title, document, expectedRevision], (db, revision) => {
        const changed = db.prepare('UPDATE chapter SET title = ?, document_json = ?, word_count = ? WHERE id = ?')
          .run(title, JSON.stringify(document), words, chapterId);
        if (!changed.changes) throw new RepositoryError('NOT_FOUND', '章节不属于当前作品。');
        return { revision, wordCount: words };
      });
  }

  close() {
    if (this.closed) return;
    this.current?.db.close();
    this.catalog?.close();
    this.current = undefined;
    this.closed = true;
  }
}
