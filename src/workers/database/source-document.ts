import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { frozenSourceDocumentSchema, type FrozenSourceDocument } from '../../shared/source-document';
import { knowledgeSourceLinkSchema, learningAnnotationPayloadSchema, learningAnnotationSchema,
  sourceAssetsSchema, type KnowledgeSourceLink, type LearningAnnotation, type SourceAssets } from '../../shared/source-assets';
import { RepositoryError } from './errors';
import { sourceCaptureSchema } from '../../shared/source-capture';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
function validateSource(value: FrozenSourceDocument): FrozenSourceDocument {
  const source = frozenSourceDocumentSchema.parse(value);
  if (sha(JSON.stringify(source.segments.map(segment => segment.text))) !== source.bodyHash
    || source.segments.some(segment => sha(segment.text) !== segment.textHash))
    throw new RepositoryError('INVALID_INPUT', '冻结来源正文哈希不匹配。');
  return source;
}

interface DocumentRow { id: string; kind: string; hash_version: number; original_url: string | null; final_url: string | null; title: string; fetched_at: string | null; raw_hash: string; body_hash: string }
interface SegmentRow { id: string; ordinal: number; chapter_title: string; text: string; text_hash: string; chapter_index?: number | null; paragraph_index?: number | null }
const captureRowSchema = z.object({ source_id: z.uuid(), method: z.enum(['static', 'restricted-browser']),
  captured_at: z.iso.datetime({ offset: true }), rendered_dom_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), policy_version: z.literal(1),
}).strict();
const hasCaptureTable = (db: Database.Database) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_capture'").get();
function sourceCapture(value: unknown) {
  const row = captureRowSchema.parse(value);
  if (row.method === 'static' && row.rendered_dom_hash !== null) throw new Error('静态捕获不能携带渲染 DOM 哈希。');
  return sourceCaptureSchema.parse({ sourceId: row.source_id, captureMethod: row.method, capturedAt: row.captured_at, policyVersion: row.policy_version,
    ...(row.method === 'restricted-browser' ? { renderedDomHash: row.rendered_dom_hash } : {}) });
}
function sourceSegment(segment: SegmentRow) {
  return { id: segment.id, ordinal: segment.ordinal, chapterTitle: segment.chapter_title, text: segment.text, textHash: segment.text_hash,
    ...(segment.chapter_index == null && segment.paragraph_index == null ? {} : { chapterIndex: segment.chapter_index ?? undefined, paragraphIndex: segment.paragraph_index ?? undefined }) };
}
function readDocument(db: Database.Database, row: DocumentRow): FrozenSourceDocument {
  const segments = db.prepare('SELECT * FROM source_segment WHERE source_id=? ORDER BY ordinal').all(row.id) as SegmentRow[];
  const capture = hasCaptureTable(db) ? db.prepare('SELECT * FROM source_capture WHERE source_id=?').get(row.id) : undefined;
  return validateSource({ id: row.id, kind: row.kind as FrozenSourceDocument['kind'], hashVersion: row.hash_version as 1,
    originalUrl: row.original_url, finalUrl: row.final_url, title: row.title, fetchedAt: row.fetched_at, rawHash: row.raw_hash, bodyHash: row.body_hash,
    segments: segments.map(sourceSegment),
    ...(capture ? { capture: sourceCapture(capture) } : {}),
  });
}

/** 在既有审核事务内落库；revision、快照和幂等回执仍由调用方负责。 */
export function commitSourceAssets(db: Database.Database, value: FrozenSourceDocument, linkValues: KnowledgeSourceLink[], annotationValues: LearningAnnotation[]): void {
  if (!db.inTransaction) throw new RepositoryError('INVALID_INPUT', '来源资产必须在作品事务内提交。');
  const source = validateSource(value), links = z.array(knowledgeSourceLinkSchema).max(100).parse(linkValues),
    annotations = z.array(learningAnnotationSchema).max(100).parse(annotationValues);
  const linkKeys = links.map(link => JSON.stringify([link.entryId, link.sourceId, link.segmentId]));
  if (new Set(linkKeys).size !== links.length || new Set(annotations.map(item => item.id)).size !== annotations.length)
    throw new RepositoryError('INVALID_INPUT', '来源关联或学习注释身份重复。');
  const segmentIds = new Set(source.segments.map(segment => segment.id)), entryIds = new Set(links.map(link => link.entryId));
  if (links.some(link => link.sourceId !== source.id || !segmentIds.has(link.segmentId)) || annotations.some(item => !entryIds.has(item.entryId)))
    throw new RepositoryError('INVALID_INPUT', '知识关联或学习注释不属于当前审核来源。');
  for (const entryId of entryIds) {
    const entry = db.prepare('SELECT id FROM knowledge_entry WHERE id=? AND deleted_at IS NULL').get(entryId);
    if (!entry) throw new RepositoryError('NOT_FOUND', '知识条目不存在或已删除。');
  }
  const existing = db.prepare('SELECT * FROM source_document WHERE id=?').get(source.id) as DocumentRow | undefined;
  if (existing && JSON.stringify(readDocument(db, existing)) !== JSON.stringify(source))
    throw new RepositoryError('INVALID_INPUT', '冻结来源身份已用于不同内容。');
  if (!existing) {
    db.prepare('INSERT INTO source_document VALUES(?,?,?,?,?,?,?,?,?)').run(source.id, source.kind, source.hashVersion,
      source.originalUrl, source.finalUrl, source.title, source.fetchedAt, source.rawHash, source.bodyHash);
    const insertSegment = db.prepare('INSERT INTO source_segment VALUES(?,?,?,?,?,?,?,?)');
    for (const segment of source.segments) insertSegment.run(segment.id, source.id, segment.ordinal, segment.chapterTitle, segment.text, segment.textHash, segment.chapterIndex ?? null, segment.paragraphIndex ?? null);
    if (source.capture) db.prepare('INSERT INTO source_capture VALUES(?,?,?,?,?)').run(source.id, source.capture.captureMethod,
      source.capture.capturedAt, source.capture.captureMethod === 'restricted-browser' ? source.capture.renderedDomHash : null, source.capture.policyVersion);
  }
  const insertLink = db.prepare('INSERT INTO knowledge_source VALUES(?,?,?)');
  for (const link of links) insertLink.run(link.entryId, link.sourceId, link.segmentId);
  const insertAnnotation = db.prepare('INSERT INTO learning_annotation VALUES(?,?,?)');
  for (const annotation of annotations) insertAnnotation.run(annotation.id, annotation.entryId,
    JSON.stringify(learningAnnotationPayloadSchema.parse({ technique: annotation.technique, usage: annotation.usage, exercise: annotation.exercise })));
}

/** 归档/快照消费者读取规范资产，损坏JSON或原文哈希不能静默放过。 */
export function readSourceAssets(db: Database.Database, entryId?: string): SourceAssets {
  if(entryId!==undefined) z.uuid().parse(entryId);
  if (hasCaptureTable(db) && db.prepare("SELECT 1 FROM source_capture LEFT JOIN source_document ON source_capture.source_id=source_document.id WHERE source_document.id IS NULL OR source_document.kind<>'web' LIMIT 1").get())
    throw new RepositoryError('INVALID_INPUT', '捕获证据必须属于现有网页来源。');
  const documentRows=entryId===undefined ? db.prepare('SELECT * FROM source_document ORDER BY id').all()
    : db.prepare('SELECT DISTINCT source_document.* FROM source_document JOIN knowledge_source ON knowledge_source.source_id=source_document.id WHERE knowledge_source.entry_id=? ORDER BY source_document.id').all(entryId);
  const documents = (documentRows as DocumentRow[]).map(row => readDocument(db, row));
  const linkRows=entryId===undefined ? db.prepare('SELECT * FROM knowledge_source ORDER BY entry_id,source_id,segment_id').all()
    : db.prepare('SELECT * FROM knowledge_source WHERE entry_id=? ORDER BY source_id,segment_id').all(entryId);
  const links = (linkRows as { entry_id: string; source_id: string; segment_id: string }[])
    .map(row => knowledgeSourceLinkSchema.parse({ entryId: row.entry_id, sourceId: row.source_id, segmentId: row.segment_id }));
  const annotationRows=entryId===undefined ? db.prepare('SELECT * FROM learning_annotation ORDER BY id').all()
    : db.prepare('SELECT * FROM learning_annotation WHERE entry_id=? ORDER BY id').all(entryId);
  const annotations = (annotationRows as { id: string; entry_id: string; payload_json: string }[])
    .map(row => learningAnnotationSchema.parse({ ...learningAnnotationPayloadSchema.parse(JSON.parse(row.payload_json)), id: row.id, entryId: row.entry_id }));
  return sourceAssetsSchema.parse({ documents, links, annotations });
}

/** 快照在触碰当前数据库前核验冻结资产；关系校验不能只依赖恢复后的FK。 */
export function validateSourcePayload(payload: Record<string, unknown[]>): void {
  const documents = payload.source_document as DocumentRow[], segments = payload.source_segment as (SegmentRow & { source_id: string })[];
  const sourceIds = new Set(documents.map(row => row.id)), segmentIds = new Set(segments.map(row => row.id));
  const knowledgeIds = new Set((payload.knowledge_entry as { id: string }[]).map(row => row.id));
  if (sourceIds.size !== documents.length || segmentIds.size !== segments.length || segments.some(row => !sourceIds.has(row.source_id))) throw new Error('快照来源身份或关系无效。');
  const captures = (payload.source_capture ?? []).map(sourceCapture);
  if (new Set(captures.map(capture => capture.sourceId)).size !== captures.length || captures.some(capture => !sourceIds.has(capture.sourceId)))
    throw new Error('快照捕获身份或关系无效。');
  for (const row of documents) validateSource({ id: row.id, kind: row.kind as FrozenSourceDocument['kind'], hashVersion: row.hash_version as 1,
    title: row.title, originalUrl: row.original_url, finalUrl: row.final_url, fetchedAt: row.fetched_at, rawHash: row.raw_hash, bodyHash: row.body_hash,
    segments: segments.filter(segment => segment.source_id === row.id).sort((a, b) => a.ordinal-b.ordinal)
      .map(sourceSegment),
    ...(captures.some(capture => capture.sourceId === row.id) ? { capture: captures.find(capture => capture.sourceId === row.id)! } : {}),
  });
  for (const row of payload.knowledge_source as { entry_id: string; source_id: string; segment_id: string }[]) {
    knowledgeSourceLinkSchema.parse({ entryId: row.entry_id, sourceId: row.source_id, segmentId: row.segment_id });
    if (!knowledgeIds.has(row.entry_id) || !segments.some(segment => segment.id === row.segment_id && segment.source_id === row.source_id)) throw new Error('快照知识来源关系无效。');
  }
  for (const row of payload.learning_annotation as { id: string; entry_id: string; payload_json: string }[]) {
    learningAnnotationSchema.parse({ ...learningAnnotationPayloadSchema.parse(JSON.parse(row.payload_json)), id: row.id, entryId: row.entry_id });
    if (!knowledgeIds.has(row.entry_id)) throw new Error('快照学习注释知识关系无效。');
  }
}

/** 只接受旧固定六列或新固定八列；在内存补NULL，不改历史hash或推测坐标。 */
export function normalizeSourceCoordinates(payload: Record<string, unknown[]>): void {
  const base = ['id', 'source_id', 'ordinal', 'chapter_title', 'text', 'text_hash'];
  payload.source_segment = (payload.source_segment ?? []).map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('来源坐标字段结构无效。');
    const row = value as Record<string, unknown>, names = Object.keys(row);
    const expected = names.length === 6 ? base : [...base, 'chapter_index', 'paragraph_index'];
    if (names.length !== expected.length || expected.some(name => !Object.hasOwn(row, name))) throw new Error('来源坐标字段结构无效。');
    return names.length === 6 ? { ...row, chapter_index: null, paragraph_index: null } : row;
  });
}
