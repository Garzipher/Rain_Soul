import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { validateDocument } from '../../shared/document';
import { RepositoryError } from './errors';
import { chapterSchema, volumeSchema } from './project-schema';
import { initializeAssetsSchema } from './assets-schema';
import { rebuildAssetSearch } from './assets-search';
import { initializeSnapshots } from './snapshots';
import { initializeConversations } from './conversations';
import { initializeSourceSchema, initializeSourceCoordinates, initializeSourceCapture } from './source-schema';

function prepareAssets(db: Database.Database) {
  // 软删除正文仍属于作者数据，升级不能通过跳过它来掩盖坏稿。
  for (const row of db.prepare('SELECT document_json FROM chapter').all() as { document_json: string }[]) {
    validateDocument(JSON.parse(row.document_json));
  }
  initializeAssetsSchema(db);
  rebuildAssetSearch(db);
  initializeSnapshots(db);
  initializeConversations(db);
  initializeSourceSchema(db);
  if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) {
    throw new Error('迁移后的完整性校验失败');
  }
  db.pragma('user_version = 8');
}

export function migrateProjectV1(db: Database.Database) {
  const backupPath = `${db.name}.v1-backup-${randomUUID()}.sqlite`;
  let backupVerified = false;
  try {
    // VACUUM INTO 读取已提交的 WAL，生成可独立打开的一致备份。
    db.prepare('VACUUM INTO ?').run(backupPath);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      if (backup.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('备份完整性校验失败');
    } finally { backup.close(); }
    backupVerified = true;
    db.transaction(() => {
      db.exec(`ALTER TABLE work_meta ADD COLUMN deleted_at TEXT;
        ${volumeSchema}
        ALTER TABLE chapter RENAME TO chapter_v1;
        ${chapterSchema}
        INSERT INTO chapter (id, title, document_json, word_count, sort_order)
          SELECT id, title, document_json, word_count, sort_order FROM chapter_v1;
        DROP TABLE chapter_v1;
        CREATE INDEX chapter_order ON chapter(volume_id, deleted_at, sort_order);`);
      prepareAssets(db);
    }).immediate();
  } catch {
    // schema、正文、回执和 user_version 在同一事务内回滚；保留迁移前备份供恢复。
    throw new RepositoryError('MIGRATION_FAILED', backupVerified
      ? '作品数据库升级失败，已保留原库及升级前备份，请停止使用并检查数据库。'
      : '升级前备份未成功，原数据库未修改，请检查磁盘空间或文件权限后重试。');
  }
}

export function migrateProjectV2(db: Database.Database) {
  const backupPath = `${db.name}.v2-backup-${randomUUID()}.sqlite`;
  let backupVerified = false;
  try {
    db.prepare('VACUUM INTO ?').run(backupPath);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try { if (backup.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('备份完整性校验失败'); }
    finally { backup.close(); }
    backupVerified = true;
    db.transaction(() => {
      prepareAssets(db);
    }).immediate();
  } catch {
    throw new RepositoryError('MIGRATION_FAILED', backupVerified
      ? '作品数据库升级失败，已保留原库及升级前备份。'
      : '升级前备份未成功，原数据库未修改，请检查磁盘空间或权限。');
  }
}

export function migrateProjectV3(db: Database.Database) {
  const backupPath = `${db.name}.v3-backup-${randomUUID()}.sqlite`;
  let backupVerified = false;
  try {
    db.prepare('VACUUM INTO ?').run(backupPath);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try { if (backup.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('备份完整性校验失败'); }
    finally { backup.close(); }
    backupVerified = true;
    db.transaction(() => {
      initializeSnapshots(db);
      initializeConversations(db);
      initializeSourceSchema(db);
      if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('迁移后的完整性校验失败');
      db.pragma('user_version = 8');
    }).immediate();
  } catch {
    throw new RepositoryError('MIGRATION_FAILED', backupVerified
      ? '快照数据库升级失败，已保留原库及升级前备份。'
      : '升级前备份未成功，原数据库未修改，请检查磁盘空间或权限。');
  }
}

export function migrateProjectV4(db: Database.Database) {
  const backupPath = `${db.name}.v4-backup-${randomUUID()}.sqlite`;
  let backupVerified = false;
  try {
    db.prepare('VACUUM INTO ?').run(backupPath);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try { if (backup.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('备份完整性校验失败'); }
    finally { backup.close(); }
    backupVerified = true;
    db.transaction(() => {
      initializeConversations(db);
      initializeSourceSchema(db);
      if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('迁移后的完整性校验失败');
      db.pragma('user_version = 8');
    }).immediate();
  } catch {
    throw new RepositoryError('MIGRATION_FAILED', backupVerified
      ? '会话数据库升级失败，已保留原库及升级前备份。'
      : '升级前备份未成功，原数据库未修改，请检查磁盘空间或权限。');
  }
}

export function migrateProjectV5(db: Database.Database) {
  const backupPath = `${db.name}.v5-backup-${randomUUID()}.sqlite`;
  let backupVerified = false;
  try {
    db.prepare('VACUUM INTO ?').run(backupPath);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try { if (backup.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('备份完整性校验失败'); }
    finally { backup.close(); }
    backupVerified = true;
    db.transaction(() => {
      initializeSourceSchema(db);
      if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('迁移后的完整性校验失败');
      db.pragma('user_version = 8');
    }).immediate();
  } catch {
    throw new RepositoryError('MIGRATION_FAILED', backupVerified
      ? '来源资产数据库升级失败，已保留原库及升级前备份。'
      : '升级前备份未成功，原数据库未修改，请检查磁盘空间或权限。');
  }
}

/** v6来源坐标升级：先独立备份，再原子追加可空列，历史快照保持原hash。 */
export function migrateProjectV6(db: Database.Database) {
  const backupPath = `${db.name}.v6-backup-${randomUUID()}.sqlite`;
  let backupVerified = false;
  try {
    db.prepare('VACUUM INTO ?').run(backupPath);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try { if (backup.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('备份完整性校验失败'); }
    finally { backup.close(); }
    backupVerified = true;
    db.transaction(() => {
      initializeSourceCoordinates(db);
      initializeSourceCapture(db);
      if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('迁移后的完整性校验失败');
      db.pragma('user_version = 8');
    }).immediate();
  } catch {
    throw new RepositoryError('MIGRATION_FAILED', backupVerified
      ? '来源坐标数据库升级失败，已保留原库及升级前备份。'
      : '升级前备份未成功，原数据库未修改，请检查磁盘空间或权限。');
  }
}

/** v7 捕获关系升级：先校验独立备份，再同事务追加新关系与版本。 */
export function migrateProjectV7(db: Database.Database) {
  const backupPath = `${db.name}.v7-backup-${randomUUID()}.sqlite`;
  let backupVerified = false;
  try {
    db.prepare('VACUUM INTO ?').run(backupPath);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try { if (backup.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('备份完整性校验失败'); }
    finally { backup.close(); }
    backupVerified = true;
    db.transaction(() => {
      initializeSourceCapture(db);
      if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('迁移后的完整性校验失败');
      db.pragma('user_version = 8');
    }).immediate();
  } catch {
    throw new RepositoryError('MIGRATION_FAILED', backupVerified
      ? '来源捕获数据库升级失败，已保留原库及升级前备份。'
      : '升级前备份未成功，原数据库未修改，请检查磁盘空间或权限。');
  }
}
