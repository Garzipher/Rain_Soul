import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSchema } from '../../src/workers/database/schema';

describe('会话 schema 5 的备份前向迁移', () => {
  let directory: string, db: Database.Database;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-chat-migration-'));
    db = new Database(join(directory, 'project.sqlite')); initializeSchema(db, 'project');
    db.exec('DROP TABLE IF EXISTS conversation_operation; DROP TABLE IF EXISTS conversation_message; DROP TABLE IF EXISTS conversation;');
    db.exec('DROP TABLE source_capture; DROP TABLE learning_annotation; DROP TABLE knowledge_source; DROP TABLE source_segment; DROP TABLE source_document;');
    db.pragma('user_version=4'); db.pragma('wal_autocheckpoint=0');
    db.prepare('INSERT INTO work_meta(id,title,revision,updated_at) VALUES(?,?,7,?)').run(randomUUID(), '旧作品', new Date().toISOString());
  });
  afterEach(() => { vi.restoreAllMocks(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  it('迁移包含 WAL 元数据备份，增加会话表而保留正文版本，重开不再备份', () => {
    initializeSchema(db, 'project'); expect(db.pragma('user_version', { simple: true })).toBe(8);
    expect(db.prepare('SELECT revision FROM work_meta').get()).toEqual({ revision: 7 });
    expect(db.prepare('SELECT * FROM conversation').all()).toEqual([]);
    const names = readdirSync(directory).filter(name => name.includes('v4-backup')); expect(names).toHaveLength(1);
    const backup = new Database(join(directory, names[0]), { readonly: true });
    try { expect(backup.pragma('user_version', { simple: true })).toBe(4); expect(backup.prepare('SELECT revision FROM work_meta').get()).toEqual({ revision: 7 }); }
    finally { backup.close(); }
    initializeSchema(db, 'project'); expect(readdirSync(directory).filter(name => name.includes('v4-backup'))).toEqual(names);
  });
  it('备份失败不修改原库，DDL 冲突则整笔回滚并保留原版备份', () => {
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(sql => { if (sql === 'VACUUM INTO ?') throw new Error('磁盘不足'); return prepare(sql); });
    expect(() => initializeSchema(db, 'project')).toThrow(/备份未成功/);
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='conversation'").get()).toBeUndefined();
    vi.restoreAllMocks(); db.exec('CREATE TABLE conversation_message(id TEXT)');
    expect(() => initializeSchema(db, 'project')).toThrowError(expect.objectContaining({ code: 'MIGRATION_FAILED' }));
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='conversation'").get()).toBeUndefined();
    expect(readdirSync(directory).filter(name => name.includes('v4-backup'))).toHaveLength(1);
  });
});
