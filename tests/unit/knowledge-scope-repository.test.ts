import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';
import type { KnowledgeCopyRequest } from '../../src/shared/knowledge-scope';
import type { WorkDetail } from '../../src/shared/contracts';

describe('知识库跨作品只读汇总与复制', () => {
  let directory: string; let repository: WorkRepository; let source: WorkDetail; let target: WorkDetail;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-knowledge-scope-')); repository = new WorkRepository(directory);
    source = repository.createWork('源作品');
    source = repository.manageAssets({ workId: source.id, expectedRevision: source.revision, operationId: randomUUID(), action: {
      type: 'createKnowledge', body: '雨点落在风铃上。', source: '优秀作品：第二章', categoryId: source.assets!.categories[1].id, tagIds: [],
    } });
    target = repository.createWork('目标作品');
  });
  afterEach(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = (): KnowledgeCopyRequest => ({ workId: target.id, expectedRevision: target.revision, operationId: randomUUID(),
    sourceWorkId: source.id, sourceEntryId: source.assets!.knowledge[0].id, sourceExpectedRevision: source.revision,
    categoryId: target.assets!.categories[0].id, tagIds: [] });
  it('汇总只展示活动知识且附作品身份，不合并各作品分类标签，读取不改作品版本', () => {
    const scope = repository.readKnowledgeScope(null);
    expect(scope.knowledge).toHaveLength(1); expect(scope.categories).toEqual([]); expect(scope.tags).toEqual([]);
    expect(scope.entryOwners[scope.knowledge[0].id]).toEqual({ workId: source.id, workTitle: source.title, sourceRevision: source.revision, sourceEntryId: source.assets!.knowledge[0].id });
    expect(repository.readKnowledgeScope(source.id).knowledge[0].id).toBe(source.assets!.knowledge[0].id);
    expect(repository.openWork(target.id).revision).toBe(target.revision);
    expect(repository.searchKnowledgeScope(null, { text: '风铃', mode: 'knowledge' })).toEqual([expect.objectContaining({ workId: source.id, workTitle: source.title, kind: 'knowledge' })]);
    expect(() => repository.searchKnowledgeScope(null, { text: '', mode: 'knowledge', categoryId: source.assets!.categories[0].id })).toThrow();
  });
  it('跨作复制从仓储取正文和来源，只改目标且幂等重放不会重复入库', () => {
    const command = request(); target = repository.copyKnowledge(command);
    expect(target.assets!.knowledge[0]).toMatchObject({ body: source.assets!.knowledge[0].body, source: source.assets!.knowledge[0].source,
      categoryId: command.categoryId, tagIds: [], origin: { workId: source.id, entryId: command.sourceEntryId, sourceRevision: source.revision, workTitle: source.title } });
    expect(target.assets!.knowledge[0].id).not.toBe(command.sourceEntryId);
    expect(repository.copyKnowledge(command).assets!.knowledge).toHaveLength(1);
    expect(repository.openWork(source.id).revision).toBe(source.revision);
    source = repository.manageAssets({ workId: source.id, expectedRevision: source.revision, operationId: randomUUID(), action: { type: 'deleteKnowledge', id: command.sourceEntryId } });
    // 已确认写入的未知回执重试，不能再次读取变化后的来源或重复插入。
    expect(repository.copyKnowledge(command).assets!.knowledge).toHaveLength(1);
  });
  it('来源版本变化要求重新确认，跨作伪造内容字段及外来分类被拒且目标版本不变', () => {
    const command = request();
    source = repository.manageAssets({ workId: source.id, expectedRevision: source.revision, operationId: randomUUID(), action: { type: 'createTag', name: '风铃' } });
    expect(() => repository.copyKnowledge(command)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(() => repository.copyKnowledge({ ...request(), body: '伪造正文' } as KnowledgeCopyRequest)).toThrow();
    expect(() => repository.copyKnowledge({ ...request(), categoryId: randomUUID() })).toThrow();
    expect(repository.openWork(target.id).revision).toBe(target.revision); expect(repository.openWork(target.id).assets!.knowledge).toEqual([]);
  });
  it('软删除源作品不进入全局结果且不可复制，不覆盖目标内容', () => {
    repository.manageStructure({ workId: source.id, expectedRevision: source.revision, operationId: randomUUID(), action: { type: 'deleteWork' } });
    expect(repository.readKnowledgeScope(null).knowledge).toEqual([]);
    expect(repository.searchKnowledgeScope(null, { text: '风铃', mode: 'knowledge' })).toEqual([]);
    expect(() => repository.readKnowledgeScope(source.id)).toThrow(); expect(() => repository.copyKnowledge(request())).toThrow();
    expect(repository.openWork(target.id).revision).toBe(target.revision);
  });
});
