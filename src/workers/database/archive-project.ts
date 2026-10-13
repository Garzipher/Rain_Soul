import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { ParsedProjectArchive } from '../../shared/archive';
import { archiveManifestSchema } from '../../shared/archive';
import { countDocumentWords, validateDocument } from '../../shared/document';
import { initializeSchema } from './schema';
import { readAssets } from './assets';
import { rebuildAssetSearch } from './assets-search';
import { sourceAssetTables, legacySourceAssetTables, sourceSchema as legacySourceSchema } from './source-schema';
import { readSourceAssets, normalizeSourceCoordinates } from './source-document';
import { validateLearningPayload } from './snapshots';

const oldTables = ['work_meta', 'volume', 'chapter', 'category', 'tag', 'knowledge_entry', 'knowledge_tag', 'knowledge_history', 'outline_node', 'outline_knowledge', 'foreshadow', 'evidence', 'style_profile', 'style_default', 'chapter_style', 'asset_history'] as const;
const tables = [...oldTables, ...sourceAssetTables];
const conversationTables = ['conversation', 'conversation_message'] as const;
type Row = Record<string, string | number | null>;
type Payload = Record<string, Row[]>;
interface SchemaRow { type: string; name: string; sql: string | null }
interface Column { name: string; type: string; notnull: number; pk: number; hidden: number }
const learning = ['learning_course', 'learning_volume', 'learning_seed'];
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const uuid = (value: unknown) => { if (!z.uuid().safeParse(value).success) throw new Error('归档标识无效。'); return value as string; };
const columns = (db: Database.Database, table: string) => db.pragma(`table_xinfo(${table})`) as Column[];
const schema = (db: Database.Database) => db.prepare('SELECT type,name,sql FROM sqlite_master').all() as SchemaRow[];
const normalize = (sql: string | null) => sql?.replace(/\s+/g, ' ').trim();
function safePath(path: string) {
  let current = resolve(path);
  while (true) { if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('归档路径不允许符号链接。'); const parent = dirname(current); if (parent === current) break; current = parent; }
}
function trustedDb(path = ':memory:', portable = false, schemaVersion = 8): Database.Database {
  const db = new Database(path);
  try {
    initializeSchema(db, 'project');
    if (portable) db.exec('DROP TRIGGER search_insert; DROP TRIGGER search_delete; DROP TRIGGER search_update; DROP TABLE search_fts; DROP TABLE search_document; DROP TABLE operation_log; DROP TABLE conversation_operation;');
    if (schemaVersion < 6) { for (const table of [...sourceAssetTables].reverse()) db.exec(`DROP TABLE ${table}`); db.pragma(`user_version=${schemaVersion}`); }
    if (schemaVersion === 6) { for (const table of [...sourceAssetTables].reverse()) db.exec(`DROP TABLE ${table}`); db.exec(legacySourceSchema); db.pragma('user_version=6'); }
    if (schemaVersion === 7) { db.exec('DROP TABLE source_capture'); db.pragma('user_version=7'); }
    if (schemaVersion === 4) {
      db.exec('DROP TABLE conversation_message; DROP TABLE conversation;'); db.pragma('user_version=4');
    }
    return db;
  } catch (error) { db.close(); throw error; }
}
function checkSchema(source: Database.Database, reference: Database.Database, portable: boolean) {
  const expected = new Map(schema(reference).map(row => [row.name, row]));
  const rows = schema(source);
  if (portable && rows.some(row => !expected.has(row.name) || row.type !== expected.get(row.name)!.type || normalize(row.sql) !== normalize(expected.get(row.name)!.sql))) throw new Error('归档 schema 包含未知结构、触发器或视图。');
  for (const table of [...tables.filter(table => expected.has(table)), 'snapshot', ...conversationTables.filter(table => expected.has(table))]) {
    const row = rows.find(item => item.name === table);
    if (!row || row.type !== 'table' || /CREATE\s+VIRTUAL/i.test(row.sql ?? '')) throw new Error('归档业务表结构缺失或不安全。');
    const wanted = columns(reference, table), actual = columns(source, table);
    if (actual.length !== wanted.length || actual.some((column, index) => column.name !== wanted[index].name || column.type !== wanted[index].type || column.hidden !== 0)) throw new Error('归档业务表结构不匹配。');
  }
}
function assertIntegrity(db: Database.Database) {
  if (db.pragma('integrity_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('归档 SQLite 完整性或外键校验失败。');
}
function checkRow(db: Database.Database, table: string, row: Row) {
  const fields = columns(db, table);
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== fields.length) throw new Error('归档字段结构校验失败。');
  for (const column of fields) {
    const value = row[column.name];
    if (!Object.hasOwn(row, column.name) || (value === null && (column.notnull || column.pk))) throw new Error('归档必填字段缺失。');
    if (value === null) continue;
    if ((column.type === 'TEXT' && typeof value !== 'string') || (column.type === 'INTEGER' && (!Number.isSafeInteger(value) || typeof value !== 'number'))) throw new Error('归档字段类型无效。');
    if (column.name === 'id' || column.name.endsWith('_id')) uuid(value);
    if (['title', 'name', 'body'].includes(column.name) && typeof value === 'string' && !value.trim()) throw new Error('归档名称或内容为空。');
    if (['revision', 'source_revision', 'version', 'word_count', 'sort_order'].includes(column.name) && (typeof value !== 'number' || value < (column.name.includes('revision') || column.name === 'version' ? 1 : 0))) throw new Error('归档版本或排序无效。');
  }
}
const sourceSchema = z.object({ chapterId: z.uuid(), chapterTitle: z.string(), paragraphId: z.uuid().nullable(), excerpt: z.string(), revision: z.number().int().positive() }).strict();
const originSchema = z.object({ workId: z.uuid(), entryId: z.uuid(), sourceRevision: z.number().int().positive(), workTitle: z.string() }).strict();
const styleSchema = z.object({ narrativePerson: z.string(), pace: z.string(), prohibited: z.array(z.string()), referenceWorks: z.array(z.string()) }).strict();
function checkGraph(db: Database.Database, projectId: string) {
  assertIntegrity(db);
  const metadata = db.prepare('SELECT * FROM work_meta').all() as Row[];
  if (metadata.length !== 1 || metadata[0].id !== projectId || metadata[0].deleted_at !== null) throw new Error('归档作品身份无效。');
  const paragraphs = new Set<string>(), bookmarks = new Set<string>();
  const assets = readAssets(db);
  readSourceAssets(db);
  const reserved = assets.categories.filter(item => item.systemKey === 'uncategorized');
  if (reserved.length !== 1 || reserved[0].deletedAt || reserved[0].parentId || reserved[0].name !== '未分类'
    || assets.categories.some(item => item.systemKey !== null && item.systemKey !== 'uncategorized')) {
    throw new Error('归档必须保留唯一、有效且处于根层的未分类类别。');
  }
  const knowledge = new Set(assets.knowledge.map(item => item.id)), foreshadows = new Set(assets.foreshadows.map(item => item.id));
  for (const row of db.prepare('SELECT * FROM chapter').all() as Row[]) {
    const document = validateDocument(JSON.parse(row.document_json as string));
    if (row.word_count !== countDocumentWords(document)) throw new Error('归档字数与正文不一致。');
    for (const paragraph of document.content) {
      if (paragraphs.has(paragraph.attrs.id)) throw new Error('归档段落 ID 重复。'); paragraphs.add(paragraph.attrs.id);
      for (const node of paragraph.content ?? []) if (node.type === 'bookmark') {
        if (bookmarks.has(node.attrs.id) || !(node.attrs.kind === 'knowledge' ? knowledge : foreshadows).has(node.attrs.targetId)) throw new Error('归档书签重复或目标不存在。'); bookmarks.add(node.attrs.id);
      }
    }
  }
  const cycle = (items: { id: string; parentId: string | null }[]) => {
    const map = new Map(items.map(item => [item.id, item.parentId]));
    for (const item of items) { let current: string | null = item.id; const seen = new Set<string>(); while (current !== null) { if (seen.has(current) || !map.has(current)) throw new Error('归档层级关系成环或悬空。'); seen.add(current); current = map.get(current)!; } }
  };
  cycle(assets.categories); cycle(assets.outlines); cycle(assets.evidence.map(item => ({ id: item.id, parentId: item.supersedesId })));
  const outlines = new Map(assets.outlines.map(item => [item.id, item]));
  for (const item of assets.outlines) {
    const parent = item.parentId ? outlines.get(item.parentId) : null;
    if ((item.type === 'volume' && parent) || (item.type === 'chapter' && parent && parent.type !== 'volume') || (item.type === 'detail' && parent?.type !== 'chapter')) throw new Error('归档剧情树层级无效。');
  }
  for (const item of assets.knowledge) if (item.origin !== null) originSchema.parse(item.origin);
  for (const item of assets.evidence) sourceSchema.parse(item.originalSource);
  for (const item of assets.styleProfiles) styleSchema.parse(item.payload);
  for (const row of db.prepare('SELECT * FROM asset_history').all() as Row[]) {
    if (!['outline_node', 'foreshadow', 'evidence', 'category', 'tag', 'knowledge_entry', 'chapter'].includes(row.entity_kind as string)) throw new Error('归档资产历史类型无效。');
    const payload = JSON.parse(row.payload_json as string) as Row & { tag_ids?: unknown; knowledge_ids?: unknown };
    if (payload.tag_ids !== undefined) { z.array(z.object({ tag_id: z.uuid() }).strict()).parse(payload.tag_ids); delete payload.tag_ids; }
    if (payload.knowledge_ids !== undefined) { z.array(z.object({ knowledge_id: z.uuid() }).strict()).parse(payload.knowledge_ids); delete payload.knowledge_ids; }
    checkRow(db, row.entity_kind as string, payload);
    if (payload.id !== row.entity_id) throw new Error('归档资产历史身份不一致。');
    if (row.entity_kind === 'chapter') validateDocument(JSON.parse(payload.document_json as string));
  }
}
function readRows(db: Database.Database): Payload { return Object.fromEntries(tables.map(table => [table,
  db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) ? db.prepare(`SELECT * FROM ${table}`).all() as Row[] : []])); }
function insertRows(db: Database.Database, payload: Payload) {
  if (Object.keys(payload).length !== tables.length || tables.some(table => !Array.isArray(payload[table]))) throw new Error('归档正文/快照表集合无效。');
  db.pragma('defer_foreign_keys=ON');
  for (const table of [...tables].reverse()) db.exec(`DELETE FROM ${table}`);
  for (const table of tables) {
    const fields = columns(db, table).map(column => column.name);
    const insert = db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`);
    for (const row of payload[table]) { checkRow(db, table, row); insert.run(...fields.map(field => row[field])); }
  }
}
type SourceIdentityMap = Map<string, string>;
function remapSources(payload: Payload, identities: SourceIdentityMap) {
  const mapped = (id: string | number | null) => { const key = String(id); if (!identities.has(key)) identities.set(key, randomUUID()); return identities.get(key)!; };
  for (const row of payload.source_document) row.id = mapped(row.id);
  for (const row of payload.source_capture) row.source_id = mapped(row.source_id);
  for (const row of payload.source_segment) { row.id = mapped(row.id); row.source_id = mapped(row.source_id); }
  for (const row of payload.knowledge_source) { row.source_id = mapped(row.source_id); row.segment_id = mapped(row.segment_id); }
  for (const row of payload.learning_annotation) row.id = mapped(row.id);
}
function copySnapshots(source: Database.Database, target: Database.Database, oldId: string, newId: string, identities: SourceIdentityMap = new Map()) {
  const rows = source.prepare('SELECT * FROM snapshot').all() as Row[];
  const ids = new Set(rows.map(row => row.id));
  const insert = target.prepare('INSERT INTO snapshot VALUES(?,?,?,?,?,?,?,?,?)');
  for (const row of rows) {
    checkRow(target, 'snapshot', row);
    if (![1, 2, 3].includes(row.schema_version as number) || hash(row.payload_json as string) !== row.payload_hash || (row.source_snapshot_id !== null && !ids.has(row.source_snapshot_id))) throw new Error('归档快照版本、来源或 hash 校验失败。');
    let payload: Payload;
    try { payload = JSON.parse(row.payload_json as string) as Payload; } catch { throw new Error('归档快照格式无效。'); }
    const allowed = row.schema_version === 1 ? oldTables : row.schema_version === 2 ? [...oldTables, ...legacySourceAssetTables] : tables;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => ![...allowed, ...learning].includes(key))
      || allowed.some(table => !Array.isArray(payload[table]))) throw new Error('归档快照表集合无效。');
    validateLearningPayload(payload);
    for (const table of learning) delete payload[table];
    for (const table of sourceAssetTables) if (!Object.hasOwn(payload, table)) payload[table] = [];
    if (row.schema_version === 2) normalizeSourceCoordinates(payload);
    const check = trustedDb();
    try { check.transaction(() => { insertRows(check, payload); checkGraph(check, oldId); })(); }
    catch (error) { throw new Error(`归档快照关系校验失败：${error instanceof Error ? error.message : '无效内容'}`, { cause: error }); }
    finally { check.close(); }
    payload.work_meta[0].id = newId;
    if (oldId !== newId) remapSources(payload, identities);
    if (row.schema_version === 1) for (const table of sourceAssetTables) delete payload[table];
    if (row.schema_version === 2) delete payload.source_capture;
    const rewritten = JSON.stringify(payload);
    insert.run(row.id, row.title, row.kind, row.created_at, row.source_snapshot_id, rewritten, hash(rewritten), row.source_revision, row.schema_version);
  }
}

/** 会话随归档复制，但独立于正文快照；操作回执不进入便携数据。 */
function copyConversations(source: Database.Database, target: Database.Database, schemaVersion: number) {
  if (schemaVersion === 4) return;
  const date = z.iso.datetime();
  for (const table of conversationTables) {
    const fields = columns(target, table).map(column => column.name);
    const insert = target.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`);
    for (const row of source.prepare(`SELECT * FROM ${table}`).all() as Row[]) {
      checkRow(target, table, row); date.parse(row.created_at);
      if (table === 'conversation') {
        z.string().max(200).parse(row.title); z.string().max(200000).parse(row.draft);
        date.parse(row.updated_at); if (row.deleted_at !== null) date.parse(row.deleted_at);
      } else {
        z.enum(['user', 'assistant']).parse(row.role); z.string().min(1).max(200000).refine(value => !!value.trim()).parse(row.content);
        if (row.request_hash !== null) z.string().regex(/^[a-f0-9]{64}$/).parse(row.request_hash);
      }
      insert.run(...fields.map(field => row[field]));
    }
  }
}

/** VACUUM INTO 读取已提交 WAL；再重建纯作品库，避免空闲页残留旧凭据。 */
export async function exportProjectDatabase(projects: string, workId: string, expectedRevision: number): Promise<Buffer> {
  uuid(workId); if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('作品版本无效。');
  const file = join(projects, workId, 'project.sqlite'); safePath(file);
  for (const suffix of ['-wal', '-shm', '-journal']) safePath(`${file}${suffix}`);
  const temporary = mkdtempSync(join(tmpdir(), 'rainsoul-archive-export-'));
  let source: Database.Database | undefined, copy: Database.Database | undefined, clean: Database.Database | undefined;
  try {
    source = new Database(file, { readonly: true, fileMustExist: true }); source.pragma('trusted_schema=OFF');
    source.prepare('VACUUM INTO ?').run(join(temporary, 'source.sqlite'));
    copy = new Database(join(temporary, 'source.sqlite'), { readonly: true }); copy.pragma('trusted_schema=OFF');
    if (copy.pragma('user_version', { simple: true }) !== 8) throw new Error('归档 schema 版本不支持。');
    clean = trustedDb(join(temporary, 'portable.sqlite'), true); checkSchema(copy, clean, false);
    const payload = readRows(copy);
    if (payload.work_meta.length !== 1 || payload.work_meta[0].revision !== expectedRevision) throw new Error('作品版本已变化。');
    const destination = clean;
    destination.transaction(() => { insertRows(destination, payload); checkGraph(destination, workId); copySnapshots(copy!, destination, workId, workId); copyConversations(copy!, destination, 8); assertIntegrity(destination); })();
    destination.pragma('wal_checkpoint(TRUNCATE)'); destination.close(); clean = undefined;
    return readFileSync(join(temporary, 'portable.sqlite'));
  } finally { clean?.close(); copy?.close(); source?.close(); rmSync(temporary, { recursive: true, force: true }); }
}

/** 校验后写全新暂存库，原作品不覆盖；operationId兼任新作品ID和重放键。 */
export function importArchivedProject(projects: string, input: ParsedProjectArchive, operationId: string): string {
  const id = uuid(operationId), manifest = archiveManifestSchema.parse(input.manifest);
  if (![4, 5, 6, 7, 8].includes(manifest.schemaVersion) || input.database.length > 256 * 1024 * 1024 || hash(input.database) !== manifest.databaseSha256) throw new Error('归档 hash 或 schema 版本无效。');
  const receiptHash = hash(JSON.stringify(manifest));
  const destination = join(projects, id); safePath(destination);
  if (existsSync(destination)) {
    const file = join(destination, 'project.sqlite'); safePath(file);
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_receipt'").get();
      const row = table ? db.prepare('SELECT request_hash FROM import_receipt').get() as Row | undefined : undefined;
      if (!row || row.request_hash !== receiptHash) throw new Error('归档导入操作标识已用于不同内容。');
      return id;
    } finally { db.close(); }
  }
  mkdirSync(projects, { recursive: true });
  const staging = join(projects, `.archiving-${randomUUID()}`); mkdirSync(staging);
  let source: Database.Database | undefined, target: Database.Database | undefined, reference: Database.Database | undefined;
  try {
    writeFileSync(join(staging, 'incoming.sqlite'), input.database, { flag: 'wx' });
    source = new Database(join(staging, 'incoming.sqlite'), { readonly: true, fileMustExist: true }); source.pragma('trusted_schema=OFF'); source.pragma('query_only=ON');
    if (source.pragma('user_version', { simple: true }) !== manifest.schemaVersion) throw new Error('归档 schema 与清单不一致。');
    reference = trustedDb(':memory:', true, manifest.schemaVersion); checkSchema(source, reference, true); assertIntegrity(source);
    target = trustedDb(join(staging, 'project.sqlite'));
    const payload = readRows(source);
    if (manifest.schemaVersion === 6) normalizeSourceCoordinates(payload);
    const db = target;
    const identities: SourceIdentityMap = new Map();
    db.transaction(() => {
      insertRows(db, payload); checkGraph(db, manifest.projectId);
      remapSources(payload, identities); insertRows(db, payload);
      db.prepare('UPDATE work_meta SET id=?').run(id);
      copySnapshots(source!, db, manifest.projectId, id, identities);
      copyConversations(source!, db, manifest.schemaVersion);
      db.exec('CREATE TABLE import_receipt(request_hash TEXT NOT NULL)'); db.prepare('INSERT INTO import_receipt VALUES(?)').run(receiptHash);
      rebuildAssetSearch(db); assertIntegrity(db);
    })();
    db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); target = undefined;
    source.close(); source = undefined; rmSync(join(staging, 'incoming.sqlite'));
    renameSync(staging, destination); return id;
  } catch (error) { target?.close(); source?.close(); rmSync(staging, { recursive: true, force: true }); throw error; }
  finally { reference?.close(); }
}
