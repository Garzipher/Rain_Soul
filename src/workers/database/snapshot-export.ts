import { z } from 'zod';
import { validateDocument } from '../../shared/document';
import type { ExportManuscript } from '../../shared/manuscript';
import type { Evidence } from '../../shared/assets';

const identity = z.uuid(), nullableId = identity.nullable(), deleted = z.string().nullable();
const order = z.number().int();
const chapterSchema = z.object({ id: identity, title: z.string(), volume_id: nullableId, sort_order: order, deleted_at: deleted, document_json: z.string() });
const volumeSchema = z.object({ id: identity, title: z.string(), sort_order: order, deleted_at: deleted });
const knowledgeSchema = z.object({ id: identity, body: z.string(), source: z.string(), deleted_at: deleted });
const foreshadowSchema = z.object({ id: identity, name: z.string(), status: z.enum(['未埋设', '已埋设', '已触发', '已回收', '废弃']), description: z.string(), outline_id: nullableId, deleted_at: deleted });
const sourceSchema = z.object({ chapterId: identity, chapterTitle: z.string(), paragraphId: nullableId, excerpt: z.string(), revision: z.number().int().positive() }).strict();
const evidenceSchema = z.object({ id: identity, foreshadow_id: identity, kind: z.enum(['埋设', '触发', '回收']), chapter_id: identity,
  paragraph_id: nullableId, excerpt: z.string(), source_revision: z.number().int().positive(), original_source: z.string(), supersedes_id: nullableId, deleted_at: deleted });

/** 只映射已校验的快照数据；不访问当前正文、恢复数据库或创建历史。 */
export function snapshotManuscript(payload: Record<string, unknown>): ExportManuscript {
  const meta = z.array(z.object({ title: z.string().min(1), revision: z.number().int().positive() })).length(1).parse(payload.work_meta)[0];
  const volumes = z.array(volumeSchema).parse(payload.volume).filter(item => !item.deleted_at).sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const rows = z.array(chapterSchema).parse(payload.chapter);
  const chapters = rows.filter(item => !item.deleted_at).sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    .map(row => ({ id: row.id, title: row.title, volumeId: row.volume_id, document: validateDocument(JSON.parse(row.document_json)) }));
  if (chapters.some(chapter => chapter.volumeId && !volumes.some(volume => volume.id === chapter.volumeId))) throw new Error('快照卷章关联校验失败。');
  const knowledge = z.array(knowledgeSchema).parse(payload.knowledge_entry).map(row => ({ id: row.id, body: row.body, source: row.source, deletedAt: row.deleted_at }));
  const foreshadows = z.array(foreshadowSchema).parse(payload.foreshadow).map(row => ({ id: row.id, name: row.name, status: row.status, description: row.description, outlineId: row.outline_id, deletedAt: row.deleted_at }));
  const evidenceRows = z.array(evidenceSchema).parse(payload.evidence);
  const evidence: Evidence[] = evidenceRows.map(row => {
    const chapter = chapters.find(item => item.id === row.chapter_id);
    const invalidReason = !chapter ? '来源章节已删除或不存在' : row.paragraph_id !== null && !chapter.document.content.some(paragraph => paragraph.attrs.id === row.paragraph_id) ? '来源段落已删除或改变身份' : null;
    return { id: row.id, foreshadowId: row.foreshadow_id, kind: row.kind, chapterId: row.chapter_id, paragraphId: row.paragraph_id, excerpt: row.excerpt,
      sourceRevision: row.source_revision, originalSource: sourceSchema.parse(JSON.parse(row.original_source)), supersedesId: row.supersedes_id,
      supersededBy: evidenceRows.find(item => item.supersedes_id === row.id)?.id ?? null, deletedAt: row.deleted_at, valid: invalidReason === null, invalidReason };
  });
  return { title: meta.title, revision: meta.revision, volumes: volumes.map(volume => ({ title: volume.title, chapters: chapters.filter(chapter => chapter.volumeId === volume.id) })),
    unvolumedChapters: chapters.filter(chapter => chapter.volumeId === null), knowledge, foreshadows, evidence };
}
