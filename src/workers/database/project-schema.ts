export const chapterSchema = `CREATE TABLE chapter (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  document_json TEXT NOT NULL,
  word_count INTEGER NOT NULL CHECK (word_count >= 0),
  sort_order INTEGER NOT NULL,
  volume_id TEXT REFERENCES volume(id),
  deleted_at TEXT,
  deletion_batch TEXT
);`;

export const volumeSchema = `CREATE TABLE volume (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  deleted_at TEXT,
  deletion_batch TEXT
);`;

export const projectSchema = `
  CREATE TABLE work_meta (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  ${volumeSchema}
  ${chapterSchema}
  CREATE INDEX chapter_order ON chapter(volume_id, deleted_at, sort_order);
  CREATE TABLE operation_log (
    operation_id TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    result_json TEXT NOT NULL
  );
`;
