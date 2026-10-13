import type Database from 'better-sqlite3';
import { RepositoryError } from './errors';
import { migrateProjectV1, migrateProjectV2, migrateProjectV3, migrateProjectV4, migrateProjectV5, migrateProjectV6, migrateProjectV7 } from './migration';
import { initializeSourceSchema } from './source-schema';
import { projectSchema } from './project-schema';
import { initializeAssetsSchema } from './assets-schema';
import { initializeSnapshots } from './snapshots';
import { initializeConversations } from './conversations';
export { RepositoryError } from './errors';

export function initializeSchema(db: Database.Database, kind: 'catalog' | 'project') {
  const version = db.pragma('user_version', { simple: true });
  if (version !== 0 && version !== 1 && !(kind === 'project' && (version === 2 || version === 3 || version === 4 || version === 5 || version === 6 || version === 7 || version === 8))) {
    throw new RepositoryError('UNSUPPORTED_SCHEMA', '数据库版本不受此客户端支持，请使用匹配版本。');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 1000');
  if (version === 8 || (kind === 'catalog' && version === 1)) return;
  if (version === 7) return migrateProjectV7(db);
  if (version === 6) return migrateProjectV6(db);
  if (version === 5) return migrateProjectV5(db);
  if (version === 1) return migrateProjectV1(db);
  if (version === 2) return migrateProjectV2(db);
  if (version === 3) return migrateProjectV3(db);
  if (version === 4) return migrateProjectV4(db);
  db.transaction(() => {
    db.exec(kind === 'catalog' ? `
      CREATE TABLE work_catalog (
        work_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        word_count INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        cached_revision INTEGER NOT NULL
      );
    ` : projectSchema);
    if (kind === 'project') { initializeAssetsSchema(db); initializeSourceSchema(db); initializeSnapshots(db); initializeConversations(db); }
    db.pragma(`user_version = ${kind === 'catalog' ? 1 : 8}`);
  }).immediate();
}
