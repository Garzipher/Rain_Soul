import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';
import { exportProjectDatabase, importArchivedProject } from '../../src/workers/database/archive-project';
import { createSnapshot, restoreSnapshot } from '../../src/workers/database/snapshots';
import { commitSourceAssets, readSourceAssets } from '../../src/workers/database/source-document';
import { sourceAssetTables } from '../../src/workers/database/source-schema';
import { freezeSource } from '../../src/main/freeze-source';
import type { ParsedProjectArchive } from '../../src/shared/archive';

const dirs: string[] = [], dbs: Database.Database[] = [];
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
afterEach(() => { for (const db of dbs.splice(0)) if (db.open) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'rainsoul-source-archive-')); dirs.push(dir);
  const repository = new WorkRepository(dir), work = repository.createWork('来源测试'); repository.close();
  const projects = join(dir, 'Projects'), db = new Database(join(projects, work.id, 'project.sqlite')); dbs.push(db); db.pragma('foreign_keys=ON');
  return { dir, db, work, projects };
}
function archive(workId: string, bytes: Buffer, version = 6): ParsedProjectArchive { return { manifest: { formatVersion: 1, schemaVersion: version, projectId: workId, databaseSha256: hash(bytes) }, database: bytes }; }
function mutate(bytes: Buffer, callback: (db: Database.Database) => void): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'rainsoul-source-portable-')); dirs.push(dir); const path = join(dir, 'input.sqlite'); writeFileSync(path, bytes);
  const db = new Database(path); try { callback(db); } finally { db.close(); } return readFileSync(path);
}
it('payload2来源/学习注释归档新作品映射身份，恢复来源快照仍保留当前会话', async () => {
  const { db, work, projects } = setup(), entryId = randomUUID(), annotationId = randomUUID();
  const category = db.prepare('SELECT id FROM category LIMIT 1').get() as { id: string };
  const source = freezeSource({ kind: 'web', title: '雨夜', rawBytes: Buffer.from('原页'), originalUrl: 'https://example.com/page', finalUrl: 'https://example.com/page', fetchedAt: '2026-10-10T01:00:00Z', segments: [{ text: '雨落灯下' }] });
  db.transaction(() => {
    db.prepare('INSERT INTO knowledge_entry VALUES(?,?,?,?,NULL,1,NULL)').run(entryId, '雨落灯下', '雨夜', category.id);
    commitSourceAssets(db, source, [{ entryId, sourceId: source.id, segmentId: source.segments[0].id }], [{ id: annotationId, entryId, technique: '视听结合', usage: '夜景', exercise: '仿写' }]);
  })();
  const snapshot = createSnapshot(db, '有来源'); expect(snapshot.schemaVersion).toBe(2);
  const id = randomUUID(); importArchivedProject(projects, archive(work.id, await exportProjectDatabase(projects, work.id, 1)), id);
  const imported = new Database(join(projects, id, 'project.sqlite')); dbs.push(imported); imported.pragma('foreign_keys=ON');
  const assets = readSourceAssets(imported);
  expect(assets.documents[0].id).not.toBe(source.id); expect(assets.documents[0].segments[0].id).not.toBe(source.segments[0].id);
  expect(assets.annotations[0]).toMatchObject({ entryId, technique: '视听结合' }); expect(assets.annotations[0].id).not.toBe(annotationId);
  const conversationId = randomUUID(); imported.prepare('INSERT INTO conversation VALUES(?,?,1,?,?,?,NULL)').run(conversationId, '保留当前会话', '', '2026-10-10T01:00:00Z', '2026-10-10T01:00:00Z');
  restoreSnapshot(imported, snapshot.id, 1); expect(readSourceAssets(imported)).toEqual(assets);
  expect(imported.prepare('SELECT id FROM conversation').get()).toEqual({ id: conversationId });
});
it.each([4, 5] as const)('旧v%s便携归档带payload1可导入v6并恢复后再归档', async version => {
  const { db, work, projects } = setup(), snapshot = createSnapshot(db, '旧版本');
  const bytes = mutate(await exportProjectDatabase(projects, work.id, 1), portable => {
    for (const row of portable.prepare('SELECT * FROM snapshot').all() as { id: string; payload_json: string }[]) {
      const payload = JSON.parse(row.payload_json); for (const table of sourceAssetTables) delete payload[table]; const text = JSON.stringify(payload);
      portable.prepare('UPDATE snapshot SET payload_json=?,payload_hash=?,schema_version=1 WHERE id=?').run(text, hash(text), row.id);
    }
    for (const table of [...sourceAssetTables].reverse()) portable.exec(`DROP TABLE ${table}`);
    if (version === 4) portable.exec('DROP TABLE conversation_message; DROP TABLE conversation;');
    portable.pragma(`user_version=${version}`);
  });
  const id = randomUUID(); importArchivedProject(projects, archive(work.id, bytes, version), id);
  const imported = new Database(join(projects, id, 'project.sqlite')); dbs.push(imported); imported.pragma('foreign_keys=ON');
  expect(imported.pragma('user_version', { simple: true })).toBe(6);
  expect(restoreSnapshot(imported, snapshot.id, 1).restored.schemaVersion).toBe(2);
  expect(readSourceAssets(imported).documents).toEqual([]);
  const secondId = randomUUID(); importArchivedProject(projects, archive(id, await exportProjectDatabase(projects, id, 2)), secondId);
});
it('归档来源哈希损坏拒绝，既有作品数据不变', async () => {
  const { db, work, projects } = setup(), source = freezeSource({ kind: 'paste', title: '原文', rawBytes: Buffer.from('原文'), segments: [{ text: '原文' }] });
  db.transaction(() => commitSourceAssets(db, source, [], []))();
  const bytes = mutate(await exportProjectDatabase(projects, work.id, 1), portable => portable.prepare('UPDATE source_segment SET text=?').run('被篡改'));
  expect(() => importArchivedProject(projects, archive(work.id, bytes), randomUUID())).toThrow(/哈希|hash/);
  expect(readSourceAssets(db).documents[0]).toEqual(source);
});
