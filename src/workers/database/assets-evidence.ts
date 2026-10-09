import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AssetAction, Evidence, EvidenceSource } from '../../shared/assets';
import { validateDocument } from '../../shared/document';
import { assetRow } from './assets-common';
import { RepositoryError } from './errors';

interface ChapterSource { id: string; title: string; document_json: string; deleted_at: string | null }
type EvidenceRow = Omit<Evidence, 'valid' | 'invalidReason' | 'originalSource'> & { originalSource: string };

function source(db: Database.Database, chapterId: string, paragraphId: string | null, excerpt: string, revision: number): EvidenceSource {
  const chapter = assetRow<ChapterSource>(db, 'chapter', chapterId);
  if (paragraphId !== null && !validateDocument(JSON.parse(chapter.document_json)).content.some(p => p.attrs.id === paragraphId)) {
    throw new RepositoryError('NOT_FOUND', '证据段落已失效，请选择当前真实段落。');
  }
  return { chapterId, chapterTitle: chapter.title, paragraphId, excerpt, revision };
}
export function applyEvidenceAsset(db: Database.Database, action: AssetAction, revision: number): boolean {
  if (action.type === 'deleteEvidence') { assetRow(db, 'evidence', action.id); db.prepare('UPDATE evidence SET deleted_at=? WHERE id=?').run(new Date().toISOString(), action.id); return true; }
  if (action.type !== 'addEvidence' && action.type !== 'relinkEvidence') return false;
  const previous = action.type === 'relinkEvidence' ? assetRow<{ id: string; foreshadow_id: string; kind: string; original_source: string }>(db, 'evidence', action.id) : null;
  if (previous && db.prepare('SELECT id FROM evidence WHERE supersedes_id=?').get(previous.id)) throw new RepositoryError('INVALID_INPUT', '此证据已有重新关联记录，请操作最新记录。');
  const foreshadowId = action.type === 'addEvidence' ? action.foreshadowId : previous!.foreshadow_id;
  assetRow(db, 'foreshadow', foreshadowId);
  const current = source(db, action.chapterId, action.paragraphId, action.excerpt, revision);
  db.prepare('INSERT INTO evidence(id,foreshadow_id,kind,chapter_id,paragraph_id,excerpt,source_revision,original_source,supersedes_id) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), foreshadowId, action.type === 'addEvidence' ? action.kind : previous!.kind, action.chapterId, action.paragraphId,
      action.excerpt, revision, previous?.original_source ?? JSON.stringify(current), previous?.id ?? null);
  return true;
}
export function readEvidence(db: Database.Database): Evidence[] {
  const rows = db.prepare(`SELECT e.id,e.foreshadow_id AS foreshadowId,e.kind,e.chapter_id AS chapterId,e.paragraph_id AS paragraphId,e.excerpt,
    e.source_revision AS sourceRevision,e.original_source AS originalSource,e.supersedes_id AS supersedesId,e.deleted_at AS deletedAt,
    (SELECT id FROM evidence newer WHERE newer.supersedes_id=e.id) AS supersededBy FROM evidence e ORDER BY e.rowid`).all() as EvidenceRow[];
  const chapters = new Map<string, { present: boolean; paragraphs: Set<string> }>();
  return rows.map(row => {
    if (!chapters.has(row.chapterId)) {
      const chapter = db.prepare('SELECT document_json,deleted_at FROM chapter WHERE id=?').get(row.chapterId) as ChapterSource | undefined;
      const present = !!chapter && !chapter.deleted_at;
      chapters.set(row.chapterId, { present, paragraphs: new Set(present ? validateDocument(JSON.parse(chapter.document_json)).content.map(p => p.attrs.id) : []) });
    }
    const chapter = chapters.get(row.chapterId)!;
    const invalidReason = !chapter.present ? '来源章节已删除或不存在' : row.paragraphId !== null && !chapter.paragraphs.has(row.paragraphId) ? '来源段落已删除或改变身份' : null;
    return { ...row, originalSource: JSON.parse(row.originalSource) as EvidenceSource, valid: invalidReason === null, invalidReason };
  });
}
