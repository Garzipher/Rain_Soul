import type Database from 'better-sqlite3';
export const sourceAssetTables = ['source_document', 'source_segment', 'knowledge_source', 'learning_annotation'] as const;

export const sourceSchema = `
CREATE TABLE source_document (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('txt','docx','web','paste')),
  hash_version INTEGER NOT NULL CHECK(hash_version=1), original_url TEXT, final_url TEXT,
  title TEXT NOT NULL, fetched_at TEXT, raw_hash TEXT NOT NULL, body_hash TEXT NOT NULL
);
CREATE TABLE source_segment (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES source_document(id),
  ordinal INTEGER NOT NULL CHECK(ordinal>0), chapter_title TEXT NOT NULL, text TEXT NOT NULL, text_hash TEXT NOT NULL,
  UNIQUE(source_id,ordinal), UNIQUE(id,source_id)
);
CREATE TABLE knowledge_source (
  entry_id TEXT NOT NULL REFERENCES knowledge_entry(id), source_id TEXT NOT NULL REFERENCES source_document(id), segment_id TEXT NOT NULL,
  PRIMARY KEY(entry_id,source_id,segment_id), FOREIGN KEY(segment_id,source_id) REFERENCES source_segment(id,source_id)
);
CREATE TABLE learning_annotation (
  id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES knowledge_entry(id), payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE INDEX source_link_document ON knowledge_source(source_id);
CREATE INDEX learning_annotation_entry ON learning_annotation(entry_id);
`;

/** 建库与迁移由调用方控制版本、备份及事务，本模块不改user_version。 */
export function initializeSourceSchema(db: Database.Database): void { db.exec(sourceSchema); initializeSourceCoordinates(db); }
/** 追加可空坐标，不推测旧素材的章节位置。成对约束同时保护直接SQLite写入。 */
export function initializeSourceCoordinates(db: Database.Database): void {
  db.exec(`ALTER TABLE source_segment ADD COLUMN chapter_index INTEGER CHECK(chapter_index IS NULL OR chapter_index>0);
    ALTER TABLE source_segment ADD COLUMN paragraph_index INTEGER CHECK((chapter_index IS NULL AND paragraph_index IS NULL) OR (chapter_index IS NOT NULL AND paragraph_index IS NOT NULL AND paragraph_index>0));`);
}
