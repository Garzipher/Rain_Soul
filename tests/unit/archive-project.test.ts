import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';
import { exportProjectDatabase, importArchivedProject } from '../../src/workers/database/archive-project';
import { createSnapshot, listSnapshots, restoreSnapshot } from '../../src/workers/database/snapshots';
import type { ParsedProjectArchive } from '../../src/shared/archive';

const directories: string[] = [], databases: Database.Database[] = [];
afterEach(() => { databases.splice(0).forEach(db => { if (db.open) db.close(); }); directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-archive-db-')); directories.push(directory);
  const repository = new WorkRepository(directory), work = repository.createWork('原作品'); repository.close();
  const projects = join(directory, 'Projects'), source = new Database(join(projects, work.id, 'project.sqlite')); databases.push(source);
  source.pragma('foreign_keys=ON'); source.pragma('journal_mode=WAL'); source.pragma('wal_autocheckpoint=0');
  const document = work.chapters[0].document; document.content[0].content = [{ type: 'text', text: '未检查点正文' }];
  source.prepare('UPDATE chapter SET document_json=?,word_count=6').run(JSON.stringify(document));
  return { directory, projects, source, work, document };
}
const archive = (workId: string, database: Buffer): ParsedProjectArchive => ({ manifest: { formatVersion: 1, projectId: workId, schemaVersion: 6, databaseSha256: sha(database) }, database });
function changed(input: ParsedProjectArchive, callback: (db: Database.Database) => void): ParsedProjectArchive {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-archive-change-')); directories.push(directory);
  const path = join(directory, 'source.sqlite'); writeFileSync(path, input.database);
  const db = new Database(path); try { callback(db); } finally { db.close(); }
  const database = readFileSync(path); return { ...input, manifest: { ...input.manifest, databaseSha256: sha(database) }, database };
}

describe('归档数据库隔离重建', () => {
  it.each(['missing', 'deleted', 'nested', 'renamed'])('拒绝损坏的保留未分类：%s，现有项目与历史不变', async mode => {
    const { projects, work } = setup();
    const input = archive(work.id, await exportProjectDatabase(projects, work.id, work.revision));
    const broken = changed(input, db => {
      if (mode === 'missing') db.prepare("UPDATE category SET system_key=NULL WHERE system_key='uncategorized'").run();
      if (mode === 'deleted') db.prepare("UPDATE category SET deleted_at=? WHERE system_key='uncategorized'").run(new Date().toISOString());
      if (mode === 'nested') db.prepare("UPDATE category SET parent_id=(SELECT id FROM category WHERE system_key IS NULL LIMIT 1) WHERE system_key='uncategorized'").run();
      if (mode === 'renamed') db.prepare("UPDATE category SET name='被改名' WHERE system_key='uncategorized'").run();
    });
    const before = readdirSync(projects);
    expect(() => importArchivedProject(projects, broken, randomUUID())).toThrow(/未分类/);
    expect(readdirSync(projects)).toEqual(before);
  });
  it('导出包含未检查点WAL正文，剥离回执/未知资料/教材tracking/索引且原库不变', async () => {
    const { projects, source, work, document } = setup();
    source.exec("CREATE TABLE api_keys (value TEXT); INSERT INTO api_keys VALUES('私密key'); CREATE TABLE learning_course(course_key TEXT PRIMARY KEY); INSERT INTO learning_course VALUES('project-full-development-learning');");
    source.prepare('INSERT INTO operation_log VALUES(?,?,?)').run('旧操作', '旧hash', '{}');
    const bytes = await exportProjectDatabase(projects, work.id, 1);
    const path = join(projects, 'check.sqlite'); writeFileSync(path, bytes); const copy = new Database(path); databases.push(copy);
    const names = (copy.prepare('SELECT name FROM sqlite_master').all() as { name: string }[]).map(row => row.name);
    expect(names).not.toContain('api_keys'); expect(names).not.toContain('operation_log'); expect(names).not.toContain('learning_course'); expect(names).not.toContain('search_fts');
    expect(copy.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger','view')").all()).toEqual([]);
    expect(JSON.parse((copy.prepare('SELECT document_json FROM chapter').get() as { document_json: string }).document_json)).toEqual(document);
    expect(source.prepare('SELECT value FROM api_keys').get()).toEqual({ value: '私密key' });
    expect(source.prepare('SELECT * FROM operation_log').all()).toHaveLength(1);
    expect(readdirSync(projects).some(name => name.startsWith('.archiv'))).toBe(false);
  });
  it('导入为独立新作品；全部快照改作品ID并重算hash，恢复可用，重放不重复', async () => {
    const { directory, projects, source, work } = setup();
    const old = createSnapshot(source, '旧原稿'); source.prepare('UPDATE chapter SET title=?').run('当前章节'); createSnapshot(source, '当前稿');
    const input = archive(work.id, await exportProjectDatabase(projects, work.id, 1)), operationId = randomUUID();
    expect(importArchivedProject(projects, input, operationId)).toBe(operationId);
    expect(importArchivedProject(projects, input, operationId)).toBe(operationId);
    const imported = new Database(join(projects, operationId, 'project.sqlite')); databases.push(imported);
    expect(listSnapshots(imported)).toHaveLength(2);
    for (const row of imported.prepare('SELECT payload_json,payload_hash FROM snapshot').all() as { payload_json: string; payload_hash: string }[]) {
      expect(JSON.parse(row.payload_json).work_meta[0].id).toBe(operationId); expect(row.payload_hash).toBe(sha(row.payload_json));
    }
    restoreSnapshot(imported, old.id, 1);
    expect(imported.prepare('SELECT title FROM chapter').get()).toEqual({ title: '第一章' });
    expect(imported.pragma('foreign_key_check')).toEqual([]);
    const reopened = new WorkRepository(directory);
    try { expect(reopened.listWorks()).toHaveLength(2); expect(reopened.openWork(work.id).chapters[0].title).toBe('当前章节'); } finally { reopened.close(); }
  });
  it('相同operationId不同归档、原作品ID冲突、非法ID和版本不覆盖现有作品', async () => {
    const { projects, work } = setup(), input = archive(work.id, await exportProjectDatabase(projects, work.id, 1)), operationId = randomUUID();
    importArchivedProject(projects, input, operationId);
    expect(() => importArchivedProject(projects, changed(input, db => db.prepare('UPDATE work_meta SET title=?').run('另一份')), operationId)).toThrow(/操作/);
    expect(() => importArchivedProject(projects, input, work.id)).toThrow(/操作/);
    expect(() => importArchivedProject(projects, input, '../外部')).toThrow(/标识/);
    await expect(exportProjectDatabase(projects, work.id, 99)).rejects.toThrow(/版本/);
    expect(readdirSync(projects).filter(name => name.startsWith('.archiv'))).toEqual([]);
  });
  it('哈希/schema/异作元数据/SQLite损坏均拒绝，失败不留下staging或新项目', async () => {
    const { projects, work } = setup(), input = archive(work.id, await exportProjectDatabase(projects, work.id, 1));
    for (const invalid of [
      { ...input, manifest: { ...input.manifest, databaseSha256: '0'.repeat(64) } },
      { ...input, manifest: { ...input.manifest, schemaVersion: 99 } },
      changed(input, db => db.pragma('user_version=99')),
      changed(input, db => db.prepare('UPDATE work_meta SET id=?').run(randomUUID())),
      archive(work.id, Buffer.from('不是SQLite')),
    ]) expect(() => importArchivedProject(projects, invalid, randomUUID())).toThrow();
    expect(readdirSync(projects)).toEqual([work.id]);
  });
  it('未知表、触发器、视图、恶意替代业务schema拒绝，不执行任意归档SQL', async () => {
    const { projects, work } = setup(), input = archive(work.id, await exportProjectDatabase(projects, work.id, 1));
    for (const sql of [
      'CREATE TABLE api_keys(value TEXT)',
      "CREATE TRIGGER bad AFTER UPDATE ON work_meta BEGIN DELETE FROM chapter; END;",
      'CREATE VIEW bad AS SELECT * FROM chapter',
      'ALTER TABLE chapter ADD COLUMN malicious TEXT',
    ]) expect(() => importArchivedProject(projects, changed(input, db => db.exec(sql)), randomUUID())).toThrow(/结构|schema/);
    expect(readdirSync(projects)).toEqual([work.id]);
  });
  it('文档、悬空外键/书签、分类环与快照hash/格式非法时拒绝整个导入', async () => {
    const { projects, work } = setup(), input = archive(work.id, await exportProjectDatabase(projects, work.id, 1));
    const badDocument = changed(input, db => db.prepare('UPDATE chapter SET document_json=?').run('{"type":"doc","content":[]}'));
    const badFk = changed(input, db => { db.pragma('foreign_keys=OFF'); db.prepare('UPDATE chapter SET volume_id=?').run(randomUUID()); });
    const badBookmark = changed(input, db => { const document = work.chapters[0].document; document.content[0].content = [{ type: 'bookmark', attrs: { id: randomUUID(), kind: 'knowledge', targetId: randomUUID() } }]; db.prepare('UPDATE chapter SET document_json=?,word_count=0').run(JSON.stringify(document)); });
    const badCategory = changed(input, db => db.exec('UPDATE category SET parent_id=id'));
    for (const invalid of [badDocument, badFk, badBookmark, badCategory]) expect(() => importArchivedProject(projects, invalid, randomUUID())).toThrow();
    const snapshot = changed(input, db => { createSnapshot(db, '原稿'); db.prepare('UPDATE snapshot SET payload_json=?').run('{}'); });
    expect(() => importArchivedProject(projects, snapshot, randomUUID())).toThrow(/快照/);
    expect(readdirSync(projects)).toEqual([work.id]);
  });
  it('学习作品正文与快照保留，导入普通作品不认领默认教材', async () => {
    const { projects, source, work } = setup();
    source.exec("CREATE TABLE learning_course(course_key TEXT PRIMARY KEY); CREATE TABLE learning_volume(key TEXT PRIMARY KEY,volume_id TEXT); CREATE TABLE learning_seed(key TEXT PRIMARY KEY,chapter_id TEXT); INSERT INTO learning_course VALUES('project-full-development-learning');");
    source.prepare('INSERT INTO learning_seed VALUES (?,?)').run('课程第一章', work.chapters[0].id); createSnapshot(source, '课程原稿');
    const input = archive(work.id, await exportProjectDatabase(projects, work.id, 1)), id = importArchivedProject(projects, input, randomUUID());
    const db = new Database(join(projects, id, 'project.sqlite')); databases.push(db);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('learning_course','learning_volume','learning_seed')").all()).toEqual([]);
    const snapshot = db.prepare('SELECT payload_json FROM snapshot').get() as { payload_json: string };
    const payload = JSON.parse(snapshot.payload_json);
    expect(['learning_course', 'learning_volume', 'learning_seed'].some(key => Object.hasOwn(payload, key))).toBe(false);
    expect(db.prepare('SELECT * FROM chapter').all()).toHaveLength(1);
  });
  it('重算hash仍不能掩盖快照关系损坏、非法历史JSON、缺失表和重复段落', async () => {
    const { projects, work } = setup(), input = archive(work.id, await exportProjectDatabase(projects, work.id, 1));
    const corruptSnapshot = changed(input, db => {
      createSnapshot(db, '坏关系');
      const row = db.prepare('SELECT payload_json FROM snapshot').get() as { payload_json: string };
      const payload = JSON.parse(row.payload_json); payload.chapter[0].volume_id = randomUUID();
      const encoded = JSON.stringify(payload); db.prepare('UPDATE snapshot SET payload_json=?,payload_hash=?').run(encoded, sha(encoded));
    });
    expect(() => importArchivedProject(projects, corruptSnapshot, randomUUID())).toThrow(/快照/);
    const history = changed(input, db => db.prepare('INSERT INTO asset_history VALUES(?,?,?,?,?)').run('chapter', work.chapters[0].id, 1, 'before', '{'));
    expect(() => importArchivedProject(projects, history, randomUUID())).toThrow();
    const missing = changed(input, db => db.exec('DROP TABLE knowledge_history'));
    expect(() => importArchivedProject(projects, missing, randomUUID())).toThrow(/结构/);
    const duplicate = changed(input, db => {
      const row = db.prepare('SELECT * FROM chapter').get() as { document_json: string };
      db.prepare('INSERT INTO chapter(id,title,document_json,word_count,sort_order) VALUES(?,?,?,?,?)').run(randomUUID(), '复制章', row.document_json, 6, 1);
    });
    expect(() => importArchivedProject(projects, duplicate, randomUUID())).toThrow(/段落/);
    expect(readdirSync(projects)).toEqual([work.id]);
  });
  it('实体资产与证据/特点/历史均能完整往返，删除章节造成的失效证据保留', async () => {
    const { projects, source, work } = setup();
    const categoryId = (source.prepare('SELECT id FROM category LIMIT 1').get() as { id: string }).id;
    const knowledgeId = randomUUID(), foreshadowId = randomUUID(), profileId = randomUUID(), evidenceId = randomUUID();
    source.prepare('INSERT INTO knowledge_entry VALUES(?,?,?,?,?,1,NULL)').run(knowledgeId, '落雨描写', '参考书', categoryId, null);
    source.prepare('INSERT INTO foreshadow VALUES(?,?,?,?,NULL,NULL)').run(foreshadowId, '旧钥匙', '已埋设', '留下的钥匙');
    source.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,1,?,NULL,NULL)').run(evidenceId, foreshadowId, '埋设', work.chapters[0].id, work.chapters[0].document.content[0].attrs.id, '旧摘录', JSON.stringify({ chapterId: work.chapters[0].id, chapterTitle: '第一章', paragraphId: work.chapters[0].document.content[0].attrs.id, excerpt: '旧摘录', revision: 1 }));
    source.prepare('INSERT INTO style_profile VALUES(?,1,?,?)').run(profileId, JSON.stringify({ narrativePerson: '第三人称', pace: '慢', prohibited: [], referenceWorks: [] }), new Date().toISOString());
    source.prepare('UPDATE style_default SET profile_id=?').run(profileId);
    source.prepare('INSERT INTO asset_history VALUES(?,?,?,?,?)').run('foreshadow', foreshadowId, 1, 'before', JSON.stringify(source.prepare('SELECT * FROM foreshadow').get()));
    source.prepare('UPDATE chapter SET deleted_at=?').run(new Date().toISOString());
    const input = archive(work.id, await exportProjectDatabase(projects, work.id, 1)), id = importArchivedProject(projects, input, randomUUID());
    const db = new Database(join(projects, id, 'project.sqlite')); databases.push(db);
    expect(db.prepare('SELECT body FROM knowledge_entry').get()).toEqual({ body: '落雨描写' });
    expect(db.prepare('SELECT * FROM evidence').all()).toHaveLength(1); expect(db.prepare('SELECT * FROM asset_history').all()).toHaveLength(1);
    expect(db.prepare('SELECT profile_id FROM style_default').get()).toEqual({ profile_id: profileId });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
  it('真实SQLite允许的非业务字段值仍必须通过应用层类型和内容校验', async () => {
    const { projects, work } = setup(), input = archive(work.id, await exportProjectDatabase(projects, work.id, 1));
    for (const sql of [
      "UPDATE chapter SET title='   '",
      "UPDATE chapter SET sort_order=-1",
      "UPDATE chapter SET sort_order='不是数字'",
      'UPDATE chapter SET word_count=99',
      "UPDATE category SET id='错误ID'",
      'UPDATE work_meta SET deleted_at=\'2026-10-09\'',
      'DELETE FROM work_meta',
    ]) expect(() => importArchivedProject(projects, changed(input, db => db.exec(sql)), randomUUID())).toThrow();
    await expect(exportProjectDatabase(projects, work.id, NaN)).rejects.toThrow(/版本/);
    expect(readdirSync(projects)).toEqual([work.id]);
  });
});
