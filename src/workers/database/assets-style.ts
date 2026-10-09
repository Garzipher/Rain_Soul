import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AssetAction } from '../../shared/assets';
import { assetRow } from './assets-common';
import { RepositoryError } from './errors';

export function applyStyleAsset(db: Database.Database, action: AssetAction): boolean {
  if (action.type === 'publishStyle') {
    const id = randomUUID();
    db.prepare('INSERT INTO style_profile(id,version,payload_json,created_at) VALUES(?,(SELECT COALESCE(MAX(version),0)+1 FROM style_profile),?,?)')
      .run(id, JSON.stringify(action.payload), new Date().toISOString());
    db.prepare('UPDATE style_default SET profile_id=? WHERE singleton=1').run(id);
    return true;
  }
  if (action.type !== 'setChapterStyle') return false;
  assetRow(db, 'chapter', action.chapterId);
  if (action.profileId === null) db.prepare('DELETE FROM chapter_style WHERE chapter_id=?').run(action.chapterId);
  else {
    if (!db.prepare('SELECT id FROM style_profile WHERE id=?').get(action.profileId)) throw new RepositoryError('NOT_FOUND', '写作特点版本不属于当前作品。');
    db.prepare('INSERT INTO chapter_style VALUES(?,?) ON CONFLICT(chapter_id) DO UPDATE SET profile_id=excluded.profile_id').run(action.chapterId, action.profileId);
  }
  return true;
}
