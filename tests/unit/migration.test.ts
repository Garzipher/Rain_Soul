import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateProjectV1 } from '../../src/workers/database/migration';
import { WorkRepository } from '../../src/workers/database/repository';
import { searchAssets } from '../../src/workers/database/assets-search';

describe('v1 作品库的一致备份与前向迁移', () => {
  let directory: string;
  let repository: WorkRepository | undefined;
  let source: Database.Database;
  let id: string;
  let file: string;
  let document: { type: 'doc'; content: { type: 'paragraph'; attrs: { id: string }; content: { type: 'text'; text: string }[] }[] };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-migration-'));
    id = randomUUID();
    const project = join(directory, 'Projects', id);
    mkdirSync(project, { recursive: true });
    file = join(project, 'project.sqlite');
    source = new Database(file);
    source.pragma('journal_mode = WAL');
    source.pragma('wal_autocheckpoint = 0');
    source.exec(`CREATE TABLE work_meta (id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE chapter (id TEXT PRIMARY KEY, title TEXT NOT NULL, document_json TEXT NOT NULL, word_count INTEGER NOT NULL, sort_order INTEGER NOT NULL UNIQUE);
      CREATE TABLE operation_log (operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result_json TEXT NOT NULL);
      PRAGMA user_version = 1;`);
    document = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: '旧版正文' }] }] };
    source.prepare('INSERT INTO work_meta VALUES (?, ?, 7, ?)').run(id, '旧版作品', new Date().toISOString());
    source.prepare('INSERT INTO chapter VALUES (?, ?, ?, 4, 0)').run(randomUUID(), '原章', JSON.stringify(document));
    source.prepare('INSERT INTO operation_log VALUES (?, ?, ?)').run(randomUUID(), '旧请求指纹', '{"revision":7,"wordCount":4}');
  });
  afterEach(() => { repository?.close(); repository = undefined; source.close(); rmSync(directory, { recursive: true, force: true }); });

  it('备份包含未检查点的 WAL 正文，迁移保留 ID、历史回执和版本且不重复备份', () => {
    repository = new WorkRepository(directory);
    expect(repository.openWork(id)).toMatchObject({ title: '旧版作品', revision: 7,
      chapters: [{ document, volumeId: null }], volumes: [], deletedItems: [] });
    const projectDirectory = join(directory, 'Projects', id);
    const backups = readdirSync(projectDirectory).filter((name) => name.includes('v1-backup'));
    expect(backups).toHaveLength(1);
    const backup = new Database(join(projectDirectory, backups[0]), { readonly: true });
    try {
      expect(backup.pragma('user_version', { simple: true })).toBe(1);
      expect(backup.pragma('quick_check', { simple: true })).toBe('ok');
      expect(JSON.parse((backup.prepare('SELECT document_json FROM chapter').get() as { document_json: string }).document_json)).toEqual(document);
      expect(backup.prepare('SELECT * FROM operation_log').all()).toHaveLength(1);
    } finally { backup.close(); }
    expect(source.pragma('user_version', { simple: true })).toBe(5);
    expect(source.prepare('SELECT COUNT(*) AS count FROM category').get()).toEqual({ count: 6 });
    expect(searchAssets(source, { text: '旧版', mode: 'all' })).toHaveLength(1);
    expect(readdirSync(projectDirectory).filter((name) => name.includes('v2-backup'))).toEqual([]);
    expect(source.prepare('SELECT * FROM operation_log').all()).toHaveLength(1);
    repository.close(); repository = new WorkRepository(directory);
    expect(readdirSync(projectDirectory).filter((name) => name.includes('v1-backup'))).toEqual(backups);
  });

  it('迁移事务失败保留旧库与备份，原正文版本不被部分改写', () => {
    source.exec('CREATE TABLE volume (id TEXT PRIMARY KEY)');
    expect(() => { repository = new WorkRepository(directory); }).toThrowError(expect.objectContaining({ code: 'MIGRATION_FAILED' }));
    expect(source.pragma('user_version', { simple: true })).toBe(1);
    expect(source.prepare('SELECT revision FROM work_meta').get()).toEqual({ revision: 7 });
    expect(JSON.parse((source.prepare('SELECT document_json FROM chapter').get() as { document_json: string }).document_json)).toEqual(document);
    expect((source.pragma('table_info(work_meta)') as { name: string }[]).some((row) => row.name === 'deleted_at')).toBe(false);
    expect(readdirSync(join(directory, 'Projects', id)).filter((name) => name.includes('v1-backup'))).toHaveLength(1);
  });

  it('未来版本拒绝启动且不改写数据库或制造错误降级备份', () => {
    source.pragma('user_version = 99');
    expect(() => new WorkRepository(directory)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
    expect(source.pragma('user_version', { simple: true })).toBe(99);
    expect(readdirSync(join(directory, 'Projects', id)).filter((name) => name.includes('backup'))).toEqual([]);
  });

  it('迁移提交前发现无效正文，schema 与版本一并回滚而不修饰坏稿', () => {
    source.prepare('UPDATE chapter SET document_json = ?').run('{"type":"doc","content":[]}');
    expect(() => { repository = new WorkRepository(directory); }).toThrowError(expect.objectContaining({ code: 'MIGRATION_FAILED' }));
    expect(source.pragma('user_version', { simple: true })).toBe(1);
    expect(source.prepare('SELECT document_json FROM chapter').get()).toEqual({ document_json: '{"type":"doc","content":[]}' });
    expect(source.prepare("SELECT name FROM sqlite_master WHERE name = 'chapter_v1' OR name = 'volume'").all()).toEqual([]);
    expect(source.prepare('SELECT * FROM operation_log').all()).toHaveLength(1);
  });

  it('备份创建失败不迁移原库，提示准确说明备份未成功而非宣称已保留', () => {
    const originalPrepare = source.prepare.bind(source);
    const prepare = vi.spyOn(source, 'prepare').mockImplementation((sql) => {
      if (sql === 'VACUUM INTO ?') throw Object.assign(new Error('磁盘权限不足'), { code: 'EACCES' });
      return originalPrepare(sql);
    });
    try {
      expect(() => migrateProjectV1(source)).toThrow('升级前备份未成功，原数据库未修改');
      expect(source.pragma('user_version', { simple: true })).toBe(1);
      expect(source.prepare('SELECT revision FROM work_meta').get()).toEqual({ revision: 7 });
      expect(readdirSync(join(directory, 'Projects', id)).filter((name) => name.includes('backup'))).toEqual([]);
    } finally { prepare.mockRestore(); }
  });

  it.each(['错误 ID', '缺失元数据', '重复元数据'])('迁移前拒绝%s，旧 schema 和正文不被修改', (caseName) => {
    if (caseName === '错误 ID') source.prepare('UPDATE work_meta SET id = ?').run(randomUUID());
    else if (caseName === '缺失元数据') source.prepare('DELETE FROM work_meta').run();
    else source.prepare('INSERT INTO work_meta VALUES (?, ?, 1, ?)').run(randomUUID(), '多余作品', new Date().toISOString());
    const originalMetadata = source.prepare('SELECT * FROM work_meta').all();
    expect(() => { repository = new WorkRepository(directory); }).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    expect(source.pragma('user_version', { simple: true })).toBe(1);
    expect(source.prepare('SELECT * FROM work_meta').all()).toEqual(originalMetadata);
    expect((source.pragma('table_info(work_meta)') as { name: string }[]).some((row) => row.name === 'deleted_at')).toBe(false);
    expect(JSON.parse((source.prepare('SELECT document_json FROM chapter').get() as { document_json: string }).document_json)).toEqual(document);
    expect(readdirSync(join(directory, 'Projects', id)).filter((name) => name.includes('backup'))).toEqual([]);
  });
});
