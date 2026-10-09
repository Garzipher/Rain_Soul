import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { projectSchema } from '../../src/workers/database/project-schema';
import { initializeAssetsSchema } from '../../src/workers/database/assets-schema';
import { emptyDocument } from '../../src/shared/document';
import type { AssetAction } from '../../src/shared/assets';
import { applyAsset, readAssets } from '../../src/workers/database/assets';

export function assetFixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); db.exec(projectSchema);
  initializeAssetsSchema(db);
  db.prepare('INSERT INTO work_meta(id,title,revision,updated_at) VALUES (?, ?, 1, ?)').run(randomUUID(), '测试作品', new Date().toISOString());
  const chapterId = randomUUID(); const document = emptyDocument();
  document.content[0].content = [{ type: 'text', text: '灯塔旁，雨落下来。' }];
  db.prepare('INSERT INTO chapter(id,title,document_json,word_count,sort_order) VALUES (?,?,?,8,0)').run(chapterId, '同名章节', JSON.stringify(document));
  return { db, chapterId, paragraphId: document.content[0].attrs.id, document,
    change: (action: AssetAction) => { db.transaction(() => {
      const revision = (db.prepare('SELECT revision FROM work_meta').get() as { revision: number }).revision + 1;
      db.prepare('UPDATE work_meta SET revision=?').run(revision); applyAsset(db, action, revision);
    })(); return readAssets(db); },
    state: () => readAssets(db) };
}
