import { afterEach, beforeEach, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';
import { initializeSnapshots, listSnapshots } from '../../src/workers/database/snapshots';
import { importBookExtraction } from '../../src/workers/database/book-extraction';
import { searchAssets } from '../../src/workers/database/assets-search';

let fixture: ReturnType<typeof assetFixture>;
beforeEach(() => { fixture = assetFixture(); initializeSnapshots(fixture.db); });
afterEach(() => fixture.db.close());
function request() {
  return { workId: (fixture.db.prepare('SELECT id FROM work_meta').get() as { id: string }).id, expectedRevision: 1, operationId: crypto.randomUUID(),
    items: [{ body: '拆书景物描写', source: '《雨夜》／作者：作者；参考.txt；第1章 第2段；SHA-256：' + 'a'.repeat(64), categoryId: fixture.state().categories[2].id, tagIds: [] }] };
}
it('同一事务写入知识历史与搜索，保护快照和幂等回执；不同内容不得复用操作ID', () => {
  const input = request(); importBookExtraction(fixture.db, input); importBookExtraction(fixture.db, input);
  expect(fixture.state().knowledge).toHaveLength(1); expect(fixture.state().knowledge[0].body).toBe('拆书景物描写');
  expect(listSnapshots(fixture.db)).toHaveLength(1);
  expect(fixture.db.prepare('SELECT revision FROM work_meta').get()).toEqual({ revision: 2 });
  expect(searchAssets(fixture.db, { text: '景物', mode: 'knowledge' })).toHaveLength(1);
  expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM knowledge_history').get()).toEqual({ count: 1 });
  expect(() => importBookExtraction(fixture.db, { ...input, items: [{ ...input.items[0], body: '另一段' }] })).toThrow(/标识/);
});
it('无效分类/标签、版本冲突或跨作品失败原子回滚，不留下快照/回执/半批知识', () => {
  const input = request();
  expect(() => importBookExtraction(fixture.db, { ...input, items: [...input.items, { ...input.items[0], categoryId: crypto.randomUUID() }] })).toThrow();
  expect(() => importBookExtraction(fixture.db, { ...input, items: [{ ...input.items[0], tagIds: [crypto.randomUUID()] }] })).toThrow();
  expect(() => importBookExtraction(fixture.db, { ...input, expectedRevision: 2 })).toThrow(/版本/);
  expect(() => importBookExtraction(fixture.db, { ...input, workId: crypto.randomUUID() })).toThrow();
  expect(() => importBookExtraction(fixture.db, { ...input, items: [] })).toThrow();
  expect(fixture.state().knowledge).toHaveLength(0); expect(listSnapshots(fixture.db)).toHaveLength(0);
  expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM operation_log').get()).toEqual({ count: 0 });
});
it('仅使用有效已有标签；软删除标签/分类拒绝，已删除作品也不能写入', () => {
  const tagId = crypto.randomUUID(); fixture.change({ type: 'createTag', name: '雨景' });
  const actual = fixture.state().tags[0].id;
  const input = { ...request(), expectedRevision: 2 };
  importBookExtraction(fixture.db, { ...input, items: [{ ...input.items[0], tagIds: [actual] }] });
  expect(fixture.state().knowledge[0].tagIds).toEqual([actual]);
  fixture.db.prepare('UPDATE tag SET deleted_at=? WHERE id=?').run(new Date().toISOString(), actual);
  expect(() => importBookExtraction(fixture.db, { ...input, operationId: tagId, expectedRevision: 3, items: [{ ...input.items[0], tagIds: [actual] }] })).toThrow();
  fixture.db.prepare('UPDATE category SET deleted_at=? WHERE id=?').run(new Date().toISOString(), input.items[0].categoryId);
  expect(() => importBookExtraction(fixture.db, { ...input, operationId: crypto.randomUUID(), expectedRevision: 3 })).toThrow();
  fixture.db.prepare('UPDATE work_meta SET deleted_at=?').run(new Date().toISOString());
  expect(() => importBookExtraction(fixture.db, { ...input, operationId: crypto.randomUUID(), expectedRevision: 3 })).toThrow(/删除/);
  expect(fixture.state().knowledge).toHaveLength(1); expect(listSnapshots(fixture.db)).toHaveLength(1);
});
