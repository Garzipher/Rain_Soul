import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';
import { freezeSource } from '../../src/main/freeze-source';
import { initializeSourceSchema } from '../../src/workers/database/source-schema';
import { commitSourceAssets, readSourceAssets } from '../../src/workers/database/source-document';
import { knowledgeSourceLinkSchema, learningAnnotationSchema } from '../../src/shared/source-assets';

let fixture: ReturnType<typeof assetFixture>;
beforeEach(() => { fixture = assetFixture(); initializeSourceSchema(fixture.db); });
afterEach(() => fixture.db.close());
function sample() {
  fixture.change({ type: 'createKnowledge', body: '雨落灯下', source: '作品原文', categoryId: fixture.state().categories[0].id, tagIds: [] });
  const entryId = fixture.state().knowledge[0].id;
  const source = freezeSource({ kind: 'paste', title: '雨夜', rawBytes: Buffer.from('雨落灯下'), segments: [{ text: '雨落灯下' }, { text: '船鸣渐远' }] });
  const links = [{ entryId, sourceId: source.id, segmentId: source.segments[0].id }];
  const annotations = [{ id: randomUUID(), entryId, technique: '视听结合', usage: '夜景', exercise: '改写为晴天' }];
  return { source, links, annotations, entryId };
}
function commit(value: ReturnType<typeof sample>) { fixture.db.transaction(() => commitSourceAssets(fixture.db, value.source, value.links, value.annotations))(); }

it('冻结来源、段落、关联和学习注释独立往返，不污染知识原文及origin', () => {
  const value = sample(), revision = fixture.db.prepare('SELECT revision FROM work_meta').get();
  commit(value);
  expect(readSourceAssets(fixture.db)).toEqual({ documents: [value.source], links: value.links, annotations: value.annotations });
  expect(fixture.state().knowledge[0]).toMatchObject({ body: '雨落灯下', source: '作品原文', origin: null });
  expect(fixture.db.prepare('SELECT revision FROM work_meta').get()).toEqual(revision);
});
it('同来源可继续关联另一知识，但冻结正文不得被同ID替换', () => {
  const value = sample(); commit(value);
  fixture.change({ type: 'createKnowledge', body: '船鸣渐远', source: '雨夜', categoryId: fixture.state().categories[0].id, tagIds: [] });
  const entryId = fixture.state().knowledge.find(entry => entry.body === '船鸣渐远')!.id;
  fixture.db.transaction(() => commitSourceAssets(fixture.db, value.source, [{ entryId, sourceId: value.source.id, segmentId: value.source.segments[1].id }], []))();
  expect(readSourceAssets(fixture.db).documents).toHaveLength(1);
  expect(readSourceAssets(fixture.db).links).toHaveLength(2);
  expect(() => fixture.db.transaction(() => commitSourceAssets(fixture.db, { ...value.source, title: '篡改标题' }, [], []))()).toThrow();
  expect(readSourceAssets(fixture.db).documents[0].title).toBe('雨夜');
});
it('拒绝不存在或已删除知识以及错误来源段落，调用方事务整体回滚', () => {
  const value = sample();
  for (const links of [[{ ...value.links[0], entryId: randomUUID() }], [{ ...value.links[0], segmentId: randomUUID() }], [{ ...value.links[0], sourceId: randomUUID() }]]) {
    expect(() => fixture.db.transaction(() => commitSourceAssets(fixture.db, value.source, links, value.annotations))()).toThrow();
    expect(readSourceAssets(fixture.db).documents).toHaveLength(0);
  }
  fixture.db.prepare('UPDATE knowledge_entry SET deleted_at=? WHERE id=?').run('2026-10-10', value.entryId);
  expect(() => commit(value)).toThrow();
});
it('拒绝正文哈希或段落哈希不匹配，不写入来源', () => {
  const value = sample();
  for (const source of [{ ...value.source, bodyHash: 'a'.repeat(64) }, { ...value.source, segments: [{ ...value.source.segments[0], textHash: 'a'.repeat(64) }, value.source.segments[1]] }]) {
    expect(() => fixture.db.transaction(() => commitSourceAssets(fixture.db, source, value.links, value.annotations))()).toThrow();
    expect(readSourceAssets(fixture.db).documents).toHaveLength(0);
  }
});
it('严格结构拒绝额外字段、重复关联和不属于审核知识的注释', () => {
  const value = sample();
  expect(knowledgeSourceLinkSchema.safeParse({ ...value.links[0], extra: true }).success).toBe(false);
  expect(learningAnnotationSchema.safeParse({ ...value.annotations[0], originalText: '混入原文' }).success).toBe(false);
  expect(() => commit({ ...value, links: [...value.links, ...value.links] })).toThrow();
  expect(() => commit({ ...value, annotations: [{ ...value.annotations[0], entryId: randomUUID() }] })).toThrow();
  expect(readSourceAssets(fixture.db).documents).toHaveLength(0);
});
it('数据库外键防止跨来源段落和悬空知识关联，来源不能独立于调用方事务提交', () => {
  const value = sample(); commit(value);
  expect(() => commitSourceAssets(fixture.db, value.source, [], [])).toThrow(/事务/);
  expect(() => fixture.db.prepare('INSERT INTO knowledge_source VALUES(?,?,?)').run(randomUUID(), value.source.id, value.source.segments[0].id)).toThrow(/FOREIGN KEY/);
  const other = freezeSource({ kind: 'paste', title: '另一来源', rawBytes: Buffer.from('另文'), segments: [{ text: '另文' }] });
  fixture.db.transaction(() => commitSourceAssets(fixture.db, other, [], []))();
  expect(() => fixture.db.prepare('INSERT INTO knowledge_source VALUES(?,?,?)').run(value.entryId, other.id, value.source.segments[0].id)).toThrow(/FOREIGN KEY/);
});
it('读取时严格验证学习注释JSON，不静默忽略损坏资产', () => {
  const value = sample(); commit(value);
  fixture.db.prepare('UPDATE learning_annotation SET payload_json=?').run('{"technique":1}');
  expect(() => readSourceAssets(fixture.db)).toThrow();
});
