import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';

let directory: string, repo: WorkRepository, workId: string, id: string, messageIds: string[];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'rainsoul-chat-pages-')); repo = new WorkRepository(directory); workId = repo.createWork('分页作品').id; id = randomUUID();
  repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'create', id, title: '长会话' } });
  const db = new Database(join(directory, 'Projects', workId, 'project.sqlite')); messageIds = Array.from({ length: 205 }, () => randomUUID());
  try { db.transaction(() => { const insert = db.prepare('INSERT INTO conversation_message VALUES(?,?,?,?,?,?,?)'); for (const [index, messageId] of messageIds.entries()) insert.run(messageId, id, index % 2 ? 'assistant' : 'user', `消息${index}`, new Date().toISOString(), null, index); })(); }
  finally { db.close(); }
});
afterEach(() => { repo.close(); rmSync(directory, { recursive: true, force: true }); });
it('默认只读取最近100条，分页升序并披露总数；加载更早不重复不漏消息', () => {
  const latest = repo.readConversation(workId, id);
  expect(latest).toMatchObject({ messageCount: 205, hasMore: true, nextBeforeMessageId: messageIds[105] });
  expect(latest.messages).toHaveLength(100); expect(latest.messages[0].content).toBe('消息105'); expect(latest.messages.at(-1)?.content).toBe('消息204');
  const older = repo.readConversation(workId, id, latest.nextBeforeMessageId);
  expect(older).toMatchObject({ messageCount: 205, hasMore: true, nextBeforeMessageId: messageIds[5] }); expect(older.messages).toHaveLength(100);
  const first = repo.readConversation(workId, id, older.nextBeforeMessageId);
  expect(first.hasMore).toBe(false); expect(first.nextBeforeMessageId).toBeUndefined(); expect(first.messages).toHaveLength(5);
  expect([...first.messages, ...older.messages, ...latest.messages].map(message => message.id)).toEqual(messageIds);
});
it('游标必须属于当前会话，拒绝未知或跨会话游标；summary不携带历史正文', () => {
  const otherId = randomUUID(), otherMessageId = randomUUID();
  repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'create', id: otherId, title: '另一会话' } });
  repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'appendMessage', id: otherId, expectedRevision: 1, message: { id: otherMessageId, role: 'user', content: '私有消息' } } });
  expect(() => repo.readConversation(workId, id, otherMessageId)).toThrow(/游标/);
  expect(() => repo.readConversation(workId, id, randomUUID())).toThrow(/游标/);
  expect(() => repo.readConversation(workId, id, '非法')).toThrow(/游标/);
  expect(repo.listConversations(workId).every(item => !('messages' in item) && !('draft' in item))).toBe(true);
});
