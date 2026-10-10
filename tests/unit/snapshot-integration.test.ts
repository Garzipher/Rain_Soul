import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSchema } from '../../src/workers/database/schema';
import { projectSchema } from '../../src/workers/database/project-schema';
import { initializeAssetsSchema } from '../../src/workers/database/assets-schema';
import { WorkRepository } from '../../src/workers/database/repository';
import { StoreService } from '../../src/main/store-service';

describe('快照正式迁移与仓储链路', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'rainsoul-snapshot-integration-')); });
  afterEach(() => { vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }); });
  function legacy() {
    const db = new Database(join(directory, 'legacy.sqlite')); db.exec(projectSchema); initializeAssetsSchema(db); db.pragma('user_version=3');
    db.prepare('INSERT INTO work_meta(id,title,revision,updated_at) VALUES(?,?,7,?)').run(randomUUID(), '旧作品', new Date().toISOString()); return db;
  }
  it('v3在备份后原子迁移v4，保留资产与作品版本；v4重启不再备份', () => {
    const db = legacy();
    try {
      initializeSchema(db, 'project'); expect(db.pragma('user_version', { simple: true })).toBe(6);
      expect(db.prepare('SELECT name FROM sqlite_master WHERE name=?').get('snapshot')).toBeDefined();
      expect(db.prepare('SELECT revision FROM work_meta').get()).toEqual({ revision: 7 });
      const backups = readdirSync(directory).filter(name => name.includes('v3-backup')); expect(backups).toHaveLength(1);
      const backup = new Database(join(directory, backups[0]), { readonly: true });
      try { expect(backup.pragma('user_version', { simple: true })).toBe(3); } finally { backup.close(); }
      initializeSchema(db, 'project'); expect(readdirSync(directory).filter(name => name.includes('v3-backup'))).toEqual(backups);
    } finally { db.close(); }
  });
  it('备份失败不建快照表且保持v3，迁移校验失败也整体回滚', () => {
    const db = legacy(); const prepare = db.prepare.bind(db);
    try {
      vi.spyOn(db, 'prepare').mockImplementation(sql => { if (sql === 'VACUUM INTO ?') throw new Error('磁盘已满'); return prepare(sql); });
      expect(() => initializeSchema(db, 'project')).toThrowError(expect.objectContaining({ code: 'MIGRATION_FAILED' }));
      expect(db.pragma('user_version', { simple: true })).toBe(3); expect(db.prepare('SELECT name FROM sqlite_master WHERE name=?').get('snapshot')).toBeUndefined();
      vi.restoreAllMocks(); const pragma = db.pragma.bind(db);
      vi.spyOn(db, 'pragma').mockImplementation((sql, options) => sql === 'foreign_key_check' ? [{ table: 'invalid' }] : pragma(sql, options));
      expect(() => initializeSchema(db, 'project')).toThrowError(expect.objectContaining({ code: 'MIGRATION_FAILED' }));
      expect(db.pragma('user_version', { simple: true })).toBe(3); expect(db.prepare('SELECT name FROM sqlite_master WHERE name=?').get('snapshot')).toBeUndefined();
    } finally { db.close(); }
  });
  it('创建与恢复使用CAS和操作回执，重放不重复且只增加一次版本', () => {
    const repository = new WorkRepository(directory);
    try {
      let work = repository.createWork('雨落之后'); const original = work.chapters[0];
      const create = { workId: work.id, expectedRevision: work.revision, operationId: randomUUID(), title: '初稿' };
      work = repository.createSnapshot(create); expect(work.revision).toBe(2);
      const snapshot = repository.listSnapshots(work.id)[0]; expect(snapshot.sourceRevision).toBe(1);
      expect(repository.createSnapshot(create).revision).toBe(2); expect(repository.listSnapshots(work.id)).toHaveLength(1);
      const document = structuredClone(original.document); document.content[0].content = [{ type: 'text', text: '当前珍贵稿' }];
      repository.saveChapter(work.id, original.id, '最新章', document, work.revision, randomUUID()); work = repository.openWork(work.id);
      const restore = { workId: work.id, expectedRevision: work.revision, operationId: randomUUID(), snapshotId: snapshot.id };
      work = repository.restoreSnapshot(restore); expect(work.revision).toBe(4); expect(work.chapters[0].document).toEqual(original.document);
      expect(repository.listSnapshots(work.id)).toHaveLength(3); expect(repository.restoreSnapshot(restore).revision).toBe(4);
      expect(repository.listSnapshots(work.id)).toHaveLength(3);
      const safety = repository.listSnapshots(work.id).find(item => item.title === '恢复前：初稿')!;
      expect(safety.sourceRevision).toBe(3);
      work = repository.restoreSnapshot({ ...restore, expectedRevision: work.revision, operationId: randomUUID(), snapshotId: safety.id });
      expect(work.chapters[0]).toMatchObject({ title: '最新章', document }); expect(work.revision).toBe(5);
      expect(repository.listSnapshots(work.id)).toHaveLength(5);
      expect(() => repository.createSnapshot({ ...create, operationId: randomUUID() })).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(() => repository.restoreSnapshot({ ...restore, snapshotId: safety.id })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    } finally { repository.close(); }
  });
  it('损坏快照恢复失败，正文/版本/操作日志/安全快照一起回滚', () => {
    const repository = new WorkRepository(directory);
    try {
      let work = repository.createWork('雨落之后'); work = repository.createSnapshot({ workId: work.id, expectedRevision: work.revision, operationId: randomUUID(), title: '原稿' });
      const snapshot = repository.listSnapshots(work.id)[0]; const db = new Database(join(directory, 'Projects', work.id, 'project.sqlite'));
      try { db.prepare('UPDATE snapshot SET payload_json=? WHERE id=?').run('{}', snapshot.id); } finally { db.close(); }
      const before = repository.openWork(work.id);
      expect(() => repository.restoreSnapshot({ workId: work.id, expectedRevision: work.revision, operationId: randomUUID(), snapshotId: snapshot.id })).toThrow(/校验/);
      expect(repository.openWork(work.id)).toEqual(before); expect(repository.listSnapshots(work.id)).toHaveLength(1);
    } finally { repository.close(); }
  });
  it('快照命令只允许当前作品，非法名称/额外字段不得进入Worker', async () => {
    const workId = randomUUID(); const calls: string[] = [];
    const store = new StoreService(async command => { calls.push(command); return command === 'openWork' ? { id: workId } : []; });
    await expect(store.execute('listSnapshots', { workId })).rejects.toThrow('当前作品'); await store.execute('openWork', { id: workId });
    await expect(store.execute('listSnapshots', { workId })).resolves.toEqual([]);
    const request = { workId, expectedRevision: 1, operationId: randomUUID(), title: '初稿' };
    await expect(store.execute('createSnapshot', { ...request, title: ' ' })).rejects.toThrow();
    await expect(store.execute('createSnapshot', { ...request, sql: 'unsafe' })).rejects.toThrow();
    await expect(store.execute('createSnapshot', request)).resolves.toEqual([]);
    await expect(store.execute('restoreSnapshot', { workId: randomUUID(), expectedRevision: 1, operationId: randomUUID(), snapshotId: randomUUID() })).rejects.toThrow('当前作品');
    expect(calls).toEqual(['openWork', 'listSnapshots', 'createSnapshot']);
  });
});
