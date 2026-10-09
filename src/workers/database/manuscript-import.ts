import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { manuscriptImportRequestSchema, type ManuscriptImportRequest } from '../../shared/manuscript-schema';
import { countDocumentWords, emptyDocument } from '../../shared/document';
import { initializeSchema } from './schema';
import { refreshChapterSearch } from './assets-search';
import type { WritingDocument } from '../../shared/contracts';

/** 新作品在暂存目录完整提交并关闭后才出现在书架；operationId用于回执丢失时重放。 */
export function createImportedProject(projects: string, value: ManuscriptImportRequest): string {
  const request = manuscriptImportRequestSchema.parse(value), id = request.operationId;
  const hash = createHash('sha256').update(JSON.stringify(request.draft)).digest('hex');
  const destination = join(projects, id), staging = join(projects, `.importing-${randomUUID()}`);
  if (existsSync(destination)) {
    const file = join(destination, 'project.sqlite');
    if (lstatSync(destination).isSymbolicLink() || !existsSync(file) || lstatSync(file).isSymbolicLink()) throw new Error('导入操作路径无效。');
    const existing = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const table = existing.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_receipt'").get();
      const receipt = table ? existing.prepare('SELECT request_hash FROM import_receipt').get() as { request_hash: string } | undefined : undefined;
      if (receipt?.request_hash !== hash) throw new Error('导入操作标识已用于不同内容。');
      return id;
    } finally { existing.close(); }
  }
  mkdirSync(projects, { recursive: true }); mkdirSync(staging);
  let db: Database.Database | undefined;
  try {
    db = new Database(join(staging, 'project.sqlite')); initializeSchema(db, 'project');
    const project = db;
    project.transaction(() => {
      project.prepare('INSERT INTO work_meta (id,title,revision,updated_at) VALUES (?,?,1,?)').run(id, request.draft.title, new Date().toISOString());
      project.exec('CREATE TABLE import_receipt (request_hash TEXT NOT NULL)');
      project.prepare('INSERT INTO import_receipt VALUES (?)').run(hash);
      const volumes = new Map<string, string>(), orders = new Map<string | null, number>();
      for (const chapter of request.draft.chapters) {
        let volumeId: string | null = null;
        if (chapter.volumeTitle !== null) {
          volumeId = volumes.get(chapter.volumeTitle) ?? randomUUID();
          if (!volumes.has(chapter.volumeTitle)) { project.prepare('INSERT INTO volume (id,title,sort_order) VALUES (?,?,?)').run(volumeId, chapter.volumeTitle, volumes.size); volumes.set(chapter.volumeTitle, volumeId); }
        }
        const chapterId = randomUUID();
        const document: WritingDocument = chapter.paragraphs.length ? { type: 'doc', content: chapter.paragraphs.map(text => ({ type: 'paragraph', attrs: { id: randomUUID() }, content: text ? [{ type: 'text', text }] : [] })) } : emptyDocument();
        const order = orders.get(volumeId) ?? 0; orders.set(volumeId, order + 1);
        project.prepare('INSERT INTO chapter (id,title,document_json,word_count,sort_order,volume_id) VALUES (?,?,?,?,?,?)')
          .run(chapterId, chapter.title, JSON.stringify(document), countDocumentWords(document), order, volumeId);
        refreshChapterSearch(project, chapterId);
      }
    }).immediate();
    project.pragma('wal_checkpoint(TRUNCATE)'); project.close(); db = undefined;
    renameSync(staging, destination); return id;
  } catch (error) { db?.close(); rmSync(staging, { recursive: true, force: true }); throw error; }
}
