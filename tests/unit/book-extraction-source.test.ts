import { afterEach, beforeEach, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';
import { initializeSnapshots, listSnapshots } from '../../src/workers/database/snapshots';
import { initializeSourceSchema } from '../../src/workers/database/source-schema';
import { readSourceAssets } from '../../src/workers/database/source-document';
import { importBookExtraction } from '../../src/workers/database/book-extraction';
import { freezeSource } from '../../src/main/freeze-source';

let fixture: ReturnType<typeof assetFixture>;
beforeEach(() => { fixture = assetFixture(); initializeSnapshots(fixture.db); initializeSourceSchema(fixture.db); });
afterEach(() => fixture.db.close());
function sample() {
  const sourceDocument = freezeSource({ kind: 'paste', title: '参考作品', rawBytes: Buffer.from('灯火很暖。'), segments: [{ text: '灯火很暖。' }] });
  return { workId: (fixture.db.prepare('SELECT id FROM work_meta').get() as { id: string }).id,
    expectedRevision: 1, operationId: crypto.randomUUID(), sourceDocument,
    items: [{ body: '灯火很暖。', source: '可信出处', categoryId: fixture.state().categories[0].id, tagIds: [],
      segmentId: sourceDocument.segments[0].id, annotation: { technique: '以光写温度', usage: '温暖场景', exercise: '改写冷色灯光' } }] };
}
it('审核事务写入原文关联与独立学习注释，重试不重复入库', () => {
  const request = sample(); importBookExtraction(fixture.db, request); importBookExtraction(fixture.db, request);
  const entry = fixture.state().knowledge[0], assets = readSourceAssets(fixture.db);
  expect(entry.body).toBe('灯火很暖。'); expect(entry.origin).toBeNull();
  expect(assets.documents).toEqual([request.sourceDocument]);
  expect(assets.links).toEqual([{ entryId: entry.id, sourceId: request.sourceDocument.id, segmentId: request.items[0].segmentId }]);
  expect(assets.annotations).toEqual([expect.objectContaining({ entryId: entry.id, ...request.items[0].annotation })]);
  expect(listSnapshots(fixture.db)).toHaveLength(1); expect(fixture.state().knowledge).toHaveLength(1);
});
it('同一带章段坐标来源分两批审核入库，真实SQLite事务保留坐标与幂等回执', () => {
  const request = sample();
  const sourceDocument = freezeSource({ kind: 'txt', title: '多章素材', rawBytes: Buffer.from('甲乙'), segments: [{ text: '甲章原文', chapterIndex: 1, paragraphIndex: 1 }, { text: '乙章原文', chapterIndex: 2, paragraphIndex: 1 }] });
  const first = { ...request, sourceDocument, items: [{ ...request.items[0], body: '甲章原文', segmentId: sourceDocument.segments[0].id }] };
  importBookExtraction(fixture.db, first);
  const second = { ...request, sourceDocument, operationId: crypto.randomUUID(), expectedRevision: 2, items: [{ ...request.items[0], body: '乙章原文', segmentId: sourceDocument.segments[1].id }] };
  importBookExtraction(fixture.db, second); importBookExtraction(fixture.db, second);
  expect(fixture.state().knowledge).toHaveLength(2); expect(readSourceAssets(fixture.db).documents).toEqual([sourceDocument]);
  expect(readSourceAssets(fixture.db).links).toHaveLength(2); expect(listSnapshots(fixture.db)).toHaveLength(2);
  expect(fixture.db.prepare('SELECT revision FROM work_meta').get()).toEqual({ revision: 3 });
});
it('不属于来源的段落、坏哈希或后续条目失败时全部回滚', () => {
  const request = sample();
  for (const invalid of [
    { ...request, items: [{ ...request.items[0], segmentId: crypto.randomUUID() }] },
    { ...request, sourceDocument: { ...request.sourceDocument, bodyHash: 'a'.repeat(64) } },
    { ...request, items: [...request.items, { ...request.items[0], categoryId: crypto.randomUUID() }] },
  ]) {
    expect(() => importBookExtraction(fixture.db, invalid)).toThrow();
    expect(fixture.state().knowledge).toHaveLength(0); expect(readSourceAssets(fixture.db).documents).toHaveLength(0);
    expect(listSnapshots(fixture.db)).toHaveLength(0);
  }
});
it('有来源必须绑定段落，缺来源不能携带学习注释，重复段落拒绝', () => {
  const request = sample(), legacy = { ...request, sourceDocument: undefined };
  expect(() => importBookExtraction(fixture.db, legacy)).toThrow();
  expect(() => importBookExtraction(fixture.db, { ...request, items: [{ ...request.items[0], segmentId: undefined }] })).toThrow();
  expect(() => importBookExtraction(fixture.db, { ...request, items: [...request.items, ...request.items] })).toThrow();
});
it('保留较长原始与最终网址的完整出处，不因旧3000字符限制丢弃来源', () => {
  const request = sample(); request.items[0].source = '原始网址：https://article.example.com/' + 'a'.repeat(1900) + '；最终网址：https://article.example.com/' + 'b'.repeat(1900);
  expect(() => importBookExtraction(fixture.db, request)).not.toThrow();
  expect(fixture.state().knowledge[0].source).toBe(request.items[0].source);
});
