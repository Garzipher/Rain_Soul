import type Database from 'better-sqlite3';

export const conversationSchema = `
CREATE TABLE conversation (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1),
  draft TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE conversation_message (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id),
  role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
  created_at TEXT NOT NULL, request_hash TEXT, sort_order INTEGER NOT NULL CHECK(sort_order>=0),
  UNIQUE(conversation_id,sort_order)
);
CREATE INDEX conversation_message_order ON conversation_message(conversation_id,sort_order);
CREATE TABLE conversation_operation (operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result_json TEXT NOT NULL);
`;
export function initializeConversations(db: Database.Database) { db.exec(conversationSchema); }
