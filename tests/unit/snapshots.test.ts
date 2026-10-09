import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';
import { createSnapshot, initializeSnapshots, listSnapshots, restoreSnapshot, previewSnapshot } from '../../src/workers/database/snapshots';

describe('整部作品快照与无损恢复', () => {
  let fixture: ReturnType<typeof assetFixture>;
  beforeEach(() => { fixture = assetFixture(); initializeSnapshots(fixture.db); });
  afterEach(() => fixture.db.close());
  it('只读预览校验摘要与格式并显示原稿规模，不能创建新历史或变更当前稿', () => {
    fixture.change({ type: 'createKnowledge', body: '雨落下来', source: '出处', categoryId: fixture.state().categories[0].id, tagIds: [] });
    fixture.change({ type: 'createForeshadow', name: '雨夜旧钟' });
    const snapshot = createSnapshot(fixture.db, '预览原稿');
    fixture.db.prepare('UPDATE chapter SET title=?').run('当前章名');
    const preview = previewSnapshot(fixture.db, snapshot.id);
    expect(preview).toMatchObject({ summary: snapshot, title: '测试作品', chapterCount: 1, volumeCount: 0, knowledgeCount: 1, foreshadowCount: 1 });
    expect(preview.chapters).toEqual([{ id: fixture.chapterId, title: '同名章节', wordCount: 8 }]);
    expect(listSnapshots(fixture.db)).toHaveLength(1);
    expect(fixture.db.prepare('SELECT title FROM chapter').get()).toEqual({ title: '当前章名' });
    fixture.db.prepare('UPDATE snapshot SET schema_version=99 WHERE id=?').run(snapshot.id);
    expect(() => previewSnapshot(fixture.db, snapshot.id)).toThrow(/版本/);
  });
  it('手动快照保存正文、稳定段落、知识与伏笔，恢复前后均生成历史版本', () => {
    const assets = fixture.change({ type: 'createKnowledge', body: '旧描写', source: '来源', categoryId: fixture.state().categories[0].id, tagIds: [] });
    const entry = assets.knowledge[0];
    fixture.change({ type: 'createForeshadow', name: '旧约定' });
    const old = createSnapshot(fixture.db, '第一稿', 'manual');
    fixture.change({ type: 'updateKnowledge', id: entry.id, body: '新描写', source: entry.source, categoryId: entry.categoryId, tagIds: entry.tagIds });
    fixture.db.prepare('UPDATE chapter SET title=?').run('新章名');
    const before = fixture.state();
    const currentRevision = (fixture.db.prepare('SELECT revision FROM work_meta').get() as { revision: number }).revision;
    const result = restoreSnapshot(fixture.db, old.id, currentRevision);
    expect(fixture.state().knowledge[0].body).toBe('旧描写');
    expect(fixture.state().foreshadows[0].name).toBe('旧约定');
    expect(JSON.parse((fixture.db.prepare('SELECT document_json FROM chapter').get() as { document_json: string }).document_json)).toEqual(fixture.document);
    expect(listSnapshots(fixture.db)).toHaveLength(3);
    expect(result.restored.sourceSnapshotId).toBe(old.id);
    restoreSnapshot(fixture.db, result.safety.id, (fixture.db.prepare('SELECT revision FROM work_meta').get() as { revision: number }).revision);
    expect(fixture.state()).toEqual(before);
    expect((fixture.db.prepare('SELECT title FROM chapter').get() as { title: string }).title).toBe('新章名');
    expect(listSnapshots(fixture.db)).toHaveLength(5);
  });
  it('快照不包含操作回执、搜索索引、快照自身或作者凭据，恢复不降低作品版本', () => {
    fixture.db.prepare('INSERT INTO operation_log VALUES (?,?,?)').run('操作', 'hash', '{}');
    const snapshot = createSnapshot(fixture.db, '存档', 'manual');
    const row = fixture.db.prepare('SELECT payload_json FROM snapshot WHERE id=?').get(snapshot.id) as { payload_json: string };
    expect(row.payload_json).not.toMatch(/operation_log|search_document|search_fts|avatar|apiKey/);
    fixture.db.prepare('UPDATE work_meta SET revision=50').run();
    restoreSnapshot(fixture.db, snapshot.id, 50);
    expect((fixture.db.prepare('SELECT revision FROM work_meta').get() as { revision: number }).revision).toBe(51);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM operation_log').get()).toEqual({ count: 1 });
  });
  it('损坏、异作和缺失快照不改正文，错误恢复不得留下安全快照', () => {
    const snapshot = createSnapshot(fixture.db, '旧稿', 'manual');
    fixture.db.prepare('UPDATE snapshot SET payload_json=? WHERE id=?').run('{}', snapshot.id);
    expect(() => restoreSnapshot(fixture.db, snapshot.id, 1)).toThrow(/校验/);
    expect(() => restoreSnapshot(fixture.db, crypto.randomUUID(), 1)).toThrow(/不存在/);
    expect(listSnapshots(fixture.db)).toHaveLength(1);
    expect(fixture.state().knowledge).toEqual([]);
    expect(() => createSnapshot(fixture.db, ' ', 'manual')).toThrow();
    expect(() => createSnapshot(fixture.db, 'x'.repeat(201), 'manual')).toThrow();
  });
  it('恢复事务在插入失败时回滚正文、安全快照和索引', () => {
    const snapshot = createSnapshot(fixture.db, '原稿', 'manual');
    fixture.db.prepare('UPDATE chapter SET title=?').run('当前稿');
    fixture.db.exec("CREATE TRIGGER reject_restore BEFORE INSERT ON chapter BEGIN SELECT RAISE(ABORT,'模拟磁盘失败'); END;");
    expect(() => restoreSnapshot(fixture.db, snapshot.id, 1)).toThrow(/模拟磁盘失败/);
    expect((fixture.db.prepare('SELECT title FROM chapter').get() as { title: string }).title).toBe('当前稿');
    expect(listSnapshots(fixture.db)).toHaveLength(1);
    expect(fixture.db.pragma('foreign_key_check')).toEqual([]);
  });
  it('恢复章节删除与跨卷状态，同时保留课程跟踪关系和重建全文检索', () => {
    fixture.db.exec('CREATE TABLE learning_seed(key TEXT PRIMARY KEY,chapter_id TEXT REFERENCES chapter(id));');
    fixture.db.prepare('INSERT INTO learning_seed VALUES (?,?)').run('稳定课程章', fixture.chapterId);
    fixture.change({ type: 'createForeshadow', name: '约定' });
    const snapshot = createSnapshot(fixture.db, '完整关系', 'manual');
    fixture.db.prepare('UPDATE chapter SET deleted_at=?').run('2026-10-09');
    restoreSnapshot(fixture.db, snapshot.id, 2);
    expect(fixture.db.prepare('SELECT * FROM learning_seed').all()).toEqual([{ key: '稳定课程章', chapter_id: fixture.chapterId }]);
    expect(fixture.db.prepare('SELECT title FROM search_document WHERE chapter_id=?').all(fixture.chapterId)).toHaveLength(1);
    expect(fixture.db.pragma('foreign_key_check')).toEqual([]);
  });
  it('拒绝异作快照、无效版本，摘要校验损坏时不新增历史', () => {
    const snapshot = createSnapshot(fixture.db, '原稿', 'manual');
    fixture.db.prepare('UPDATE work_meta SET id=?').run(crypto.randomUUID());
    expect(() => restoreSnapshot(fixture.db, snapshot.id, 1)).toThrow(/作品/);
    expect(() => restoreSnapshot(fixture.db, snapshot.id, NaN)).toThrow(/版本/);
    expect(listSnapshots(fixture.db)).toHaveLength(1);
  });
});
