import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { assetFixture } from './assets-helper';
import { initializeSchema } from '../../src/workers/database/schema';
import { initializeSnapshots, createSnapshot, restoreSnapshot, previewSnapshot } from '../../src/workers/database/snapshots';
import { initializeConversations } from '../../src/workers/database/conversations';
import { commitSourceAssets, readSourceAssets } from '../../src/workers/database/source-document';
import { freezeSource } from '../../src/main/freeze-source';
import { initializeSourceSchema } from '../../src/workers/database/source-schema';

const directories: string[] = [], databases: Database.Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) if (db.open) db.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
export function legacySourceFixture(version: 4 | 5) {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-source-migrate-')); directories.push(directory);
  const fixture = assetFixture(); initializeSnapshots(fixture.db); if (version === 5) initializeConversations(fixture.db);
  const snapshot = createSnapshot(fixture.db, '升级前原稿');
  fixture.db.pragma(`user_version=${version}`); const file = join(directory, 'project.sqlite'); fixture.db.prepare('VACUUM INTO ?').run(file); fixture.db.close();
  const db = new Database(file); databases.push(db); db.pragma('foreign_keys=ON'); return { db, directory, snapshot };
}
it.each([4, 5] as const)('v%s升级保留原payload1哈希，恢复生成payload2并只备份一次', version => {
  const { db, directory, snapshot } = legacySourceFixture(version);
  const original = db.prepare('SELECT payload_hash FROM snapshot WHERE id=?').get(snapshot.id);
  initializeSchema(db, 'project'); expect(db.pragma('user_version', { simple: true })).toBe(7);
  expect(readSourceAssets(db)).toEqual({ documents: [], links: [], annotations: [] });
  const backups = readdirSync(directory).filter(name => name.includes(`v${version}-backup`)); expect(backups).toHaveLength(1);
  const restored = restoreSnapshot(db, snapshot.id, 1); expect(restored.restored.schemaVersion).toBe(2);
  expect(db.prepare('SELECT payload_hash FROM snapshot WHERE id=?').get(snapshot.id)).toEqual(original);
  initializeSchema(db, 'project'); expect(readdirSync(directory).filter(name => name.includes('backup'))).toEqual(backups);
});
it('v5备份失败或迁移校验失败不改变原库版本、正文及快照', () => {
  const { db, snapshot } = legacySourceFixture(5), prepare = db.prepare.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation(sql => { if (sql === 'VACUUM INTO ?') throw new Error('磁盘满'); return prepare(sql); });
  expect(() => initializeSchema(db, 'project')).toThrow(); expect(db.pragma('user_version', { simple: true })).toBe(5);
  vi.restoreAllMocks(); const pragma = db.pragma.bind(db);
  vi.spyOn(db, 'pragma').mockImplementation((sql, options) => sql === 'foreign_key_check' ? [{ table: 'broken' }] : pragma(sql, options));
  expect(() => initializeSchema(db, 'project')).toThrow(); vi.restoreAllMocks();
  expect(db.pragma('user_version', { simple: true })).toBe(5);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='source_document'").get()).toBeUndefined();
  expect(db.prepare('SELECT id FROM snapshot').get()).toEqual({ id: snapshot.id });
});
it('旧hash损坏拒绝恢复且不产生安全快照或改写正文', () => {
  const { db, snapshot } = legacySourceFixture(5); initializeSchema(db, 'project');
  db.prepare('UPDATE snapshot SET payload_hash=?').run('a'.repeat(64));
  expect(() => restoreSnapshot(db, snapshot.id, 1)).toThrow(/校验/);
  expect(db.prepare('SELECT revision FROM work_meta').get()).toEqual({ revision: 1 });
  expect(db.prepare('SELECT count(*) count FROM snapshot').get()).toEqual({ count: 1 });
});
it('快照预览拒绝重新签名但原文来源哈希被篡改的payload2', () => {
  const { db } = legacySourceFixture(5); initializeSchema(db, 'project');
  const source = freezeSource({ kind: 'paste', title: '原文', rawBytes: Buffer.from('原文'), segments: [{ text: '原文' }] });
  db.transaction(() => commitSourceAssets(db, source, [], []))(); const snapshot = createSnapshot(db, '含来源');
  const row = db.prepare('SELECT payload_json FROM snapshot WHERE id=?').get(snapshot.id) as { payload_json: string };
  const payload = JSON.parse(row.payload_json); payload.source_segment[0].text = '篡改'; const text = JSON.stringify(payload);
  db.prepare('UPDATE snapshot SET payload_json=?,payload_hash=? WHERE id=?').run(text, createHash('sha256').update(text).digest('hex'), snapshot.id);
  expect(() => previewSnapshot(db, snapshot.id)).toThrow(/哈希/);
});
it('旧payload1可选learning跟踪表必须按固定字段验证，未知JSON字段不能被忽略', () => {
  const { db, snapshot } = legacySourceFixture(5); initializeSchema(db, 'project');
  const row = db.prepare('SELECT payload_json FROM snapshot WHERE id=?').get(snapshot.id) as { payload_json: string };
  const payload = JSON.parse(row.payload_json); payload.learning_course = [{ course_key: '合法key', unknown: '恶意字段' }]; const text = JSON.stringify(payload);
  db.prepare('UPDATE snapshot SET payload_json=?,payload_hash=? WHERE id=?').run(text, createHash('sha256').update(text).digest('hex'), snapshot.id);
  expect(() => previewSnapshot(db, snapshot.id)).toThrow();
});

function legacyV6() {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-source-v6-')); directories.push(directory);
  const fixture = assetFixture(); initializeSnapshots(fixture.db); initializeConversations(fixture.db); initializeSourceSchema(fixture.db);
  fixture.db.exec('ALTER TABLE source_segment DROP COLUMN paragraph_index; ALTER TABLE source_segment DROP COLUMN chapter_index;');
  const source = freezeSource({ kind: 'txt', title: '旧来源', rawBytes: Buffer.from('旧原文'), segments: [{ text: '旧原文' }] });
  fixture.db.prepare('INSERT INTO source_document VALUES(?,?,?,?,?,?,?,?,?)').run(source.id, source.kind, 1, null, null, source.title, null, source.rawHash, source.bodyHash);
  const segment = source.segments[0]; fixture.db.prepare('INSERT INTO source_segment VALUES(?,?,?,?,?,?)').run(segment.id, source.id, 1, '', segment.text, segment.textHash);
  const snapshot = createSnapshot(fixture.db, '旧六列来源'); fixture.db.pragma('user_version=6');
  const file = join(directory, 'project.sqlite'); fixture.db.prepare('VACUUM INTO ?').run(file); fixture.db.close();
  const db = new Database(file); databases.push(db); db.pragma('foreign_keys=ON'); return { db, directory, source, snapshot };
}
it('v6坐标升级备份一次，原来源及旧payload2hash保留，恢复时只补空坐标', () => {
  const { db, directory, source, snapshot } = legacyV6();
  const original = db.prepare('SELECT payload_hash FROM snapshot WHERE id=?').get(snapshot.id);
  initializeSchema(db, 'project'); expect(db.pragma('user_version', { simple: true })).toBe(7);
  expect(readSourceAssets(db).documents).toEqual([source]);
  expect(db.prepare('SELECT chapter_index,paragraph_index FROM source_segment').get()).toEqual({ chapter_index: null, paragraph_index: null });
  expect(db.prepare('SELECT payload_hash FROM snapshot WHERE id=?').get(snapshot.id)).toEqual(original);
  restoreSnapshot(db, snapshot.id, 1); expect(readSourceAssets(db).documents).toEqual([source]);
  initializeSchema(db, 'project'); expect(readdirSync(directory).filter(name => name.includes('v6-backup'))).toHaveLength(1);
});
it('v6坐标升级失败回滚schema与版本，保留原来源及快照', () => {
  const { db, source, snapshot } = legacyV6(), pragma = db.pragma.bind(db);
  vi.spyOn(db, 'pragma').mockImplementation((sql, options) => sql === 'foreign_key_check' ? [{ table: 'broken' }] : pragma(sql, options));
  expect(() => initializeSchema(db, 'project')).toThrow(/升级失败/); vi.restoreAllMocks();
  expect(db.pragma('user_version', { simple: true })).toBe(6);
  expect(db.pragma('table_info(source_segment)')).toHaveLength(6);
  expect(readSourceAssets(db).documents).toEqual([source]); expect(db.prepare('SELECT id FROM snapshot').get()).toEqual({ id: snapshot.id });
});
it('v6坐标升级备份失败时不追加任何列', () => {
  const { db, source } = legacyV6(), prepare = db.prepare.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation(sql => { if (sql === 'VACUUM INTO ?') throw new Error('磁盘空间不足'); return prepare(sql); });
  expect(() => initializeSchema(db, 'project')).toThrow(/备份未成功/); vi.restoreAllMocks();
  expect(db.pragma('user_version', { simple: true })).toBe(6); expect(db.pragma('table_info(source_segment)')).toHaveLength(6);
  expect(readSourceAssets(db).documents).toEqual([source]);
});
it.each(['extra', 'partial', 'negative', 'non-object'])('快照来源坐标%s篡改即使重新签名也拒绝', mode => {
  const { db } = legacySourceFixture(5); initializeSchema(db, 'project');
  const source = freezeSource({ kind: 'txt', title: '坐标素材', rawBytes: Buffer.from('原文'), segments: [{ text: '原文', chapterIndex: 2, paragraphIndex: 1 }] });
  db.transaction(() => commitSourceAssets(db, source, [], []))(); const snapshot = createSnapshot(db, '有坐标');
  const row = db.prepare('SELECT payload_json FROM snapshot WHERE id=?').get(snapshot.id) as { payload_json: string };
  const payload = JSON.parse(row.payload_json), segment = payload.source_segment[0];
  if (mode === 'extra') segment.unknown = '不允许';
  if (mode === 'partial') delete segment.paragraph_index;
  if (mode === 'negative') segment.chapter_index = -1;
  if (mode === 'non-object') payload.source_segment[0] = null;
  const text = JSON.stringify(payload); db.prepare('UPDATE snapshot SET payload_json=?,payload_hash=? WHERE id=?').run(text, createHash('sha256').update(text).digest('hex'), snapshot.id);
  expect(() => previewSnapshot(db, snapshot.id)).toThrow();
  expect(db.prepare('SELECT revision FROM work_meta').get()).toEqual({ revision: 1 });
});
