import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { conversationRequestSchema, conversationTurnSchema, type ConversationDetail, type ConversationMessage, type ConversationRequest, type ConversationSummary, type ConversationTurnRequest } from '../../shared/conversations';
import { RepositoryError } from './errors';

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

interface ConversationRow { id: string; title: string; revision: number; draft: string; created_at: string; updated_at: string; deleted_at: string | null }
function row(db: Database.Database, id: string): ConversationRow {
  const result = db.prepare('SELECT * FROM conversation WHERE id=? AND deleted_at IS NULL').get(id) as ConversationRow | undefined;
  if (!result) throw new RepositoryError('NOT_FOUND', '会话不存在或已删除。'); return result;
}
function summary(value: ConversationRow, messageCount: number): ConversationSummary {
  return { id: value.id, title: value.title, revision: value.revision, createdAt: value.created_at, updatedAt: value.updated_at, messageCount };
}
export function listConversations(db: Database.Database): ConversationSummary[] {
  return (db.prepare(`SELECT conversation.*, (SELECT COUNT(*) FROM conversation_message WHERE conversation_id=conversation.id) AS message_count
    FROM conversation WHERE deleted_at IS NULL ORDER BY updated_at DESC,id`).all() as (ConversationRow & { message_count: number })[])
    .map(value => summary(value, value.message_count));
}
export function readConversation(db: Database.Database, id: string, beforeMessageId?: string): ConversationDetail {
  if (!z.uuid().safeParse(id).success) throw new RepositoryError('INVALID_INPUT', '会话标识无效。');
  const value = row(db, id);
  let boundary = Number.MAX_SAFE_INTEGER;
  if (beforeMessageId !== undefined) {
    if (!z.uuid().safeParse(beforeMessageId).success) throw new RepositoryError('INVALID_INPUT', '消息分页游标无效。');
    const cursor = db.prepare('SELECT sort_order FROM conversation_message WHERE conversation_id=? AND id=?').get(id, beforeMessageId) as { sort_order: number } | undefined;
    if (!cursor) throw new RepositoryError('INVALID_INPUT', '消息分页游标不属于当前会话。'); boundary = cursor.sort_order;
  }
  // 多读取一条判断是否还有更早历史，既不复制整条会话，也不静默丢弃历史。
  const page = db.prepare('SELECT * FROM conversation_message WHERE conversation_id=? AND sort_order<? ORDER BY sort_order DESC LIMIT 101').all(id, boundary) as { id: string; role: 'user' | 'assistant'; content: string; created_at: string; request_hash: string | null }[];
  const hasMore = page.length > 100;
  const messages = page.slice(0, 100).reverse()
    .map(message => ({ id: message.id, role: message.role, content: message.content, createdAt: message.created_at, ...(message.request_hash ? { requestHash: message.request_hash } : {}) }));
  const count = (db.prepare('SELECT COUNT(*) AS count FROM conversation_message WHERE conversation_id=?').get(id) as { count: number }).count;
  return { ...summary(value, count), draft: value.draft, messages, hasMore, ...(hasMore ? { nextBeforeMessageId: messages[0].id } : {}) };
}
function assertWork(db: Database.Database, workId: string) {
  const meta = db.prepare('SELECT id,deleted_at FROM work_meta').get() as { id: string; deleted_at: string | null } | undefined;
  if (!meta || meta.id !== workId || meta.deleted_at) throw new RepositoryError('NOT_FOUND', '作品不存在或已删除。');
}
function assertRevision(value: ConversationRow, expected: number) {
  if (value.revision !== expected) throw new RepositoryError('REVISION_CONFLICT', '会话已变化，请保留草稿并重新读取。');
}
function mutate(db: Database.Database, workId: string, operationId: string, payload: unknown, change: () => ConversationDetail | null) {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return db.transaction(() => {
    assertWork(db, workId);
    const prior = db.prepare('SELECT request_hash,result_json FROM conversation_operation WHERE operation_id=?').get(operationId) as { request_hash: string; result_json: string } | undefined;
    if (prior) {
      if (prior.request_hash !== hash) throw new RepositoryError('INVALID_INPUT', '操作标识已用于不同会话内容。');
      const receipt = JSON.parse(prior.result_json) as { id: string } | null;
      if (!receipt || !db.prepare('SELECT 1 FROM conversation WHERE id=? AND deleted_at IS NULL').get(receipt.id)) return null;
      return readConversation(db, receipt.id);
    }
    const result = change();
    db.prepare('INSERT INTO conversation_operation VALUES(?,?,?)').run(operationId, hash, JSON.stringify(result ? { id: result.id } : null)); return result;
  }).immediate();
}
function append(db: Database.Database, conversationId: string, message: Omit<ConversationMessage, 'createdAt'>, date: string) {
  if (db.prepare('SELECT 1 FROM conversation_message WHERE id=?').get(message.id)) throw new RepositoryError('INVALID_INPUT', '消息标识已存在。');
  const order = (db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS value FROM conversation_message WHERE conversation_id=?').get(conversationId) as { value: number }).value;
  db.prepare('INSERT INTO conversation_message VALUES(?,?,?,?,?,?,?)').run(message.id, conversationId, message.role, message.content, date, message.requestHash ?? null, order);
}
export function manageConversation(db: Database.Database, input: ConversationRequest): ConversationDetail | null {
  const parsed = conversationRequestSchema.safeParse(input);
  if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '会话操作参数无效。');
  const request = parsed.data, action = request.action;
  return mutate(db, request.workId, request.operationId, ['conversation', request], () => {
    const date = new Date().toISOString();
    if (action.type === 'create') {
      if (db.prepare('SELECT 1 FROM conversation WHERE id=?').get(action.id)) throw new RepositoryError('INVALID_INPUT', '会话标识已存在。');
      db.prepare('INSERT INTO conversation VALUES(?,?,1,?,?,?,NULL)').run(action.id, action.title.trim(), '', date, date);
    } else {
      assertRevision(row(db, action.id), action.expectedRevision);
      if (action.type === 'delete') {
        db.prepare('UPDATE conversation SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=?').run(date, date, action.id); return null;
      }
      if (action.type === 'rename') db.prepare('UPDATE conversation SET title=? WHERE id=?').run(action.title.trim(), action.id);
      if (action.type === 'saveDraft') db.prepare('UPDATE conversation SET draft=? WHERE id=?').run(action.draft, action.id);
      if (action.type === 'appendMessage') {
        append(db, action.id, action.message, date);
        if (action.clearDraft) db.prepare("UPDATE conversation SET draft='' WHERE id=?").run(action.id);
      }
      db.prepare('UPDATE conversation SET updated_at=?,revision=revision+1 WHERE id=?').run(date, action.id);
    }
    return readConversation(db, action.id);
  });
}
export function appendConversationTurn(db: Database.Database, input: ConversationTurnRequest): ConversationDetail {
  const parsed = conversationTurnSchema.safeParse(input);
  if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '会话回复参数无效。');
  const request = parsed.data;
  const result = mutate(db, request.workId, request.operationId, ['conversationTurn', request], () => {
    const value = row(db, request.conversationId); assertRevision(value, request.expectedRevision);
    if (value.draft !== request.userContent) throw new RepositoryError('REVISION_CONFLICT', '发送草稿已变化，请重新预览确认。');
    const date = new Date().toISOString();
    append(db, value.id, { id: request.userMessageId, role: 'user', content: request.userContent, requestHash: request.requestHash }, date);
    append(db, value.id, { id: request.assistantMessageId, role: 'assistant', content: request.assistantContent, requestHash: request.requestHash }, date);
    db.prepare("UPDATE conversation SET draft='',updated_at=?,revision=revision+1 WHERE id=?").run(date, value.id);
    return readConversation(db, value.id);
  });
  if (!result) throw new RepositoryError('NOT_FOUND', '会话已删除，回复只能保留为历史。'); return result;
}
