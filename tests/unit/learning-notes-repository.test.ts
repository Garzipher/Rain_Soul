import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';
import { initializeSnapshots, createSnapshot, restoreSnapshot } from '../../src/workers/database/snapshots';
import { initializeSourceSchema } from '../../src/workers/database/source-schema';
import { importBookExtraction } from '../../src/workers/database/book-extraction';
import { freezeSource } from '../../src/main/freeze-source';
import { searchAssets } from '../../src/workers/database/assets-search';
import { readSourceAssets } from '../../src/workers/database/source-document';
import type { AssetAction } from '../../src/shared/assets';

let fixture: ReturnType<typeof assetFixture>;
const note = { technique: '以重复动作承载情绪', usage: '读完旧信后的克制难过', exercise: '改为折协议纸，练习重复动作' };
beforeEach(() => { fixture = assetFixture(); initializeSnapshots(fixture.db); initializeSourceSchema(fixture.db); });
afterEach(() => fixture.db.close());
function extract() {
  const sourceDocument = freezeSource({ kind: 'paste', title: '原创参考', rawBytes: Buffer.from('她把信折了两遍。'), segments: [{ text: '她把信折了两遍。' }] });
  importBookExtraction(fixture.db, { workId: (fixture.db.prepare('SELECT id FROM work_meta').get() as { id: string }).id, expectedRevision: 1, operationId: randomUUID(), sourceDocument,
    items: [{ body: '她把信折了两遍。', source: '原创参考第一段', categoryId: fixture.state().categories[0].id, tagIds: [], segmentId: sourceDocument.segments[0].id, annotation: note }] });
  return fixture.state().knowledge[0];
}
const notes = (entry: ReturnType<typeof extract>) => (entry as unknown as { learningNotes?: typeof note[] }).learningNotes;
it('已审核学习注释随作品知识读回，原文与来源保持独立', () => {
  const entry = extract();
  expect(notes(entry)).toEqual([note]); expect(entry.body).toBe('她把信折了两遍。'); expect(entry.source).toBe('原创参考第一段');
});
it('旧作品已有学习注释可按手法场景和练习搜索，正文摘要不混入注释', () => {
  const entry = extract();
  // 模拟升级前只索引原句、未索引已保存注释的旧作品。
  fixture.db.prepare('UPDATE search_document SET normalized_text=? WHERE id=?').run(entry.body.toLowerCase(), `k:${entry.id}`);
  for (const text of ['重复动作', '难过', '折协议']) expect(searchAssets(fixture.db, { text, mode: 'knowledge' })).toEqual([expect.objectContaining({ id: entry.id, snippet: entry.body })]);
});
it('手工创建知识可附加多条学习注释，软删除后原文与注释均不能被搜索', () => {
  const categoryId = fixture.state().categories[0].id;
  fixture.change({ type: 'createKnowledge', body: '窗外有人走过。', source: '原创练习', categoryId, tagIds: [], learningNotes: [note, { technique: '限制视角', usage: '', exercise: '' }] });
  const entry = fixture.state().knowledge[0];
  expect(notes(entry)).toEqual([note, { technique: '限制视角', usage: '', exercise: '' }]);
  expect(searchAssets(fixture.db, { text: '限制视角', mode: 'knowledge' })).toHaveLength(1);
  fixture.change({ type: 'deleteKnowledge', id: entry.id });
  expect(searchAssets(fixture.db, { text: '限制视角', mode: 'knowledge' })).toEqual([]);
});
it('编辑学习注释可覆盖和清除，旧调用省略字段时保留；原始来源证据不变', () => {
  const entry = extract(), before = readSourceAssets(fixture.db);
  const update = { type: 'updateKnowledge', id: entry.id, body: entry.body, source: entry.source, categoryId: entry.categoryId, tagIds: entry.tagIds };
  fixture.change({ ...update, learningNotes: [{ ...note, usage: '重逢时的克制' }] } as AssetAction);
  expect(notes(fixture.state().knowledge[0])).toEqual([{ ...note, usage: '重逢时的克制' }]);
  expect(searchAssets(fixture.db, { text: '难过', mode: 'knowledge' })).toHaveLength(0);
  expect(searchAssets(fixture.db, { text: '重逢', mode: 'knowledge' })).toHaveLength(1);
  fixture.change(update as AssetAction); expect(notes(fixture.state().knowledge[0])).toEqual([{ ...note, usage: '重逢时的克制' }]);
  fixture.change({ ...update, learningNotes: [] } as AssetAction);
  expect(notes(fixture.state().knowledge[0]) ?? []).toEqual([]); expect(searchAssets(fixture.db, { text: '重复动作', mode: 'knowledge' })).toHaveLength(0);
  expect(readSourceAssets(fixture.db).documents).toEqual(before.documents); expect(readSourceAssets(fixture.db).links).toEqual(before.links);
});
it('坏注释拒绝且事务回滚，恢复快照恢复注释及搜索', () => {
  const entry = extract(), snapshot = createSnapshot(fixture.db, '学习前', 'manual');
  const update = { type: 'updateKnowledge', id: entry.id, body: entry.body, source: entry.source, categoryId: entry.categoryId, tagIds: [] };
  expect(() => fixture.change({ ...update, learningNotes: [{ ...note, technique: 42 }] } as unknown as AssetAction)).toThrow();
  expect(notes(fixture.state().knowledge[0])).toEqual([note]);
  fixture.change({ ...update, learningNotes: [] } as AssetAction);
  const revision = (fixture.db.prepare('SELECT revision FROM work_meta').get() as { revision: number }).revision;
  restoreSnapshot(fixture.db, snapshot.id, revision);
  expect(notes(fixture.state().knowledge[0])).toEqual([note]); expect(searchAssets(fixture.db, { text: '难过', mode: 'knowledge' })).toHaveLength(1);
});
