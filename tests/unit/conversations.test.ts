import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';

describe('作品会话的持久化和独立版本', () => {
  let directory: string, repo: WorkRepository, workId: string, id: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'rainsoul-chat-')); repo = new WorkRepository(directory); workId = repo.createWork('同名作品').id; id = randomUUID(); });
  afterEach(() => { repo.close(); rmSync(directory, { recursive: true, force: true }); });
  function create() { return repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'create', id, title: '  构思  ' } })!; }
  it('创建、保存草稿、消息、改名重开不丢失，正文版本不改变', () => {
    const created = create(); expect(created).toMatchObject({ id, title: '构思', revision: 1, draft: '', messages: [], messageCount: 0 });
    repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'saveDraft', id, expectedRevision: 1, draft: '草稿' } });
    repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'appendMessage', id, expectedRevision: 2, message: { id: randomUUID(), role: 'user', content: '问题' }, clearDraft: true } });
    const updated = repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'rename', id, expectedRevision: 3, title: '剧情讨论' } });
    repo.close(); repo = new WorkRepository(directory);
    expect(repo.readConversation(workId, id)).toEqual(updated);
    expect(repo.listConversations(workId)).toMatchObject([{ id, title: '剧情讨论', revision: 4, messageCount: 1 }]);
    expect(repo.openWork(workId).revision).toBe(1);
  });
  it('重复操作返回原回执；同ID不同输入拒绝且旧版本不覆盖', () => {
    create(); const request = { workId, operationId: randomUUID(), action: { type: 'saveDraft' as const, id, expectedRevision: 1, draft: '原稿' } };
    const result = repo.manageConversation(request); repo.close(); repo = new WorkRepository(directory);
    expect(repo.manageConversation(request)).toEqual(result);
    expect(() => repo.manageConversation({ ...request, action: { ...request.action, draft: '另一稿' } })).toThrow(/操作标识/);
    expect(() => repo.manageConversation({ ...request, operationId: randomUUID() })).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(repo.readConversation(workId, id).draft).toBe('原稿');
  });
  it('会话身份不能跨作品，删除隐藏并拒绝继续写入，删除重放安全', () => {
    create(); const other = repo.createWork('同名作品');
    expect(repo.listConversations(other.id)).toEqual([]);
    expect(() => repo.readConversation(other.id, id)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    const request = { workId, operationId: randomUUID(), action: { type: 'delete' as const, id, expectedRevision: 1 } };
    expect(repo.manageConversation(request)).toBeNull(); expect(repo.manageConversation(request)).toBeNull();
    expect(repo.listConversations(workId)).toEqual([]);
    expect(() => repo.readConversation(workId, id)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
  it('拒绝空消息、未知角色和重复消息ID；事务不部分提交', () => {
    create(); const message = { id: randomUUID(), role: 'user' as const, content: '第一条' };
    repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'appendMessage', id, expectedRevision: 1, message } });
    for (const invalid of [{ ...message, content: '  ' }, { ...message, role: 'system' }, message]) {
      expect(() => repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'appendMessage', id, expectedRevision: 2, message: invalid } } as never)).toThrow();
    }
    expect(repo.readConversation(workId, id)).toMatchObject({ revision: 2, messageCount: 1 });
  });
  it('私有云回合原子保存两条消息；草稿/版本变化拒绝迟到结果，重放不重复', () => {
    create(); repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'saveDraft', id, expectedRevision: 1, draft: '  问题原稿  ' } });
    const request = { workId, conversationId: id, expectedRevision: 2, operationId: randomUUID(), userMessageId: randomUUID(), assistantMessageId: randomUUID(), userContent: '  问题原稿  ', assistantContent: '回答', requestHash: 'a'.repeat(64) };
    expect(() => repo.appendConversationTurn({ ...request, userContent: '问题原稿' })).toThrow(/草稿/);
    const result = repo.appendConversationTurn(request); expect(result).toMatchObject({ revision: 3, draft: '', messageCount: 2 });
    expect(result.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(repo.appendConversationTurn(request)).toEqual(result);
    expect(() => repo.appendConversationTurn({ ...request, operationId: randomUUID() })).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(repo.openWork(workId).revision).toBe(1);
  });
  it('迟到重放只返回最新会话，紧凑回执不复制完整历史，删除后不复活', () => {
    const createRequest = { workId, operationId: randomUUID(), action: { type: 'create' as const, id, title: '讨论' } };
    repo.manageConversation(createRequest);
    const first = { workId, operationId: randomUUID(), action: { type: 'saveDraft' as const, id, expectedRevision: 1, draft: '最初' } };
    repo.manageConversation(first);
    repo.manageConversation({ ...first, operationId: randomUUID(), action: { ...first.action, expectedRevision: 2, draft: '最新草稿' } });
    expect(repo.manageConversation(first)).toMatchObject({ draft: '最新草稿', revision: 3 });
    const db = new Database(join(directory, 'Projects', workId, 'project.sqlite'));
    try { expect((db.prepare('SELECT result_json FROM conversation_operation').all() as { result_json: string }[]).every(row => row.result_json.length < 100)).toBe(true); }
    finally { db.close(); }
    repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'delete', id, expectedRevision: 3 } });
    expect(repo.manageConversation(createRequest)).toBeNull();
  });
  it('第二条云消息失败会回滚第一条消息及清稿，删除作品阻止会话读写', () => {
    create(); repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'saveDraft', id, expectedRevision: 1, draft: '问题' } });
    const db = new Database(join(directory, 'Projects', workId, 'project.sqlite'));
    try { db.exec("CREATE TRIGGER reject_ai BEFORE INSERT ON conversation_message WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'模拟失败'); END;"); } finally { db.close(); }
    expect(() => repo.appendConversationTurn({ workId, conversationId: id, expectedRevision: 2, operationId: randomUUID(), userMessageId: randomUUID(), assistantMessageId: randomUUID(), userContent: '问题', assistantContent: '回答', requestHash: 'b'.repeat(64) })).toThrow(/模拟失败/);
    expect(repo.readConversation(workId, id)).toMatchObject({ revision: 2, draft: '问题', messages: [] });
    repo.manageStructure({ workId, expectedRevision: 1, operationId: randomUUID(), action: { type: 'deleteWork' } });
    expect(() => repo.listConversations(workId)).toThrow(/删除/);
    expect(() => repo.readConversation(workId, id)).toThrow(/删除/);
    expect(() => repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'saveDraft', id, expectedRevision: 2, draft: '无权' } })).toThrow(/删除/);
  });
  it('校验边界拒绝非法身份/过长草稿/空标题，创建身份不能复用', () => {
    create();
    expect(() => repo.readConversation(workId, '非法身份')).toThrow(/标识/);
    expect(() => repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'create', id, title: '重复身份' } })).toThrow(/标识/);
    expect(() => repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'rename', id, expectedRevision: 1, title: '  ' } })).toThrow(/参数/);
    expect(() => repo.manageConversation({ workId, operationId: randomUUID(), action: { type: 'saveDraft', id, expectedRevision: 1, draft: '甲'.repeat(200001) } })).toThrow(/参数/);
    expect(() => repo.appendConversationTurn({ workId, conversationId: id, expectedRevision: 1, operationId: randomUUID(), userMessageId: randomUUID(), assistantMessageId: randomUUID(), userContent: '问题', assistantContent: '回答', requestHash: '无效' })).toThrow(/参数/);
    expect(repo.readConversation(workId, id).revision).toBe(1);
  });
});
