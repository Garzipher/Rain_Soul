import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';
import type { AssetAction } from '../../src/shared/assets';
import type { StructureAction, WorkDetail } from '../../src/shared/contracts';

describe('资产仓储接线与正文索引', () => {
  let directory: string; let repository: WorkRepository; let work: WorkDetail;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-asset-repository-'));
    repository = new WorkRepository(directory); work = repository.createWork('雨落之后');
  });
  afterEach(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
  const assets = (action: AssetAction, operationId = randomUUID(), expectedRevision = work.revision) => {
    work = repository.manageAssets({ workId: work.id, expectedRevision, operationId, action }); return work;
  };
  const structure = (action: StructureAction) => {
    const result = repository.manageStructure({ workId: work.id, expectedRevision: work.revision, operationId: randomUUID(), action });
    if (result) work = result; return result;
  };
  const search = (text: string) => repository.searchWork(work.id, { text, mode: 'all' });
  function write(chapterId: string, text: string) {
    const chapter = work.chapters.find(item => item.id === chapterId)!;
    const document = structuredClone(chapter.document);
    document.content[0].content = [{ type: 'text', text }];
    repository.saveChapter(work.id, chapter.id, chapter.title, document, work.revision, randomUUID());
    work = repository.openWork(work.id);
  }
  it('资产与正文共用CAS和幂等回执，重启保留最新资产且冲突不会产生半提交', () => {
    const action: AssetAction = { type: 'createForeshadow', name: '旧钟' }; const operationId = randomUUID();
    assets(action, operationId, 1); const id = work.assets!.foreshadows[0].id;
    expect(() => assets({ type: 'createTag', name: '雨' }, randomUUID(), 1)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(work.assets!.tags).toEqual([]); write(work.chapters[0].id, '钟声响起');
    assets(action, operationId, 1);
    expect(work.revision).toBe(3); expect(work.assets!.foreshadows.map(item => item.id)).toEqual([id]);
    expect(() => assets({ type: 'createForeshadow', name: '另一钟' }, operationId, 1)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    repository.close(); repository = new WorkRepository(directory); work = repository.openWork(work.id);
    expect(work.assets!.foreshadows[0].name).toBe('旧钟'); expect(search('钟声')).toHaveLength(1);
  });
  it('保存刷新搜索、删章删除结果、恢复后仍保留原段落定位', () => {
    const chapter = work.chapters[0]; write(chapter.id, '灯塔旁');
    expect(search('灯塔旁')[0]).toMatchObject({ chapterId: chapter.id, paragraphId: chapter.document.content[0].attrs.id });
    write(chapter.id, '海岸'); expect(search('灯塔旁')).toEqual([]); expect(search('海岸')).toHaveLength(1);
    structure({ type: 'deleteChapter', chapterId: chapter.id }); expect(search('海岸')).toEqual([]);
    structure({ type: 'restoreChapter', chapterId: chapter.id }); expect(search('海岸')[0].paragraphId).toBe(chapter.document.content[0].attrs.id);
  });
  it('删除作品立即拒绝全文搜索，恢复后才允许读取正文', () => {
    write(work.chapters[0].id, '私有原稿'); structure({ type: 'deleteWork' });
    expect(() => search('私有原稿')).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    const deleted = repository.listDeletedWorks()[0];
    repository.manageStructure({ workId: work.id, expectedRevision: deleted.revision, operationId: randomUUID(), action: { type: 'restoreWork' } });
    expect(search('私有原稿')).toHaveLength(1);
  });
  it('改名与排序不重建正文索引，卷删除及恢复只刷新该卷章节', () => {
    const standalone = work.chapters[0]; write(standalone.id, '卷外文字');
    structure({ type: 'createVolume', title: '海岸卷' }); const volumeId = work.volumes[0].id;
    work = repository.addChapter(work.id, '卷内章节', work.revision, randomUUID(), volumeId);
    const child = work.chapters.find(item => item.volumeId === volumeId)!; write(child.id, '卷内文字');
    const db = new Database(join(directory, 'Projects', work.id, 'project.sqlite'));
    try {
      db.exec(`CREATE TABLE search_touch(chapter_id TEXT);
        CREATE TRIGGER search_touch_insert AFTER INSERT ON search_document WHEN new.kind='paragraph'
        BEGIN INSERT INTO search_touch VALUES(new.chapter_id); END;
        CREATE TRIGGER search_touch_delete AFTER DELETE ON search_document WHEN old.kind='paragraph'
        BEGIN INSERT INTO search_touch VALUES(old.chapter_id); END;`);
      structure({ type: 'renameWork', title: '雨落以后' }); structure({ type: 'renameVolume', volumeId, title: '风雨卷' });
      structure({ type: 'moveChapter', chapterId: standalone.id, direction: 'down' });
      expect(db.prepare('SELECT * FROM search_touch').all()).toEqual([]);
      structure({ type: 'deleteVolume', volumeId });
      expect(db.prepare('SELECT DISTINCT chapter_id FROM search_touch').all()).toEqual([{ chapter_id: child.id }]);
      expect(search('卷外文字')).toHaveLength(1); expect(search('卷内文字')).toEqual([]);
      db.prepare('DELETE FROM search_touch').run(); structure({ type: 'restoreVolume', volumeId });
      expect(db.prepare('SELECT DISTINCT chapter_id FROM search_touch').all()).toEqual([{ chapter_id: child.id }]);
      expect(search('卷内文字')).toHaveLength(1);
    } finally { db.close(); }
  });
});
