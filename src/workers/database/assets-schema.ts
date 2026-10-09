import type Database from 'better-sqlite3';

export const assetSchema = `
CREATE TABLE category (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES category(id), sort_order INTEGER NOT NULL, system_key TEXT UNIQUE, deleted_at TEXT);
CREATE TABLE tag (id TEXT PRIMARY KEY, name TEXT NOT NULL, deleted_at TEXT);
CREATE UNIQUE INDEX tag_active_name ON tag(name) WHERE deleted_at IS NULL;
CREATE TABLE knowledge_entry (id TEXT PRIMARY KEY, body TEXT NOT NULL, source TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES category(id), origin_json TEXT, revision INTEGER NOT NULL, deleted_at TEXT);
CREATE TABLE knowledge_tag (entry_id TEXT REFERENCES knowledge_entry(id), tag_id TEXT REFERENCES tag(id), PRIMARY KEY(entry_id, tag_id));
CREATE TABLE knowledge_history (entry_id TEXT NOT NULL REFERENCES knowledge_entry(id), revision INTEGER NOT NULL, body TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY(entry_id, revision));
CREATE TABLE asset_history (entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('before','after')), payload_json TEXT NOT NULL, PRIMARY KEY(entity_kind,entity_id,revision,phase));
CREATE TABLE outline_node (id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('volume','chapter','detail')), parent_id TEXT REFERENCES outline_node(id), title TEXT NOT NULL, summary TEXT NOT NULL, chapter_id TEXT REFERENCES chapter(id), sort_order INTEGER NOT NULL, deleted_at TEXT);
CREATE TABLE outline_knowledge (node_id TEXT REFERENCES outline_node(id), knowledge_id TEXT REFERENCES knowledge_entry(id), PRIMARY KEY(node_id, knowledge_id));
CREATE TABLE foreshadow (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('未埋设','已埋设','已触发','已回收','废弃')), description TEXT NOT NULL, outline_id TEXT REFERENCES outline_node(id), deleted_at TEXT);
CREATE TABLE evidence (id TEXT PRIMARY KEY, foreshadow_id TEXT NOT NULL REFERENCES foreshadow(id), kind TEXT NOT NULL CHECK(kind IN ('埋设','触发','回收')), chapter_id TEXT NOT NULL REFERENCES chapter(id), paragraph_id TEXT, excerpt TEXT NOT NULL, source_revision INTEGER NOT NULL, original_source TEXT NOT NULL, supersedes_id TEXT UNIQUE REFERENCES evidence(id), deleted_at TEXT);
CREATE TABLE style_profile (id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE style_default (singleton INTEGER PRIMARY KEY CHECK(singleton=1), profile_id TEXT REFERENCES style_profile(id));
INSERT INTO style_default VALUES (1, NULL);
CREATE TABLE chapter_style (chapter_id TEXT PRIMARY KEY REFERENCES chapter(id), profile_id TEXT NOT NULL REFERENCES style_profile(id));
CREATE TABLE search_document (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('knowledge','paragraph')), chapter_id TEXT, paragraph_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, source TEXT NOT NULL, normalized_text TEXT NOT NULL);
CREATE VIRTUAL TABLE search_fts USING fts5(normalized_text, content='search_document', content_rowid='rowid', tokenize='trigram');
CREATE TRIGGER search_insert AFTER INSERT ON search_document BEGIN INSERT INTO search_fts(rowid, normalized_text) VALUES(new.rowid, new.normalized_text); END;
CREATE TRIGGER search_delete AFTER DELETE ON search_document BEGIN INSERT INTO search_fts(search_fts,rowid,normalized_text) VALUES('delete',old.rowid,old.normalized_text); END;
CREATE TRIGGER search_update AFTER UPDATE ON search_document BEGIN INSERT INTO search_fts(search_fts,rowid,normalized_text) VALUES('delete',old.rowid,old.normalized_text); INSERT INTO search_fts(rowid,normalized_text) VALUES(new.rowid,new.normalized_text); END;
CREATE INDEX search_chapter ON search_document(chapter_id);
CREATE INDEX outline_parent ON outline_node(parent_id,sort_order);
CREATE INDEX category_parent ON category(parent_id,sort_order);
CREATE INDEX evidence_foreshadow ON evidence(foreshadow_id);
`;
export const defaultCategories = ['未分类', '人物描写', '景物描写', '内心描写', '经典引用', '剧情与伏笔'];
export function initializeAssetsSchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec(assetSchema);
    const insert = db.prepare('INSERT INTO category VALUES (?, ?, NULL, ?, ?, NULL)');
    for (const [index, name] of defaultCategories.entries()) {
      // ID 仅在作品库作用域内使用；确定性默认字典不会成为全局共享对象。
      insert.run(`e9cf0000-6f00-4000-8000-${String(index + 1).padStart(12, '0')}`, name, index, index === 0 ? 'uncategorized' : null);
    }
  })();
}
