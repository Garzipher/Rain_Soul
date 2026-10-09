import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { StructureAction } from '../../shared/contracts';
import { RepositoryError } from './errors';

interface StructureRow { id: string; sort_order: number; volume_id: string | null; deleted_at: string | null; deletion_batch: string | null }
type Table = 'chapter' | 'volume';

function row(db: Database.Database, table: Table, id: string, deleted = false) {
  const value = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS ${deleted ? 'NOT NULL' : 'NULL'}`)
    .get(id) as StructureRow | undefined;
  if (!value) throw new RepositoryError('NOT_FOUND', '卷或章节不存在，或不符合当前删除状态。');
  return value;
}

export function assertVolume(db: Database.Database, volumeId: string | null) {
  if (volumeId !== null) row(db, 'volume', volumeId);
}

export function nextChapterOrder(db: Database.Database, volumeId: string | null) {
  return (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM chapter WHERE volume_id IS ? AND deleted_at IS NULL')
    .get(volumeId) as { next: number }).next;
}

function nextVolumeOrder(db: Database.Database) {
  return (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM volume WHERE deleted_at IS NULL')
    .get() as { next: number }).next;
}

function move(db: Database.Database, table: Table, id: string, direction: 'up' | 'down') {
  const target = row(db, table, id);
  const peers = (table === 'chapter'
    ? db.prepare('SELECT id, sort_order FROM chapter WHERE volume_id IS ? AND deleted_at IS NULL ORDER BY sort_order, id').all(target.volume_id)
    : db.prepare('SELECT id, sort_order FROM volume WHERE deleted_at IS NULL ORDER BY sort_order, id').all()) as StructureRow[];
  const index = peers.findIndex((peer) => peer.id === id);
  const neighbor = peers[index + (direction === 'up' ? -1 : 1)];
  if (!neighbor) return;
  const update = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
  update.run(neighbor.sort_order, target.id);
  update.run(target.sort_order, neighbor.id);
}

function restoreChapter(db: Database.Database, id: string) {
  const chapter = row(db, 'chapter', id, true);
  const parent = chapter.volume_id === null ? undefined
    : db.prepare('SELECT id FROM volume WHERE id = ? AND deleted_at IS NULL').get(chapter.volume_id);
  const volumeId = parent ? chapter.volume_id : null;
  db.prepare('UPDATE chapter SET deleted_at = NULL, deletion_batch = NULL, volume_id = ?, sort_order = ? WHERE id = ?')
    .run(volumeId, nextChapterOrder(db, volumeId), id);
}

function restoreVolume(db: Database.Database, id: string) {
  const volume = row(db, 'volume', id, true);
  db.prepare('UPDATE volume SET deleted_at = NULL, deletion_batch = NULL, sort_order = ? WHERE id = ?')
    .run(nextVolumeOrder(db), id);
  const chapters = db.prepare('SELECT id FROM chapter WHERE volume_id = ? AND deletion_batch = ? AND deleted_at IS NOT NULL ORDER BY sort_order, id')
    .all(id, volume.deletion_batch) as { id: string }[];
  const update = db.prepare('UPDATE chapter SET deleted_at = NULL, deletion_batch = NULL, sort_order = ? WHERE id = ?');
  for (const chapter of chapters) update.run(nextChapterOrder(db, id), chapter.id);
}

export function applyStructure(db: Database.Database, action: StructureAction, revision: number) {
  const deleted = (db.prepare('SELECT deleted_at FROM work_meta').get() as { deleted_at: string | null }).deleted_at;
  if (action.type === 'restoreWork' ? !deleted : deleted) {
    throw new RepositoryError('NOT_FOUND', '作品不存在，或不符合当前删除状态。');
  }
  const timestamp = new Date().toISOString();
  switch (action.type) {
    case 'createVolume':
      db.prepare('INSERT INTO volume (id, title, sort_order) VALUES (?, ?, ?)')
        .run(randomUUID(), action.title.trim(), nextVolumeOrder(db));
      break;
    case 'renameWork': db.prepare('UPDATE work_meta SET title = ?').run(action.title.trim()); break;
    case 'renameVolume':
      row(db, 'volume', action.volumeId);
      db.prepare('UPDATE volume SET title = ? WHERE id = ?').run(action.title.trim(), action.volumeId);
      break;
    case 'moveVolume': move(db, 'volume', action.volumeId, action.direction); break;
    case 'moveChapter': move(db, 'chapter', action.chapterId, action.direction); break;
    case 'setChapterVolume': {
      const chapter = row(db, 'chapter', action.chapterId);
      assertVolume(db, action.volumeId);
      if (chapter.volume_id !== action.volumeId) {
        db.prepare('UPDATE chapter SET volume_id = ?, sort_order = ? WHERE id = ?')
          .run(action.volumeId, nextChapterOrder(db, action.volumeId), action.chapterId);
      }
      break;
    }
    case 'deleteChapter':
      row(db, 'chapter', action.chapterId);
      db.prepare('UPDATE chapter SET deleted_at = ?, deletion_batch = ? WHERE id = ?')
        .run(timestamp, randomUUID(), action.chapterId);
      break;
    case 'deleteVolume': {
      row(db, 'volume', action.volumeId);
      const batch = randomUUID();
      db.prepare('UPDATE volume SET deleted_at = ?, deletion_batch = ? WHERE id = ?').run(timestamp, batch, action.volumeId);
      db.prepare('UPDATE chapter SET deleted_at = ?, deletion_batch = ? WHERE volume_id = ? AND deleted_at IS NULL')
        .run(timestamp, batch, action.volumeId);
      break;
    }
    case 'restoreChapter': restoreChapter(db, action.chapterId); break;
    case 'restoreVolume': restoreVolume(db, action.volumeId); break;
    case 'deleteWork': db.prepare('UPDATE work_meta SET deleted_at = ?').run(timestamp); break;
    case 'restoreWork': db.prepare('UPDATE work_meta SET deleted_at = NULL').run(); break;
  }
  // 只存提交回执；重放后由仓储读取最新正文，避免在日志中复制整书。
  return { revision };
}
