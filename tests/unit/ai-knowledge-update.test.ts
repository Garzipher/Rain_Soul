import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';
import { approveAiKnowledge } from '../../src/workers/database/ai-apply';
import { initializeSnapshots, listSnapshots, restoreSnapshot } from '../../src/workers/database/snapshots';
import { searchAssets } from '../../src/workers/database/assets-search';
import { aiKnowledgeApprovalSchema } from '../../src/shared/ai-extraction';
import type { AiCandidate } from '../../src/shared/ai';

let fixture: ReturnType<typeof assetFixture>;
const revision = () => (fixture.db.prepare('SELECT revision FROM work_meta').get() as { revision: number }).revision;
const candidate = (): AiCandidate => ({ id: randomUUID(), operation: 'extractKnowledge', workId: (fixture.db.prepare('SELECT id FROM work_meta').get() as { id: string }).id,
  baselineRevision: revision(), paragraphIds: [fixture.paragraphId], referenceChapterIds: [fixture.chapterId], text: '模型的待审核角色资料', requestHash: 'b'.repeat(64), createdAt: new Date().toISOString() });
beforeEach(() => { fixture = assetFixture(); initializeSnapshots(fixture.db); });
afterEach(() => fixture.db.close());
function existing() {
  fixture.change({ type: 'createTag', name: '角色' });
  return fixture.change({ type: 'createKnowledge', body: '旧角色资料', source: '原书出处', categoryId: fixture.state().categories[0].id, tagIds: [fixture.state().tags[0].id] }).knowledge[0];
}
it('显式更新同一知识ID，保留引用、原始出处历史与分类标签，事务前快照可恢复', () => {
  const entry = existing(), input = candidate(), operationId = randomUUID();
  const bookmark = { type: 'bookmark' as const, attrs: { id: randomUUID(), kind: 'knowledge' as const, targetId: entry.id } };
  const document = structuredClone(fixture.document); document.content[0].content!.push(bookmark);
  fixture.db.prepare('UPDATE chapter SET document_json=?').run(JSON.stringify(document));
  const items = [{ mode: 'update' as const, targetId: entry.id, body: '新角色资料', source: '本章审核' }];
  approveAiKnowledge(fixture.db, input, items, operationId);
  approveAiKnowledge(fixture.db, input, items, operationId);
  const state = fixture.state(); expect(state.knowledge).toHaveLength(1);
  expect(state.knowledge[0]).toMatchObject({ id: entry.id, body: '新角色资料', categoryId: entry.categoryId, tagIds: entry.tagIds, revision: input.baselineRevision + 1 });
  expect(state.knowledge[0].source).toContain('AI 审核来源：');
  expect(fixture.db.prepare('SELECT document_json FROM chapter').get()).toEqual({ document_json: JSON.stringify(document) });
  expect(fixture.db.prepare('SELECT body,source FROM knowledge_history WHERE entry_id=? ORDER BY revision LIMIT 1').get(entry.id)).toEqual({ body: '旧角色资料', source: '原书出处' });
  expect(searchAssets(fixture.db, { text: '新角色', mode: 'knowledge' })[0].id).toBe(entry.id);
  expect(listSnapshots(fixture.db)).toHaveLength(1); expect(revision()).toBe(input.baselineRevision + 1);
  restoreSnapshot(fixture.db, listSnapshots(fixture.db)[0].id, revision());
  expect(fixture.state().knowledge[0]).toMatchObject(entry);
});
it('更新可显式改分类和清空标签，与新建混合提交仍只产生一次版本和保护快照', () => {
  const entry = existing(); const category = fixture.change({ type: 'createCategory', name: '人物', parentId: null }).categories.find(item => item.name === '人物')!;
  const input = candidate();
  approveAiKnowledge(fixture.db, input, [{ mode: 'update', targetId: entry.id, body: '修订后', source: '', categoryId: category.id, tagIds: [] }, { body: '新增资料', source: '' }], randomUUID());
  expect(fixture.state().knowledge.find(item => item.id === entry.id)).toMatchObject({ body: '修订后', categoryId: category.id, tagIds: [] });
  expect(fixture.state().knowledge).toHaveLength(2); expect(listSnapshots(fixture.db)).toHaveLength(1); expect(revision()).toBe(input.baselineRevision + 1);
});
it('无目标、异作目标、已删除目标和重复更新目标拒绝整批，不残留新条目、快照或回执', () => {
  const entry = existing(), input = candidate(), before = fixture.state();
  const update = { mode: 'update' as const, targetId: entry.id, body: '候选', source: '' };
  for (const items of [
    [{ ...update, targetId: undefined }], [{ ...update, targetId: randomUUID() }], [update, update],
    [{ mode: 'create', targetId: entry.id, body: '误传目标', source: '' }],
  ]) {
    expect(() => approveAiKnowledge(fixture.db, input, [{ body: '不得部分新建', source: '' }, ...items] as never, randomUUID())).toThrow();
    expect(fixture.state()).toEqual(before); expect(listSnapshots(fixture.db)).toEqual([]);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM operation_log').get()).toEqual({ count: 0 });
  }
  fixture.change({ type: 'deleteKnowledge', id: entry.id });
  expect(() => approveAiKnowledge(fixture.db, candidate(), [update], randomUUID())).toThrow();
  expect(listSnapshots(fixture.db)).toEqual([]);
});
it('更新失败回滚混合批次、索引、历史、快照与revision，陈旧候选也不覆盖已有条目', () => {
  const entry = existing(), input = candidate(), before = fixture.state();
  fixture.db.exec("CREATE TRIGGER reject_ai_update BEFORE UPDATE ON knowledge_entry BEGIN SELECT RAISE(ABORT,'模拟知识更新失败'); END;");
  const items = [{ body: '先新建', source: '' }, { mode: 'update' as const, targetId: entry.id, body: '更新失败', source: '' }];
  expect(() => approveAiKnowledge(fixture.db, input, items, randomUUID())).toThrow(/更新失败/);
  expect(fixture.state()).toEqual(before); expect(revision()).toBe(input.baselineRevision); expect(listSnapshots(fixture.db)).toEqual([]);
  expect(searchAssets(fixture.db, { text: '先新建', mode: 'knowledge' })).toEqual([]);
  expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_history').get()).toEqual({ count: 1 });
  expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM operation_log').get()).toEqual({ count: 0 });
  fixture.db.exec('DROP TRIGGER reject_ai_update'); fixture.change({ type: 'createTag', name: '后续编辑' });
  expect(() => approveAiKnowledge(fixture.db, input, items, randomUUID())).toThrow(/版本/);
  expect(fixture.state().knowledge).toEqual(before.knowledge);
});
it('共享审核协议仅允许默认新建或带稳定ID的显式更新，不采信模型给出的自由目标字段', () => {
  const value = { body: '作者审核', source: '' }, id = randomUUID();
  expect(aiKnowledgeApprovalSchema.parse(value)).toEqual(value);
  expect(aiKnowledgeApprovalSchema.parse({ ...value, mode: 'update', targetId: id })).toMatchObject({ targetId: id });
  for (const invalid of [{ ...value, mode: 'update' }, { ...value, targetId: id }, { ...value, mode: 'merge', targetId: id }, { ...value, mode: 'create', targetId: id }]) expect(aiKnowledgeApprovalSchema.safeParse(invalid).success).toBe(false);
});
