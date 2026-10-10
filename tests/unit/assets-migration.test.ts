import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSchema } from '../../src/workers/database/schema';
import { projectSchema } from '../../src/workers/database/project-schema';
import { searchAssets } from '../../src/workers/database/assets-search';
import { emptyDocument } from '../../src/shared/document';

describe('作品库 schema 3 资产迁移', () => {
  let directory: string; let db: Database.Database;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'rainsoul-assets-migrate-')); db = new Database(join(directory, 'project.sqlite')); });
  afterEach(() => { vi.restoreAllMocks(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  function legacyV2() {
    db.pragma('journal_mode=WAL'); db.pragma('wal_autocheckpoint=0'); db.exec(projectSchema); db.pragma('user_version=2');
    const document = emptyDocument(); document.content[0].content = [{ type: 'text', text: '旧库灯塔旁的风。' }];
    db.prepare('INSERT INTO work_meta(id,title,revision,updated_at) VALUES(?,?,7,?)').run(randomUUID(), '旧作品', new Date().toISOString());
    db.prepare('INSERT INTO chapter(id,title,document_json,word_count,sort_order) VALUES(?,?,?,8,0)').run(randomUUID(), '旧章', JSON.stringify(document));
    return document;
  }
  it('v2备份包含WAL最新正文，一次升级全部资产和索引且不重复备份', () => {
    const document = legacyV2(); initializeSchema(db, 'project');
    expect(db.pragma('user_version', { simple: true })).toBe(6);
    expect(searchAssets(db, { text: '灯塔旁', mode: 'all' })).toHaveLength(1);
    const backups = readdirSync(directory).filter(name => name.includes('v2-backup')); expect(backups).toHaveLength(1);
    const backup = new Database(join(directory, backups[0]), { readonly: true });
    try { expect(backup.pragma('user_version', { simple: true })).toBe(2); expect(JSON.parse((backup.prepare('SELECT document_json FROM chapter').get() as { document_json: string }).document_json)).toEqual(document); }
    finally { backup.close(); }
    initializeSchema(db, 'project'); expect(readdirSync(directory).filter(name => name.includes('v2-backup'))).toEqual(backups);
  });
  it('schema 0所有正式表与资产表在同一事务创建，后半部失败不留下半成品', () => {
    db.exec('CREATE TABLE category(id TEXT)');
    expect(() => initializeSchema(db, 'project')).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('work_meta','chapter','volume','operation_log')").all()).toEqual([]);
  });
  it('v2资产DDL失败保留旧正文及升级前备份，schema和user_version回滚', () => {
    legacyV2(); db.exec('CREATE TABLE category(id TEXT)');
    expect(() => initializeSchema(db, 'project')).toThrowError(expect.objectContaining({ code: 'MIGRATION_FAILED' }));
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(db.prepare('SELECT revision FROM work_meta').get()).toEqual({ revision: 7 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('knowledge_entry','style_profile')").all()).toEqual([]);
    expect(readdirSync(directory).filter(name => name.includes('v2-backup'))).toHaveLength(1);
  });
  it.each(['quick_check', 'foreign_key_check'])('迁移后 %s 不通过全部回滚，已有回执不被覆盖', kind => {
    legacyV2(); db.prepare('INSERT INTO operation_log VALUES(?,?,?)').run(randomUUID(), '回执', '{}');
    const original = db.pragma.bind(db);
    vi.spyOn(db, 'pragma').mockImplementation((sql, options) => sql === kind ? kind === 'quick_check' ? 'failed' : [{ table: 'broken' }] : original(sql, options));
    expect(() => initializeSchema(db, 'project')).toThrowError(expect.objectContaining({ code: 'MIGRATION_FAILED' }));
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(db.prepare('SELECT * FROM operation_log').all()).toHaveLength(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='knowledge_entry'").get()).toBeUndefined();
  });
  it('v2坏正文导致索引构建失败，升级不吞掉原稿也不留下资产表', () => {
    legacyV2(); db.prepare('UPDATE chapter SET document_json=?').run('{"type":"doc","content":[]}');
    expect(() => initializeSchema(db, 'project')).toThrowError(expect.objectContaining({ code: 'MIGRATION_FAILED' }));
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='category'").get()).toBeUndefined();
  });
});
