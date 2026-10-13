import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';
import { exportProjectDatabase, importArchivedProject } from '../../src/workers/database/archive-project';
import { createSnapshot, restoreSnapshot } from '../../src/workers/database/snapshots';
import type { ParsedProjectArchive } from '../../src/shared/archive';

const directories: string[] = [];
afterEach(() => { directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-chat-archive-')); directories.push(directory);
  const repository = new WorkRepository(directory), work = repository.createWork('会话作品'); repository.close();
  return { directory, work, projects: join(directory, 'Projects'), file: join(directory, 'Projects', work.id, 'project.sqlite') };
}
function input(workId: string, database: Buffer, schemaVersion = 8): ParsedProjectArchive {
  return { database, manifest: { formatVersion: 1, projectId: workId, schemaVersion, databaseSha256: hash(database) } };
}
function mutate(bytes: Buffer, change: (db: Database.Database) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-chat-archive-change-')); directories.push(directory);
  const file = join(directory, 'archive.sqlite'); writeFileSync(file, bytes);
  const db = new Database(file); try { change(db); } finally { db.close(); } return readFileSync(file);
}
function seed(db: Database.Database) {
  const id = randomUUID(), date = new Date().toISOString();
  db.prepare('INSERT INTO conversation VALUES(?,?,1,?,?,?,NULL)').run(id, '离线讨论', '未发送草稿', date, date);
  db.prepare('INSERT INTO conversation_message VALUES(?,?,?,?,?,?,0)').run(randomUUID(), id, 'user', '我的想法', date, null);
  db.prepare('INSERT INTO conversation_operation VALUES(?,?,?)').run(randomUUID(), '内部回执', '{}'); return id;
}
describe('会话归档与正文快照边界', () => {
  it('当前归档包含会话草稿和消息，排除回执；导入保留会话且不改原作品', async () => {
    const { projects, file, work } = setup(), db = new Database(file); const id = seed(db); db.close();
    const bytes = await exportProjectDatabase(projects, work.id, 1), importedId = randomUUID();
    importArchivedProject(projects, input(work.id, bytes), importedId);
    const imported = new Database(join(projects, importedId, 'project.sqlite'));
    try {
      expect(imported.pragma('user_version', { simple: true })).toBe(8);
      expect(imported.prepare('SELECT title,draft FROM conversation WHERE id=?').get(id)).toEqual({ title: '离线讨论', draft: '未发送草稿' });
      expect(imported.prepare('SELECT content FROM conversation_message').all()).toEqual([{ content: '我的想法' }]);
      expect(imported.prepare('SELECT * FROM conversation_operation').all()).toEqual([]);
    } finally { imported.close(); }
  });
  it('真实V4归档兼容导入为V8空会话；版本伪装与未知会话schema拒绝', async () => {
    const { projects, work } = setup(); const bytes = await exportProjectDatabase(projects, work.id, 1);
    const legacy = mutate(bytes, db => { db.exec('DROP TABLE source_capture; DROP TABLE learning_annotation; DROP TABLE knowledge_source; DROP TABLE source_segment; DROP TABLE source_document; DROP TABLE conversation_message; DROP TABLE conversation;'); db.pragma('user_version=4'); });
    const id = randomUUID(); importArchivedProject(projects, input(work.id, legacy, 4), id);
    const imported = new Database(join(projects, id, 'project.sqlite'));
    try { expect(imported.pragma('user_version', { simple: true })).toBe(8); expect(imported.prepare('SELECT * FROM conversation').all()).toEqual([]); }
    finally { imported.close(); }
    expect(() => importArchivedProject(projects, input(work.id, bytes, 4), randomUUID())).toThrow(/清单不一致/);
    const malicious = mutate(legacy, db => db.exec('CREATE TABLE conversation(id TEXT)'));
    expect(() => importArchivedProject(projects, input(work.id, malicious, 4), randomUUID())).toThrow(/未知结构/);
  });
  it('正文快照完全排除会话，恢复早期正文仍保留当前草稿消息', () => {
    const { file } = setup(), db = new Database(file);
    try {
      const snapshot = createSnapshot(db, '没有会话的正文'); seed(db);
      const payload = JSON.parse((db.prepare('SELECT payload_json FROM snapshot WHERE id=?').get(snapshot.id) as { payload_json: string }).payload_json);
      expect(Object.keys(payload).some(key => key.startsWith('conversation'))).toBe(false);
      restoreSnapshot(db, snapshot.id, 1);
      expect(db.prepare('SELECT draft FROM conversation').all()).toEqual([{ draft: '未发送草稿' }]);
      expect(db.prepare('SELECT content FROM conversation_message').all()).toEqual([{ content: '我的想法' }]);
    } finally { db.close(); }
  });
  it.each(['role', 'hash', 'date', 'orphan', 'order'])('拒绝篡改会话消息 %s，原项目仍可打开', async mode => {
    const { projects, work, file } = setup(), db = new Database(file); seed(db); db.close();
    const bytes = await exportProjectDatabase(projects, work.id, 1);
    const invalid = mutate(bytes, altered => {
      altered.pragma('ignore_check_constraints=ON');
      altered.pragma('foreign_keys=OFF');
      if (mode === 'role') altered.prepare("UPDATE conversation_message SET role='system'").run();
      if (mode === 'hash') altered.prepare("UPDATE conversation_message SET request_hash='伪造'").run();
      if (mode === 'date') altered.prepare("UPDATE conversation_message SET created_at='伪造'").run();
      if (mode === 'orphan') altered.prepare('UPDATE conversation_message SET conversation_id=?').run(randomUUID());
      if (mode === 'order') altered.prepare('UPDATE conversation_message SET sort_order=-1').run();
    });
    expect(() => importArchivedProject(projects, input(work.id, invalid), randomUUID())).toThrow();
    const original = new Database(file); try { expect(original.prepare('SELECT content FROM conversation_message').all()).toEqual([{ content: '我的想法' }]); } finally { original.close(); }
  });
});
