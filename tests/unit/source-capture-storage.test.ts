import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';
import { freezeSource } from '../../src/main/freeze-source';
import { initializeSourceSchema } from '../../src/workers/database/source-schema';
import { commitSourceAssets, readSourceAssets } from '../../src/workers/database/source-document';
import { createSnapshot, initializeSnapshots, readCompatiblePayload, restoreSnapshot, freezeSnapshotExport } from '../../src/workers/database/snapshots';

const fixtures: ReturnType<typeof assetFixture>[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.db.close(); });
const capturedAt = '2026-10-13T00:00:00Z';
const input = { kind: 'web' as const, title: '文章', rawBytes: Buffer.from('原HTML'), originalUrl: 'https://example.com/article',
  finalUrl: 'https://example.com/article', fetchedAt: capturedAt, segments: [{ text: '原文' }] };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture() { const fixture = assetFixture(); fixtures.push(fixture); initializeSourceSchema(fixture.db); initializeSnapshots(fixture.db); return fixture; }
const restricted = { captureMethod: 'restricted-browser' as const, capturedAt, policyVersion: 1 as const, renderedDomHash: 'd'.repeat(64) };

it.each(['static', 'restricted-browser'] as const)('冻结 %s 证据完整落盘并保持原HTML和正文哈希', method => {
  const { db } = fixture(), capture = method === 'static' ? { captureMethod: method, capturedAt, policyVersion: 1 as const } : restricted;
  const source = freezeSource({ ...input, capture }); expect(source.capture).toEqual({ ...capture, sourceId: source.id });
  expect(source.rawHash).toBe('894df329649eae3444e0787e5f075c4e64b90ec403d691c87a6ba176c5eb8fdb');
  db.transaction(() => commitSourceAssets(db, source, [], []))(); expect(readSourceAssets(db).documents).toEqual([source]);
  expect(db.prepare('SELECT * FROM source_capture').get()).toEqual({ source_id: source.id, method, captured_at: capturedAt,
    rendered_dom_hash: method === 'static' ? null : 'd'.repeat(64), policy_version: 1 });
});
it('运行时捕获来源ID不能冒充冻结函数生成的ID', () => {
  expect(() => freezeSource({ ...input, capture: { ...restricted, sourceId: randomUUID() } } as Parameters<typeof freezeSource>[0])).toThrow();
});
it('不同证据不能覆盖已有来源', () => {
  const { db } = fixture(), source = freezeSource({ ...input, capture: restricted }); db.transaction(() => commitSourceAssets(db, source, [], []))();
  expect(() => db.transaction(() => commitSourceAssets(db, { ...source, capture: { ...source.capture!, capturedAt: '2026-10-14T00:00:00Z' } }, [], []))()).toThrow(/不同内容/);
});
it('捕获落盘失败原子回滚来源正文与证据', () => {
  const { db } = fixture(), source = freezeSource({ ...input, capture: restricted });
  db.exec("CREATE TRIGGER reject_capture BEFORE INSERT ON source_capture BEGIN SELECT RAISE(ABORT,'模拟证据失败'); END;");
  expect(() => db.transaction(() => commitSourceAssets(db, source, [], []))()).toThrow(/模拟证据失败/);
  expect(readSourceAssets(db).documents).toEqual([]); expect(db.prepare('SELECT * FROM source_segment').all()).toEqual([]);
});
it('坏捕获时间与孤立捕获关系拒绝读取', () => {
  const { db } = fixture(), source = freezeSource({ ...input, capture: restricted }); db.transaction(() => commitSourceAssets(db, source, [], []))();
  db.prepare('UPDATE source_capture SET captured_at=?').run('昨天'); expect(() => readSourceAssets(db)).toThrow();
  db.prepare('UPDATE source_capture SET captured_at=?').run(capturedAt); db.pragma('foreign_keys=OFF');
  db.prepare('UPDATE source_capture SET source_id=?').run(randomUUID()); expect(() => readSourceAssets(db)).toThrow();
});
it('新payload3恢复证据且历史导出先校验捕获关联', () => {
  const { db } = fixture(), source = freezeSource({ ...input, capture: restricted }); db.transaction(() => commitSourceAssets(db, source, [], []))();
  const snapshot = createSnapshot(db, '受限来源'); expect(snapshot.schemaVersion).toBe(3);
  db.exec('DELETE FROM source_capture; DELETE FROM source_segment; DELETE FROM source_document;');
  restoreSnapshot(db, snapshot.id, 1); expect(readSourceAssets(db).documents).toEqual([source]);
  expect(freezeSnapshotExport(db, snapshot.id).title).toBe('测试作品');
});
it.each([1, 2])('旧payload%s只在内存补空捕获关系且不改历史字节hash', version => {
  const { db } = fixture(), source = freezeSource(input); db.transaction(() => commitSourceAssets(db, source, [], []))();
  const snapshot = createSnapshot(db, '旧来源');
  const current = db.prepare('SELECT * FROM snapshot WHERE id=?').get(snapshot.id) as { id: string; title: string; payload_json: string; payload_hash: string; schema_version: number };
  const payload = JSON.parse(current.payload_json); delete payload.source_capture;
  if (version === 1) for (const name of ['source_document', 'source_segment', 'knowledge_source', 'learning_annotation']) delete payload[name];
  const bytes = JSON.stringify(payload), legacy = { ...current, payload_json: bytes, payload_hash: hash(bytes), schema_version: version };
  db.prepare('UPDATE snapshot SET payload_json=?,payload_hash=?,schema_version=? WHERE id=?').run(bytes, legacy.payload_hash, version, snapshot.id);
  expect(readCompatiblePayload(db, legacy).source_capture).toEqual([]); restoreSnapshot(db, snapshot.id, 1);
  expect(db.prepare('SELECT payload_json,payload_hash FROM snapshot WHERE id=?').get(snapshot.id)).toEqual({ payload_json: bytes, payload_hash: legacy.payload_hash });
  expect(() => readCompatiblePayload(db, { ...legacy, payload_hash: 'a'.repeat(64) })).toThrow(/校验/);
});
it.each(['extra', 'identity', 'kind', 'static-dom', 'duplicate'])('payload3捕获%s损坏即使重签hash也拒绝', mode => {
  const { db } = fixture(), source = freezeSource({ ...input, capture: restricted }); db.transaction(() => commitSourceAssets(db, source, [], []))();
  const snapshot = createSnapshot(db, '证据'), row = db.prepare('SELECT * FROM snapshot WHERE id=?').get(snapshot.id) as { id: string; title: string; payload_json: string; payload_hash: string; schema_version: number };
  const payload = JSON.parse(row.payload_json), capture = payload.source_capture[0];
  if (mode === 'extra') capture.unknown = true;
  if (mode === 'identity') capture.source_id = randomUUID();
  if (mode === 'kind') { Object.assign(payload.source_document[0], { kind: 'paste', original_url: null, final_url: null, fetched_at: null }); }
  if (mode === 'static-dom') capture.method = 'static';
  if (mode === 'duplicate') payload.source_capture.push(capture);
  const bytes = JSON.stringify(payload); expect(() => readCompatiblePayload(db, { ...row, payload_json: bytes, payload_hash: hash(bytes) })).toThrow();
});
