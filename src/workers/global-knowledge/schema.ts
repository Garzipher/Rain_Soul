/** 全局库只存正式审核资产；运行时索引和操作回执不进入可移植包。 */
export const globalSchema = `
CREATE TABLE IF NOT EXISTS global_meta(id INTEGER PRIMARY KEY CHECK(id=1), library_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0));
CREATE TABLE IF NOT EXISTS global_category(id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE IF NOT EXISTS global_tag(id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE IF NOT EXISTS global_source_document(id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)), metadata TEXT NOT NULL CHECK(json_valid(metadata)));
CREATE TABLE IF NOT EXISTS global_source_segment(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES global_source_document(id), payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE IF NOT EXISTS global_knowledge_entry(id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE IF NOT EXISTS global_learning_annotation(id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES global_knowledge_entry(id), payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE IF NOT EXISTS global_usage(operation_id TEXT NOT NULL, work_id TEXT NOT NULL, entry_id TEXT NOT NULL, revision INTEGER NOT NULL, work_revision INTEGER NOT NULL, PRIMARY KEY(operation_id,entry_id));
CREATE TABLE IF NOT EXISTS global_operation(operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result_revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS global_search_document(entry_id TEXT PRIMARY KEY REFERENCES global_knowledge_entry(id), body TEXT NOT NULL, source TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS global_search_fts USING fts5(entry_id UNINDEXED, body, source, tokenize='trigram');
`;
export const globalDefaults = [
  ['未分类', 'uncategorized'], ['人物描写', 'character'], ['景物描写', 'scenery'], ['内心描写', 'inner'],
  ['经典引用', 'quotation'], ['剧情与伏笔', 'plot'], ['叙事技巧', 'narrative'], ['语言与节奏', 'language'],
] as const;
