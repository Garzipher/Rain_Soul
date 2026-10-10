import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { validateDocument } from '../../shared/document';
import { rebuildAssetSearch } from './assets-search';
import type { SnapshotSummary, SnapshotPreview } from '../../shared/snapshots';
import { snapshotManuscript } from './snapshot-export';
import { sourceAssetTables } from './source-schema';
import { readSourceAssets, validateSourcePayload, normalizeSourceCoordinates } from './source-document';
export type { SnapshotSummary } from '../../shared/snapshots';

interface SnapshotRow { id: string; title: string; payload_json: string; payload_hash: string }

const tables = [
  'work_meta', 'volume', 'chapter', 'category', 'tag', 'knowledge_entry', 'knowledge_tag',
  'knowledge_history', 'outline_node', 'outline_knowledge', 'foreshadow', 'evidence',
  'style_profile', 'style_default', 'chapter_style', 'asset_history',
] as const;
const learningTables = ['learning_course', 'learning_volume', 'learning_seed'] as const;
const hash = (payload: string) => createHash('sha256').update(payload).digest('hex');
const present = (db: Database.Database, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
const contentTables = (db: Database.Database) => [...tables, ...learningTables.filter(table => present(db, table)), ...sourceAssetTables.filter(table => present(db, table))];

function validTitle(title: string): string {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) throw new Error('快照名称无效。');
  return title.trim();
}

function ensureTable(db: Database.Database, name: string) {
  const found = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!found) throw new Error('当前作品数据库缺少资产表，无法创建快照。');
}

function capture(db: Database.Database): Record<string, unknown[]> {
  for (const table of tables) ensureTable(db, table);
  return Object.fromEntries(contentTables(db).map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
}

function createSnapshotRow(db: Database.Database, title: string, kind: 'manual' | 'safety', sourceSnapshotId: string | null): SnapshotSummary {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const metadata = db.prepare('SELECT revision,deleted_at FROM work_meta').get() as { revision: number; deleted_at: string | null } | undefined;
  if (!metadata || metadata.deleted_at) throw new Error('当前作品不可创建快照。');
  const sourceRevision = metadata.revision;
  const payload = JSON.stringify(capture(db));
  const payloadVersion = sourceAssetTables.every(table => present(db, table)) ? 2 : 1;
  db.prepare('INSERT INTO snapshot(id,title,kind,created_at,source_snapshot_id,payload_json,payload_hash,source_revision,schema_version) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, title, kind, createdAt, sourceSnapshotId, payload, hash(payload), sourceRevision, payloadVersion);
  return { id, title, kind, createdAt, sourceSnapshotId, sourceRevision, schemaVersion: payloadVersion };
}

export function initializeSnapshots(db: Database.Database): void {
  db.exec(`CREATE TABLE snapshot (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('manual','safety')),
    created_at TEXT NOT NULL,
    source_snapshot_id TEXT,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    source_revision INTEGER NOT NULL CHECK(source_revision >= 1),
    schema_version INTEGER NOT NULL CHECK(schema_version >= 1)
  ); CREATE INDEX snapshot_created ON snapshot(created_at DESC, id);`);
}

export function createSnapshot(db: Database.Database, title: string, kind: 'manual' | 'safety' = 'manual', sourceSnapshotId: string | null = null): SnapshotSummary {
  return db.transaction(() => createSnapshotRow(db, validTitle(title), kind, sourceSnapshotId))();
}

export function listSnapshots(db: Database.Database): SnapshotSummary[] {
  return db.prepare('SELECT id,title,kind,created_at AS createdAt,source_snapshot_id AS sourceSnapshotId,source_revision AS sourceRevision,schema_version AS schemaVersion FROM snapshot ORDER BY created_at DESC,id DESC').all() as SnapshotSummary[];
}

function validatePayload(db: Database.Database, payload: Record<string, unknown>, version: number) {
  const names = [...tables, ...learningTables.filter(table => Object.hasOwn(payload ?? {}, table)), ...(version === 2 ? sourceAssetTables : [])];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== names.length) throw new Error('快照内容校验失败。');
  for (const table of names) {
    if (!Array.isArray(payload[table])) throw new Error('快照内容校验失败。');
    if ((learningTables as readonly string[]).includes(table)) continue;
    const columns = db.pragma(`table_info(${table})`) as { name: string }[];
    for (const row of payload[table] as Record<string, unknown>[]) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== columns.length
        || columns.some(column => !Object.hasOwn(row, column.name))
        || Object.values(row).some(value => value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))) throw new Error('快照字段校验失败。');
      if (table === 'chapter') validateDocument(JSON.parse(row.document_json as string));
    }
  }
  validateLearningPayload(payload);
  const meta = (payload.work_meta as { id: string; title: string; deleted_at: string | null }[]);
  const current = db.prepare('SELECT id FROM work_meta').get() as { id: string };
  if (meta.length !== 1 || meta[0].id !== current.id || typeof meta[0].title !== 'string' || !meta[0].title.trim() || meta[0].deleted_at !== null) throw new Error('快照作品身份校验失败。');
}

/** 历史可选跟踪表按旧固定结构核验，不依赖当前库是否安装教材。 */
export function validateLearningPayload(payload: Record<string, unknown>) {
  const schemas = {
    learning_course: z.object({ course_key: z.string().min(1) }).strict(),
    learning_volume: z.object({ key: z.string().min(1), volume_id: z.uuid() }).strict(),
    learning_seed: z.object({ key: z.string().min(1), chapter_id: z.uuid() }).strict(),
  };
  for (const table of learningTables) if (Object.hasOwn(payload, table)) z.array(schemas[table]).parse(payload[table]);
}

/** 原hash先校验，旧固定表集合校验后仅在内存补空新关系，不改历史hash。 */
export function readCompatiblePayload(db: Database.Database, row: SnapshotRow & { schema_version: number }): Record<string, unknown[]> {
  if (row.schema_version !== 1 && row.schema_version !== 2) throw new Error('快照格式版本不支持，未修改当前作品。');
  if (hash(row.payload_json) !== row.payload_hash) throw new Error('快照内容校验失败。');
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(row.payload_json) as Record<string, unknown>; } catch { throw new Error('快照内容校验失败。'); }
  if (row.schema_version === 2 && Array.isArray(payload?.source_segment)) normalizeSourceCoordinates(payload as Record<string, unknown[]>);
  validatePayload(db, payload, row.schema_version);
  if (row.schema_version === 2) validateSourcePayload(payload as Record<string, unknown[]>);
  for (const table of contentTables(db)) if (!Object.hasOwn(payload, table)) payload[table] = [];
  return payload as Record<string, unknown[]>;
}

function readSnapshotPayload(db: Database.Database, snapshotId: string): Record<string, unknown> {
  const row = db.prepare('SELECT * FROM snapshot WHERE id=?').get(snapshotId) as (SnapshotRow & { schema_version: number }) | undefined;
  if (!row) throw new Error('快照不存在。');
  return readCompatiblePayload(db, row);
}

export function freezeSnapshotExport(db: Database.Database, snapshotId: string) {
  return db.transaction(() => snapshotManuscript(readSnapshotPayload(db, snapshotId)))();
}

export function previewSnapshot(db: Database.Database, snapshotId: string): SnapshotPreview {
  const payload = readSnapshotPayload(db, snapshotId);
  const chapters = (payload.chapter as { id: string; title: string; word_count: number; deleted_at: string | null }[])
    .filter(chapter => !chapter.deleted_at).map(chapter => ({ id: chapter.id, title: chapter.title, wordCount: chapter.word_count }));
  const activeCount = (table: string) => (payload[table] as { deleted_at: string | null }[]).filter(item => !item.deleted_at).length;
  const summary = db.prepare('SELECT id,title,kind,created_at AS createdAt,source_snapshot_id AS sourceSnapshotId,source_revision AS sourceRevision,schema_version AS schemaVersion FROM snapshot WHERE id=?').get(snapshotId) as SnapshotSummary;
  return { summary, title: (payload.work_meta as { title: string }[])[0].title, chapters,
    chapterCount: chapters.length, volumeCount: activeCount('volume'), wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    knowledgeCount: activeCount('knowledge_entry'), foreshadowCount: activeCount('foreshadow') };
}

function restoreRows(db: Database.Database, payload: Record<string, unknown>) {
  const names = contentTables(db);
  // 同一事务中替换完整关系图，直到重新插入全部稳定 ID 后才检查外键。
  db.pragma('defer_foreign_keys=ON');
  for (const table of [...names].reverse().filter(table => table !== 'work_meta')) db.exec(`DELETE FROM ${table}`);
  for (const table of names.filter(table => table !== 'work_meta')) {
    const rows = payload[table] as Record<string, unknown>[];
    for (const row of rows) {
      const columns = Object.keys(row);
      const names = columns.map(column => `"${column.replaceAll('"', '""')}"`).join(',');
      const values = columns.map(() => '?').join(',');
      db.prepare(`INSERT INTO ${table} (${names}) VALUES (${values})`).run(...columns.map(column => row[column]));
    }
  }
  const meta = (payload.work_meta as Record<string, unknown>[])[0];
  db.prepare('UPDATE work_meta SET title=?, deleted_at=? WHERE id=?').run(meta.title, meta.deleted_at ?? null, meta.id);
  rebuildAssetSearch(db);
  if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('快照关系校验失败。');
  if (sourceAssetTables.every(table => present(db, table))) readSourceAssets(db);
}

export function restoreSnapshot(db: Database.Database, snapshotId: string, expectedRevision: number): { restored: SnapshotSummary; safety: SnapshotSummary } {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('作品版本无效。');
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM snapshot WHERE id=?').get(snapshotId) as (SnapshotRow & { schema_version: number }) | undefined;
    if (!row) throw new Error('快照不存在。');
    const current = db.prepare('SELECT revision,deleted_at FROM work_meta').get() as { revision: number; deleted_at: string | null } | undefined;
    if (!current || current.deleted_at || current.revision !== expectedRevision) throw new Error('作品版本已变化，请重新读取后恢复。');
    const payload = readCompatiblePayload(db, row);
    const safety = createSnapshotRow(db, `恢复前：${row.title}`.slice(0, 200), 'safety', row.id);
    restoreRows(db, payload);
    db.prepare('UPDATE work_meta SET revision=revision+1,updated_at=?').run(new Date().toISOString());
    const restored = createSnapshotRow(db, `恢复：${row.title}`.slice(0, 200), 'safety', row.id);
    return { restored, safety };
  }).immediate();
}
