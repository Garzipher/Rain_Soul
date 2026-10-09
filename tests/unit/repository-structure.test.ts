import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StructureAction, WorkDetail } from '../../src/shared/contracts';
import { WorkRepository } from '../../src/workers/database/repository';

describe('卷章结构与可恢复删除', () => {
  let directory: string;
  let repository: WorkRepository;
  let work: WorkDetail;
  const change = (action: StructureAction, operationId = randomUUID(), revision = work.revision) => {
    const result = repository.manageStructure({ workId: work.id, expectedRevision: revision, operationId, action });
    if (result) work = result;
    return result;
  };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-structure-'));
    repository = new WorkRepository(directory);
    work = repository.createWork('雨魂');
  });
  afterEach(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });

  it('作品默认无卷，创建卷与改名保存后重启仍可恢复', () => {
    expect(work.volumes).toEqual([]);
    expect(work.chapters[0].volumeId).toBeNull();
    change({ type: 'createVolume', title: ' 上卷 ' });
    change({ type: 'renameWork', title: ' 新作品 ' });
    change({ type: 'renameVolume', volumeId: work.volumes[0].id, title: ' 第一卷 ' });
    repository.close(); repository = new WorkRepository(directory);
    expect(repository.openWork(work.id)).toEqual(work);
    expect(repository.listWorks()[0].title).toBe('新作品');
  });

  it('章节移入卷、同级上下移动、移出卷均不改变正文和稳定 ID', () => {
    const first = work.chapters[0];
    change({ type: 'createVolume', title: '第一卷' });
    const volumeId = work.volumes[0].id;
    change({ type: 'setChapterVolume', chapterId: first.id, volumeId });
    work = repository.addChapter(work.id, '第二章', work.revision, randomUUID(), volumeId);
    const second = work.chapters[1];
    change({ type: 'moveChapter', chapterId: second.id, direction: 'up' });
    expect(work.chapters.map((chapter) => chapter.id)).toEqual([second.id, first.id]);
    change({ type: 'moveChapter', chapterId: second.id, direction: 'down' });
    expect(work.chapters.map((chapter) => chapter.id)).toEqual([first.id, second.id]);
    change({ type: 'setChapterVolume', chapterId: first.id, volumeId: null });
    expect(work.chapters[0]).toEqual(first);
  });

  it('卷排序只有同级邻居，移动边界仍保持稳定顺序', () => {
    change({ type: 'createVolume', title: '卷一' });
    change({ type: 'createVolume', title: '卷二' });
    const [first, second] = work.volumes;
    change({ type: 'moveVolume', volumeId: second.id, direction: 'up' });
    expect(work.volumes).toEqual([second, first]);
    change({ type: 'moveVolume', volumeId: second.id, direction: 'up' });
    expect(work.volumes).toEqual([second, first]);
    change({ type: 'moveVolume', volumeId: second.id, direction: 'down' });
    expect(work.volumes).toEqual([first, second]);
  });

  it('跨卷移动追加在目标卷末尾，同级上下移动不会越过其他卷或无卷章节', () => {
    const ungroupedId = work.chapters[0].id;
    change({ type: 'createVolume', title: '一卷' });
    change({ type: 'createVolume', title: '二卷' });
    const [first, second] = work.volumes;
    work = repository.addChapter(work.id, '一卷章一', work.revision, randomUUID(), first.id);
    const movingId = work.chapters[1].id;
    work = repository.addChapter(work.id, '二卷章一', work.revision, randomUUID(), second.id);
    const destinationId = work.chapters[2].id;
    change({ type: 'setChapterVolume', chapterId: movingId, volumeId: second.id });
    expect(work.chapters.map((chapter) => chapter.id)).toEqual([ungroupedId, destinationId, movingId]);
    change({ type: 'moveChapter', chapterId: destinationId, direction: 'up' });
    expect(work.chapters.map((chapter) => chapter.id)).toEqual([ungroupedId, destinationId, movingId]);
    change({ type: 'moveChapter', chapterId: movingId, direction: 'up' });
    expect(work.chapters.map((chapter) => chapter.id)).toEqual([ungroupedId, movingId, destinationId]);
    change({ type: 'setChapterVolume', chapterId: movingId, volumeId: second.id });
    expect(work.chapters.map((chapter) => chapter.id)).toEqual([ungroupedId, movingId, destinationId]);
  });

  it('删卷后的新卷和恢复卷不会碰撞排序，卷内新章与恢复章各有稳定位置', () => {
    change({ type: 'createVolume', title: '旧卷' });
    const oldVolumeId = work.volumes[0].id;
    change({ type: 'setChapterVolume', chapterId: work.chapters[0].id, volumeId: oldVolumeId });
    change({ type: 'deleteVolume', volumeId: oldVolumeId });
    change({ type: 'createVolume', title: '新卷' });
    const newVolume = work.volumes[0];
    change({ type: 'restoreVolume', volumeId: oldVolumeId });
    expect(work.volumes.map((volume) => volume.id)).toEqual([newVolume.id, oldVolumeId]);
    const oldChapterId = work.chapters[0].id;
    change({ type: 'deleteChapter', chapterId: oldChapterId });
    work = repository.addChapter(work.id, '新章', work.revision, randomUUID(), oldVolumeId);
    const newChapterId = work.chapters[0].id;
    change({ type: 'restoreChapter', chapterId: oldChapterId });
    expect(work.chapters.map((chapter) => chapter.id)).toEqual([newChapterId, oldChapterId]);
  });

  it('删除章节从书架统计排除，恢复保留全文、段落 ID 并追加至同级末尾', () => {
    const original = work.chapters[0];
    const document = { ...original.document, content: [{ ...original.document.content[0], content: [{ type: 'text' as const, text: '珍贵正文' }] }] };
    repository.saveChapter(work.id, original.id, original.title, document, work.revision, randomUUID());
    work = repository.openWork(work.id);
    change({ type: 'deleteChapter', chapterId: original.id });
    expect(work.chapters).toEqual([]);
    expect(work.deletedItems).toEqual([{ kind: 'chapter', id: original.id, title: original.title, deletedAt: expect.any(String) }]);
    expect(repository.listWorks()[0]).toMatchObject({ chapterCount: 0, wordCount: 0 });
    expect(() => repository.saveChapter(work.id, original.id, '改名', document, work.revision, randomUUID())).toThrow();
    work = repository.addChapter(work.id, '新章', work.revision, randomUUID());
    change({ type: 'restoreChapter', chapterId: original.id });
    expect(work.chapters[1]).toMatchObject({ id: original.id, document, wordCount: 4 });
    expect(work.deletedItems).toEqual([]);
    expect(repository.listWorks()[0]).toMatchObject({ chapterCount: 2, wordCount: 4 });
  });

  it('删除卷只级联活动章节，恢复只恢复同一删除批次的章节', () => {
    change({ type: 'createVolume', title: '第一卷' });
    const volumeId = work.volumes[0].id;
    change({ type: 'setChapterVolume', chapterId: work.chapters[0].id, volumeId });
    work = repository.addChapter(work.id, '同批第二章', work.revision, randomUUID(), volumeId);
    const activeIds = work.chapters.map((chapter) => chapter.id);
    work = repository.addChapter(work.id, '独立删除章', work.revision, randomUUID(), volumeId);
    const independentId = work.chapters[2].id;
    change({ type: 'deleteChapter', chapterId: independentId });
    change({ type: 'deleteVolume', volumeId });
    expect(work.volumes).toEqual([]);
    expect(work.chapters).toEqual([]);
    change({ type: 'restoreVolume', volumeId });
    expect(work.volumes).toHaveLength(1);
    expect(work.chapters.map((chapter) => chapter.id)).toEqual(activeIds);
    expect(work.deletedItems.map((item) => item.id)).toEqual([independentId]);
  });

  it('原卷仍被删除时单独恢复章节至无卷区，不复活原卷', () => {
    change({ type: 'createVolume', title: '第一卷' });
    const volumeId = work.volumes[0].id;
    const chapterId = work.chapters[0].id;
    change({ type: 'setChapterVolume', chapterId, volumeId });
    change({ type: 'deleteVolume', volumeId });
    change({ type: 'restoreChapter', chapterId });
    expect(work.volumes).toEqual([]);
    expect(work.chapters[0]).toMatchObject({ id: chapterId, volumeId: null });
    change({ type: 'restoreVolume', volumeId });
    expect(work.chapters[0].volumeId).toBeNull();
  });

  it('删除作品保留目录正文，重启后可列出并恢复且不重复创建', () => {
    const initial = work;
    expect(change({ type: 'deleteWork' })).toBeNull();
    expect(repository.listWorks()).toEqual([]);
    expect(existsSync(join(directory, 'Projects', work.id, 'project.sqlite'))).toBe(true);
    expect(() => repository.openWork(work.id)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => repository.addChapter(work.id, '错误', 2, randomUUID())).toThrow();
    repository.close(); repository = new WorkRepository(directory);
    expect(repository.listWorks()).toEqual([]);
    expect(repository.listDeletedWorks()).toEqual([{ id: work.id, title: '雨魂', revision: 2, chapterCount: 1, wordCount: 0, updatedAt: expect.any(String) }]);
    change({ type: 'restoreWork' }, randomUUID(), 2);
    expect(work).toMatchObject({ ...initial, revision: 3 });
    expect(repository.listDeletedWorks()).toEqual([]);
    expect(repository.listWorks()).toHaveLength(1);
  });

  it('结构操作 CAS 与幂等保护，旧回执重放读取最新正文且日志紧凑', () => {
    const operationId = randomUUID();
    change({ type: 'createVolume', title: '一卷' }, operationId, 1);
    expect(() => change({ type: 'renameWork', title: '旧改名' }, randomUUID(), 1)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    repository.saveChapter(work.id, work.chapters[0].id, '最新章', work.chapters[0].document, work.revision, randomUUID());
    change({ type: 'createVolume', title: '一卷' }, operationId, 1);
    expect(work.volumes).toHaveLength(1);
    expect(work.chapters[0].title).toBe('最新章');
    expect(work.revision).toBe(3);
    const db = new Database(join(directory, 'Projects', work.id, 'project.sqlite'));
    try {
      const row = db.prepare('SELECT result_json FROM operation_log WHERE operation_id = ?').get(operationId) as { result_json: string };
      expect(row.result_json.length).toBeLessThan(200);
    } finally { db.close(); }
    expect(() => change({ type: 'createVolume', title: '二卷' }, operationId, 1)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it('删除旧操作重放不能再次删除已恢复的作品', () => {
    const operationId = randomUUID();
    change({ type: 'deleteWork' }, operationId, 1);
    change({ type: 'restoreWork' }, randomUUID(), 2);
    expect(change({ type: 'deleteWork' }, operationId, 1)).toMatchObject({ id: work.id, revision: 3 });
    expect(repository.listWorks()).toHaveLength(1);
  });

  it('回收站作品恢复仍要求最新版本且重放不会复活后来重新删除的作品', () => {
    change({ type: 'deleteWork' });
    expect(() => change({ type: 'restoreWork' }, randomUUID(), 1)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    const restoreId = randomUUID();
    change({ type: 'restoreWork' }, restoreId, 2);
    change({ type: 'deleteWork' });
    expect(change({ type: 'restoreWork' }, restoreId, 2)).toBeNull();
    expect(repository.listWorks()).toEqual([]);
    expect(repository.listDeletedWorks()[0].revision).toBe(4);
  });

  it('新增章节不能放入其他作品卷或已删卷，非法结构输入不会部分提交', () => {
    change({ type: 'createVolume', title: '旧卷' });
    const volumeId = work.volumes[0].id;
    change({ type: 'deleteVolume', volumeId });
    expect(() => repository.addChapter(work.id, '误放章', work.revision, randomUUID(), volumeId)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => repository.addChapter(work.id, '误放章', work.revision, randomUUID(), '../卷')).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    const other = repository.createWork('其他作品');
    const otherWithVolume = repository.manageStructure({ workId: other.id, expectedRevision: 1, operationId: randomUUID(), action: { type: 'createVolume', title: '他作卷' } })!;
    expect(() => repository.addChapter(work.id, '误放章', work.revision, randomUUID(), otherWithVolume.volumes[0].id)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    for (const action of [{ type: 'moveVolume', volumeId, direction: 'sideways' }, { type: 'unknown' }, { type: 'renameWork', title: '名称', extra: true }]) {
      expect(() => repository.manageStructure({ workId: work.id, expectedRevision: work.revision, operationId: randomUUID(), action } as unknown as Parameters<WorkRepository['manageStructure']>[0]))
        .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    }
    expect(repository.openWork(work.id)).toEqual(work);
  });

  it('拒绝跨作品卷章、无效标识、空名称和已删除目标，且事务不改版本', () => {
    const other = repository.createWork('他作');
    const actions: StructureAction[] = [
      { type: 'deleteChapter', chapterId: other.chapters[0].id },
      { type: 'renameVolume', volumeId: randomUUID(), title: '无卷' },
      { type: 'createVolume', title: ' ' },
      { type: 'setChapterVolume', chapterId: work.chapters[0].id, volumeId: other.id },
      { type: 'moveChapter', chapterId: '../bad', direction: 'up' },
      { type: 'restoreChapter', chapterId: work.chapters[0].id },
    ];
    for (const action of actions) expect(() => change(action)).toThrow();
    expect(repository.openWork(work.id)).toEqual(work);
    change({ type: 'deleteChapter', chapterId: work.chapters[0].id });
    const deleted = work.deletedItems[0].id;
    expect(() => change({ type: 'moveChapter', chapterId: deleted, direction: 'down' })).toThrow();
    expect(repository.openWork(work.id)).toEqual(work);
  });
});
