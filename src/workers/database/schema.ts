import type Database from 'better-sqlite3';

export class RepositoryError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function initializeSchema(db: Database.Database, kind: 'catalog' | 'project') {
  const version = db.pragma('user_version', { simple: true });
  if (version !== 0 && version !== 1) {
    throw new RepositoryError('UNSUPPORTED_SCHEMA', '数据库版本不受此客户端支持，请使用匹配版本。');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 1000');
  if (version === 1) return;
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
    ` : `
      CREATE TABLE work_meta (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE chapter (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        document_json TEXT NOT NULL,
        word_count INTEGER NOT NULL CHECK (word_count >= 0),
        sort_order INTEGER NOT NULL UNIQUE
      );
      CREATE TABLE operation_log (
        operation_id TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
    `);
    db.pragma('user_version = 1');
  }).immediate();
}
