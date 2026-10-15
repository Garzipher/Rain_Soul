import { describe, expect, it, vi } from 'vitest';
import { ConversationAiCommands } from '../../src/main/conversation-ai-commands';
import { ConversationAiService } from '../../src/main/conversation-ai-service';
import type { AiPreparedRequest } from '../../src/shared/ai';
import type { ConversationDetail, ConversationTurnRequest } from '../../src/shared/conversations';

function setup() {
  const workId = crypto.randomUUID(), id = crypto.randomUUID();
  let detail: ConversationDetail = { id, title: '创作讨论', revision: 4, createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z', messageCount: 1,
    draft: '当前需求草稿', hasMore: false, messages: [{ id: crypto.randomUUID(), role: 'user', content: '历史问题', createdAt: '2026-10-09T00:00:00Z' }] };
  let provider = { id: 'cloud-default', name: '隔离服务', baseUrl: 'https://api.example.com/v1', model: 'test' };
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '创作讨论回答' } }] })));
  const credentials = { read: vi.fn(async () => 'test-conversation-key') };
  const service = new ConversationAiService({ credentials, fetch: fetcher, resolveHost: async () => ['8.8.8.8'], timeoutMs: 1000 });
  const store = { execute: vi.fn(async (command: string, payload: unknown) => {
    if (command === 'readConversation') return structuredClone(detail);
    if (command !== 'appendConversationTurn') throw new Error('不应读取作品正文');
    const request = payload as ConversationTurnRequest;
    if (request.expectedRevision !== detail.revision || request.userContent !== detail.draft) throw new Error('会话版本已变化');
    detail = { ...detail, revision: detail.revision + 1, draft: '', messageCount: detail.messageCount + 2,
      messages: [...detail.messages, { id: request.userMessageId, role: 'user', content: request.userContent, requestHash: request.requestHash, createdAt: '2026-10-09' }, { id: request.assistantMessageId, role: 'assistant', content: request.assistantContent, requestHash: request.requestHash, createdAt: '2026-10-09' }] };
    return structuredClone(detail);
  }) };
  const commands = new ConversationAiCommands(store, { get: () => ({ provider, hasCredential: true }) }, service);
  const request = { workId, conversationId: id, expectedRevision: detail.revision };
  return { commands, store, fetcher, credentials, request, getDetail: () => detail, changeDetail: () => { detail = { ...detail, revision: detail.revision + 1, draft: '新草稿' }; }, changeProvider: () => { provider = { ...provider, model: 'changed' }; } };
}
describe('会话主进程冻结与原子双消息写入', () => {
  it('严格命令白名单，准备不联网且不读取作品；真实完整回复后才写两条消息', async () => {
    const { commands, store, fetcher, request } = setup();
    expect(commands.accepts('prepareConversationAi')).toBe(true); expect(commands.accepts('appendConversationTurn')).toBe(false);
    await expect(commands.execute('prepareConversationAi', { ...request, messages: [{ role: 'system', content: '伪造历史' }] })).rejects.toThrow();
    const preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
    expect(fetcher).not.toHaveBeenCalled(); expect(store.execute.mock.calls.every(([command]) => command === 'readConversation')).toBe(true);
    const result = await commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true }) as ConversationDetail;
    expect(result).toMatchObject({ revision: 5, draft: '', messageCount: 3 });
    expect(result.messages.slice(-2).map(message => message.content)).toEqual(['当前需求草稿', '创作讨论回答']);
    expect(store.execute.mock.calls.filter(([command]) => command === 'appendConversationTurn')).toHaveLength(1);
    await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).rejects.toThrow(/失效/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('会话修订已变与模型变更均需要重新预览，不发送旧请求', async () => {
    for (const change of ['conversation', 'provider']) {
      const { commands, fetcher, request, changeDetail, changeProvider } = setup(), preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
      if (change === 'conversation') changeDetail(); else changeProvider();
      await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).rejects.toThrow(/变化|预览/);
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it('凭据读取期间会话变化也不发送，晚到回答不写入新草稿', async () => {
    const { commands, fetcher, request, credentials, changeDetail, getDetail } = setup();
    credentials.read.mockImplementationOnce(async () => { changeDetail(); return 'test-conversation-key'; });
    let preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
    await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).rejects.toThrow(/变化/); expect(fetcher).not.toHaveBeenCalled();
    preview = await commands.execute('prepareConversationAi', { ...request, expectedRevision: getDetail().revision }) as AiPreparedRequest;
    fetcher.mockImplementationOnce(async () => { changeDetail(); return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '晚回答' } }] })); });
    await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).rejects.toThrow(/变化/);
    expect(getDetail().draft).toBe('新草稿'); expect(getDetail().messages).toHaveLength(1);
  });
  it('取消与网络失败保留草稿，无自动重发也无用户半条消息', async () => {
    const { commands, fetcher, request, getDetail } = setup();
    const preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
    await commands.execute('cancelConversationAi', { confirmationToken: preview.confirmationToken });
    await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).rejects.toThrow(/失效|取消/);
    const next = await commands.execute('prepareConversationAi', request) as AiPreparedRequest; fetcher.mockRejectedValueOnce(new Error('test-conversation-key'));
    await expect(commands.execute('executeConversationAi', { confirmationToken: next.confirmationToken, requestHash: next.requestHash, confirmed: true })).rejects.toThrow(/连接云端服务失败/);
    expect(getDetail().draft).toBe('当前需求草稿'); expect(getDetail().messages).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('执行中取消能中止发送并且drain等候结束', async () => {
    const { commands, fetcher, request, getDetail } = setup(); fetcher.mockImplementationOnce(async () => new Promise(() => undefined));
    const preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
    const pending = expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).rejects.toThrow(/取消/);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await commands.execute('cancelConversationAi', { confirmationToken: preview.confirmationToken }); await commands.drain(); await pending;
    expect(getDetail().draft).toBe('当前需求草稿'); expect(getDetail().messages).toHaveLength(1);
  });
  it('没有配置和无效命令拒绝，未明确确认不会消耗有效授权', async () => {
    const { commands, store, request, fetcher } = setup();
    const unavailable = new ConversationAiCommands(store, { get: () => ({ provider: null, hasCredential: false }) }, new ConversationAiService({ credentials: { read: async () => null } }));
    await expect(unavailable.execute('prepareConversationAi', request)).rejects.toThrow(/配置/);
    await expect(commands.execute('appendConversationTurn', {})).rejects.toThrow(/未知/);
    await expect(commands.execute('prepareConversationAi', { ...request, expectedRevision: 99 })).rejects.toThrow(/变化/);
    const preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
    await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: 'wrong', confirmed: true })).rejects.toThrow(/失效/);
    await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: false })).rejects.toThrow(/确认/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).resolves.toMatchObject({ draft: '' });
  });
  it('完整回答保存失败可用原operationId只重试数据库，无需再次联网或消费授权', async () => {
    const { commands, store, request, fetcher, getDetail } = setup();
    const original = store.execute.getMockImplementation()!;
    let failed = false;
    store.execute.mockImplementation(async (command, payload) => { if (command === 'appendConversationTurn' && !failed) { failed = true; throw new Error('磁盘写入失败'); } return original(command, payload); });
    const preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
    await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).rejects.toThrow(/保存|写入/);
    expect(getDetail().draft).toBe('当前需求草稿');
    expect(commands.accepts('retryConversationReply')).toBe(true);
    await expect(commands.execute('retryConversationReply', { requestHash: preview.requestHash })).resolves.toMatchObject({ revision: 5, draft: '', messageCount: 3 });
    const writes = store.execute.mock.calls.filter(([command]) => command === 'appendConversationTurn'); expect(writes).toHaveLength(2); expect(writes[0][1]).toEqual(writes[1][1]); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('写入成功但回执丢失仍能用同操作重放，未知hash不能造成云重发', async () => {
    const { commands, store, request, fetcher, getDetail } = setup(), original = store.execute.getMockImplementation()!;
    let completed: { request: unknown; result: ConversationDetail } | undefined;
    store.execute.mockImplementation(async (command, payload) => {
      if (command !== 'appendConversationTurn') return original(command, payload);
      if (completed) { expect(payload).toEqual(completed.request); return completed.result; }
      const result = await original(command, payload); completed = { request: structuredClone(payload), result }; throw new Error('回执丢失');
    });
    const preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
    await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).rejects.toThrow();
    expect(getDetail().messageCount).toBe(3);
    await expect(commands.execute('retryConversationReply', { requestHash: preview.requestHash })).resolves.toMatchObject({ messageCount: 3 });
    await expect(commands.execute('retryConversationReply', { requestHash: 'a'.repeat(64) })).rejects.toThrow(/不存在|失效|未收到/); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('保存待确认的回答可以与新草稿对照、明确放弃解锁；不能通过取消发送丢弃', async () => {
    const { commands, store, request, fetcher, changeDetail } = setup(), original = store.execute.getMockImplementation()!;
    store.execute.mockImplementation(async (command, payload) => { if (command === 'appendConversationTurn') throw new Error('磁盘写入失败'); return original(command, payload); });
    const preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
    await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).rejects.toMatchObject({ code: 'CONVERSATION_REPLY_PENDING' });
    changeDetail();
    await commands.execute('cancelConversationAi', { confirmationToken: preview.confirmationToken });
    await expect(commands.execute('readPendingConversationReply', { requestHash: preview.requestHash })).resolves.toMatchObject({ workId: request.workId, conversationId: request.conversationId, userContent: '当前需求草稿', assistantContent: '创作讨论回答', currentDraft: '新草稿', currentRevision: 5, expectedRevision: 4 });
    await expect(commands.execute('prepareConversationAi', { ...request, expectedRevision: 5 })).rejects.toMatchObject({ code: 'CONVERSATION_REPLY_PENDING' });
    await commands.execute('discardConversationReply', { requestHash: preview.requestHash });
    await expect(commands.execute('readPendingConversationReply', { requestHash: preview.requestHash })).rejects.toThrow(/失效|未收到/);
    await expect(commands.execute('prepareConversationAi', { ...request, expectedRevision: 5 })).resolves.toBeDefined(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('缓存详情与放弃先校验当前作品边界，已保存结果放弃不删除消息', async () => {
    const { commands, store, request, getDetail } = setup(), original = store.execute.getMockImplementation()!;
    const preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
    await commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true });
    store.execute.mockImplementation(async () => { throw new Error('仅允许修改当前作品'); });
    await expect(commands.execute('readPendingConversationReply', { requestHash: preview.requestHash })).rejects.toThrow(/当前作品/);
    await expect(commands.execute('discardConversationReply', { requestHash: preview.requestHash })).rejects.toThrow(/当前作品/);
    store.execute.mockImplementation(original);
    await commands.execute('discardConversationReply', { requestHash: preview.requestHash }); expect(getDetail().messageCount).toBe(3);
  });
  it('完整云回复到达后会话或配置变化也先保留回答，不能因后验失败丢掉付费结果', async () => {
    for (const change of ['conversation', 'provider', 'readFailure']) {
      const { commands, store, request, fetcher, changeDetail, changeProvider, getDetail } = setup(), original = store.execute.getMockImplementation()!;
      let denyRead = false;
      store.execute.mockImplementation(async (command, payload) => { if (command === 'readConversation' && denyRead) throw new Error('数据库暂时不可读'); return original(command, payload); });
      fetcher.mockImplementationOnce(async () => {
        if (change === 'conversation') changeDetail(); else if (change === 'provider') changeProvider(); else denyRead = true;
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '已经完成的模型回答' } }] }));
      });
      const preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
      await expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).rejects.toMatchObject({ code: 'CONVERSATION_REPLY_PENDING' });
      denyRead = false;
      await expect(commands.execute('readPendingConversationReply', { requestHash: preview.requestHash })).resolves.toMatchObject({ userContent: '当前需求草稿', assistantContent: '已经完成的模型回答', expectedRevision: 4 });
      expect(getDetail().messages).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('发送仍在进行时核对或放弃不得误报无回答，失败结束后可明确核对为不存在', async () => {
    const { commands, request, fetcher } = setup(); fetcher.mockImplementationOnce(async () => new Promise(() => undefined));
    const preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
    const pending = expect(commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true })).rejects.toThrow(/取消/);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    try {
      for (const command of ['readPendingConversationReply', 'discardConversationReply', 'retryConversationReply']) await expect(commands.execute(command, { requestHash: preview.requestHash })).rejects.toMatchObject({ code: 'CONVERSATION_IN_PROGRESS' });
    } finally { await commands.execute('cancelConversationAi', { confirmationToken: preview.confirmationToken }); await pending; }
    await expect(commands.execute('readPendingConversationReply', { requestHash: preview.requestHash })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('主进程已保存而外层执行回执丢失，可核对原回复与当前保存稿，绝不重发', async () => {
    const { commands, request, fetcher } = setup(), preview = await commands.execute('prepareConversationAi', request) as AiPreparedRequest;
    await commands.execute('executeConversationAi', { confirmationToken: preview.confirmationToken, requestHash: preview.requestHash, confirmed: true });
    // 模拟渲染层没有接收到成功回执，主进程的完成记录仍可供核对。
    await expect(commands.execute('readPendingConversationReply', { requestHash: preview.requestHash })).resolves.toMatchObject({ assistantContent: '创作讨论回答', currentDraft: '', currentRevision: 5 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
