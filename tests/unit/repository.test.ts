import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';

const documentWith = (text = '') => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph' as const, attrs: { id: randomUUID() },
    content: text ? [{ type: 'text' as const, text }] : [] }],
});

describe('真实 SQLite 作品存储', () => {
  let directory: string;
  let repository: WorkRepository;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-db-'));
    repository = new WorkRepository(directory);
  });
  afterEach(() => {
    repository?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('新作品以稳定 ID 创建第一章，空正文不计字数', () => {
    const work = repository.createWork('  雨魂  ');
    expect(work).toMatchObject({ title: '雨魂', revision: 1 });
    expect(work.chapters).toHaveLength(1);
    expect(work.chapters[0]).toMatchObject({ title: '第一章', wordCount: 0 });
    expect(repository.openWork(work.id)).toEqual(work);
    expect(repository.listWorks()).toEqual([{ id: work.id, title: '雨魂', wordCount: 0,
      chapterCount: 1, updatedAt: expect.any(String) }]);
  });

  it('保存落盘后重开仍恢复正文、稳定段落 ID 和版本', () => {
    const work = repository.createWork('雨魂');
    const document = documentWith('你好，Rain 2026！\n');
    expect(repository.saveChapter(work.id, work.chapters[0].id, '开始', document,
      work.revision, randomUUID())).toEqual({ revision: 2, wordCount: 10 });
    repository.close();
    repository = new WorkRepository(directory);
    expect(repository.openWork(work.id)).toMatchObject({ revision: 2,
      chapters: [{ title: '开始', document, wordCount: 10 }] });
    expect(repository.listWorks()[0].wordCount).toBe(10);
  });

  it('允许同名作品且章节和字数完全隔离', () => {
    const first = repository.createWork('同名');
    const second = repository.createWork('同名');
    repository.saveChapter(first.id, first.chapters[0].id, '第一章', documentWith('雨魂'),
      first.revision, randomUUID());
    const updated = repository.addChapter(first.id, '第二章', 2, randomUUID());
    expect(updated.chapters).toHaveLength(2);
    expect(updated.revision).toBe(3);
    expect(repository.openWork(second.id)).toEqual(second);
    expect(repository.listWorks().find((work) => work.id === second.id)?.wordCount).toBe(0);
  });

  it('旧版本保存被拒绝，当前正文和版本不发生变化', () => {
    const work = repository.createWork('版本');
    repository.saveChapter(work.id, work.chapters[0].id, '已保存', documentWith('甲'), 1, randomUUID());
    expect(() => repository.saveChapter(work.id, work.chapters[0].id, '旧稿', documentWith('乙'),
      1, randomUUID())).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(repository.openWork(work.id)).toMatchObject({ revision: 2,
      chapters: [{ title: '已保存', wordCount: 1 }] });
  });

  it('相同操作重复交付只提交一次，并在重启后返回原回执', () => {
    const work = repository.createWork('去重');
    const operation = randomUUID();
    const document = documentWith('第一次');
    const result = repository.saveChapter(work.id, work.chapters[0].id, '第一章', document, 1, operation);
    repository.close();
    repository = new WorkRepository(directory);
    expect(repository.saveChapter(work.id, work.chapters[0].id, '第一章', document, 1, operation)).toEqual(result);
    expect(repository.openWork(work.id).revision).toBe(2);
  });

  it('已提交操作迟到重放不会覆盖之后保存的正文', () => {
    const work = repository.createWork('迟到回执');
    const operation = randomUUID();
    const earlier = documentWith('旧稿');
    repository.saveChapter(work.id, work.chapters[0].id, '第一章', earlier, 1, operation);
    const latest = documentWith('新的正文');
    repository.saveChapter(work.id, work.chapters[0].id, '第一章', latest, 2, randomUUID());
    expect(repository.saveChapter(work.id, work.chapters[0].id, '第一章', earlier, 1, operation))
      .toEqual({ revision: 2, wordCount: 2 });
    expect(repository.openWork(work.id)).toMatchObject({ revision: 3,
      chapters: [{ document: latest, wordCount: 4 }] });
  });

  it('保存空正文能清空字数，不保留旧统计', () => {
    const work = repository.createWork('清空');
    repository.saveChapter(work.id, work.chapters[0].id, '第一章', documentWith('甲乙'), 1, randomUUID());
    expect(repository.saveChapter(work.id, work.chapters[0].id, '第一章', documentWith(), 2, randomUUID()))
      .toEqual({ revision: 3, wordCount: 0 });
    expect(repository.listWorks()[0].wordCount).toBe(0);
  });

  it('新增章节的重复操作不会插入第二份章节', () => {
    const work = repository.createWork('章节');
    const operation = randomUUID();
    const result = repository.addChapter(work.id, '第二章', 1, operation);
    expect(repository.addChapter(work.id, '第二章', 1, operation)).toEqual(result);
    expect(repository.openWork(work.id).chapters).toHaveLength(2);
  });

  it('新增章节日志只保存紧凑回执，不复制整部作品正文', () => {
    const work = repository.createWork('长篇');
    repository.saveChapter(work.id, work.chapters[0].id, '第一章', documentWith('珍贵的长篇正文'.repeat(1000)),
      1, randomUUID());
    const operation = randomUUID();
    const updated = repository.addChapter(work.id, '第二章', 2, operation);
    const db = new Database(join(directory, 'Projects', work.id, 'project.sqlite'));
    try {
      const log = db.prepare('SELECT result_json FROM operation_log WHERE operation_id = ?').get(operation) as { result_json: string };
      expect(JSON.parse(log.result_json)).toEqual({ chapterId: updated.chapters[1].id, revision: 3 });
      expect(log.result_json.length).toBeLessThan(200);
    } finally { db.close(); }
  });

  it('新增章节旧操作重放返回当前作品，不让旧回执覆盖后续正文', () => {
    const work = repository.createWork('新增重放');
    const operation = randomUUID();
    const added = repository.addChapter(work.id, '第二章', 1, operation);
    const document = documentWith('最新正文');
    repository.saveChapter(work.id, added.chapters[1].id, '第二章', document, 2, randomUUID());
    expect(repository.addChapter(work.id, '第二章', 1, operation)).toMatchObject({ revision: 3,
      chapters: [expect.anything(), { id: added.chapters[1].id, document, wordCount: 4 }] });
    expect(repository.openWork(work.id).chapters).toHaveLength(2);
  });

  it('操作 ID 不能被重用于不同正文', () => {
    const work = repository.createWork('去重冲突');
    const operation = randomUUID();
    repository.saveChapter(work.id, work.chapters[0].id, '第一章', documentWith('甲'), 1, operation);
    expect(() => repository.saveChapter(work.id, work.chapters[0].id, '第一章', documentWith('乙'),
      1, operation)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(repository.openWork(work.id).revision).toBe(2);
  });

  it.each(['', '  ', '\n\t'])('拒绝空白作品名 %j，且不留下新作品', (title) => {
    expect(() => repository.createWork(title)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(repository.listWorks()).toEqual([]);
    expect(readdirSync(join(directory, 'Projects'))).toEqual([]);
  });

  it('无效正文和空白章节名均不改变当前版本', () => {
    const work = repository.createWork('校验');
    expect(() => repository.saveChapter(work.id, work.chapters[0].id, '第一章',
      { type: 'doc', content: [] }, 1, randomUUID())).toThrow();
    expect(() => repository.addChapter(work.id, '  ', 1, randomUUID())).toThrow();
    expect(repository.openWork(work.id)).toEqual(work);
  });

  it('拒绝跨作品章节写入和目录路径作为作品 ID', () => {
    const work = repository.createWork('作用域');
    const other = repository.createWork('别作');
    expect(() => repository.saveChapter(work.id, other.chapters[0].id, '第一章', documentWith('错误'),
      1, randomUUID())).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => repository.openWork('../catalog.sqlite')).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(repository.openWork(work.id)).toEqual(work);
  });

  it('SQLite 写锁失败时保留原正文和版本，解锁后可保存', () => {
    const work = repository.createWork('锁冲突');
    const db = new Database(join(directory, 'Projects', work.id, 'project.sqlite'));
    db.exec('BEGIN IMMEDIATE');
    try {
      expect(() => repository.saveChapter(work.id, work.chapters[0].id, '第一章', documentWith('未落盘'),
        1, randomUUID())).toThrow();
      expect(repository.openWork(work.id)).toEqual(work);
    } finally {
      db.exec('ROLLBACK');
      db.close();
    }
    expect(repository.saveChapter(work.id, work.chapters[0].id, '第一章', documentWith('已落盘'),
      1, randomUUID())).toEqual({ revision: 2, wordCount: 3 });
  });

  it('启动扫描可恢复已发布但尚未登记目录库的作品', () => {
    const work = repository.createWork('中断恢复');
    repository.close();
    const catalog = new Database(join(directory, 'catalog.sqlite'));
    catalog.prepare('DELETE FROM work_catalog WHERE work_id = ?').run(work.id);
    catalog.close();
    repository = new WorkRepository(directory);
    expect(repository.listWorks()).toHaveLength(1);
    expect(repository.openWork(work.id)).toEqual(work);
  });

  it('启动校准过期目录缓存，以作品库的已提交字数为准', () => {
    const work = repository.createWork('缓存');
    repository.saveChapter(work.id, work.chapters[0].id, '第一章', documentWith('天地玄黄'), 1, randomUUID());
    repository.close();
    const catalog = new Database(join(directory, 'catalog.sqlite'));
    catalog.prepare('UPDATE work_catalog SET word_count = 999 WHERE work_id = ?').run(work.id);
    catalog.close();
    repository = new WorkRepository(directory);
    expect(repository.listWorks()[0].wordCount).toBe(4);
  });

  it('目录缓存写入失败不回滚已提交正文，解锁后恢复作品集字数', () => {
    const work = repository.createWork('缓存失败');
    const catalog = new Database(join(directory, 'catalog.sqlite'));
    catalog.exec('BEGIN IMMEDIATE');
    try {
      expect(repository.saveChapter(work.id, work.chapters[0].id, '第一章', documentWith('已落盘'),
        1, randomUUID())).toEqual({ revision: 2, wordCount: 3 });
      expect(repository.openWork(work.id)).toMatchObject({ revision: 2, chapters: [{ wordCount: 3 }] });
    } finally { catalog.exec('ROLLBACK'); catalog.close(); }
    expect(repository.listWorks()[0].wordCount).toBe(3);
  });

  it('不支持未来作品 schema，拒绝启动且原数据库版本不被改写', () => {
    const work = repository.createWork('未来版本');
    repository.close();
    const file = join(directory, 'Projects', work.id, 'project.sqlite');
    const db = new Database(file);
    db.pragma('user_version = 99');
    db.close();
    expect(() => new WorkRepository(directory)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
    const unchanged = new Database(file);
    expect(unchanged.pragma('user_version', { simple: true })).toBe(99);
    unchanged.close();
  });

  it('未来目录库 schema 拒绝启动且不能被默认初始化覆盖', () => {
    repository.close();
    const file = join(directory, 'catalog.sqlite');
    const db = new Database(file);
    db.pragma('user_version = 99');
    db.close();
    expect(() => new WorkRepository(directory)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
    const unchanged = new Database(file);
    expect(unchanged.pragma('user_version', { simple: true })).toBe(99);
    unchanged.close();
  });
});
