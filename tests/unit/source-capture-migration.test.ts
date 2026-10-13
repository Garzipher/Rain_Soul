import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { assetFixture } from './assets-helper';
import { freezeSource } from '../../src/main/freeze-source';
import { initializeSchema } from '../../src/workers/database/schema';
import { initializeSourceSchema } from '../../src/workers/database/source-schema';
import { initializeSnapshots } from '../../src/workers/database/snapshots';
import { initializeConversations } from '../../src/workers/database/conversations';
import { commitSourceAssets, readSourceAssets } from '../../src/workers/database/source-document';

const databases: Database.Database[] = [], directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const capturedAt = '2026-10-13T00:00:00.000Z';
const webInput = { kind: 'web' as const, title: '文章', rawBytes: Buffer.from('原始HTML'), segments: [{ text: '原文' }],
  originalUrl: 'https://example.com/article', finalUrl: 'https://example.com/article', fetchedAt: capturedAt };
function sourceDb() { const { db } = assetFixture(); databases.push(db); initializeSourceSchema(db); return db; }
function legacyV7() {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-capture-v7-')); directories.push(directory);
  const db = sourceDb(); initializeSnapshots(db); initializeConversations(db);
  const source = freezeSource(webInput); db.transaction(() => commitSourceAssets(db, source, [], []))();
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='source_capture'").get()) db.exec('DROP TABLE source_capture');
  db.pragma('user_version=7'); const file = join(directory, 'project.sqlite'); db.prepare('VACUUM INTO ?').run(file); db.close();
  const legacy = new Database(file); databases.push(legacy); legacy.pragma('foreign_keys=ON'); return { db: legacy, directory, source };
}

it('新作品版本8包含捕获关系', () => {
  const db = new Database(':memory:'); databases.push(db); initializeSchema(db, 'project');
  expect(db.pragma('user_version', { simple: true })).toBe(8);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='source_capture'").get()).toEqual({ name: 'source_capture' });
});
it('v7升级仅备份一次并保留旧来源全部内容', () => {
  const { db, directory, source } = legacyV7(); initializeSchema(db, 'project');
  expect(db.pragma('user_version', { simple: true })).toBe(8);
  expect(readSourceAssets(db).documents).toEqual([source]);
  expect(db.prepare('SELECT * FROM source_capture').all()).toEqual([]);
  initializeSchema(db, 'project'); expect(readdirSync(directory).filter(name => name.includes('v7-backup'))).toHaveLength(1);
});
it('v7备份失败零修改', () => {
  const { db, source } = legacyV7(), prepare = db.prepare.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation(sql => { if (sql === 'VACUUM INTO ?') throw new Error('磁盘已满'); return prepare(sql); });
  expect(() => initializeSchema(db, 'project')).toThrow(/备份未成功/); vi.restoreAllMocks();
  expect(db.pragma('user_version', { simple: true })).toBe(7); expect(readSourceAssets(db).documents).toEqual([source]);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='source_capture'").get()).toBeUndefined();
});
it('v7迁移校验失败回滚捕获表和版本', () => {
  const { db, source } = legacyV7(), pragma = db.pragma.bind(db);
  vi.spyOn(db, 'pragma').mockImplementation((sql, options) => sql === 'foreign_key_check' ? [{ table: 'broken' }] : pragma(sql, options));
  expect(() => initializeSchema(db, 'project')).toThrow(/升级失败/); vi.restoreAllMocks();
  expect(db.pragma('user_version', { simple: true })).toBe(7); expect(readSourceAssets(db).documents).toEqual([source]);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='source_capture'").get()).toBeUndefined();
});
