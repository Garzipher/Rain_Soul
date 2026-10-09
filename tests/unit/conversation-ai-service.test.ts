import { describe, expect, it, vi } from 'vitest';
import { ConversationAiService } from '../../src/main/conversation-ai-service';
import type { ConversationAiInput } from '../../src/shared/conversation-ai';

function input(): ConversationAiInput {
  return { workId: crypto.randomUUID(), conversationId: crypto.randomUUID(), expectedRevision: 3, provider: { id: 'cloud-default', name: '隔离服务', baseUrl: 'https://api.example.com/v1', model: 'test' },
    messages: [{ role: 'user', content: '历史问题' }, { role: 'assistant', content: '历史建议' }], draft: '当前需求', instruction: '只提问题' };
}
function setup(timeoutMs = 1000) {
  let now = 1000;
  const credentials = { read: vi.fn(async () => 'conversation-test-secret') };
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '会话回答' } }] })));
  const service = new ConversationAiService({ credentials, fetch: fetcher, resolveHost: async () => ['8.8.8.8'], now: () => now, confirmationTtlMs: 100, timeoutMs });
  return { service, credentials, fetcher, advance: () => { now += 101; } };
}
describe('需求会话专属授权与完整回答', () => {
  it('准备仅冻结历史及草稿，逐项预览，确认前不读凭据或联网', async () => {
    const { service, credentials, fetcher } = setup(), original = input(), request = structuredClone(original), preview = service.prepare(request);
    expect(preview.paragraphIds).toEqual([]); expect(preview.scopeLabel).toMatch(/会话/); expect(preview.billingHint).toMatch(/计费/);
    expect(credentials.read).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    request.draft = '不应发送'; request.messages[0].content = '历史已变'; request.provider.baseUrl = 'https://changed.example.com';
    const result = await service.execute({ ...preview, confirmed: true });
    expect(result).toEqual({ text: '会话回答', requestHash: preview.requestHash });
    const [url, options] = fetcher.mock.calls[0], body = JSON.parse(options!.body as string);
    expect(url).toBe('https://api.example.com/v1/chat/completions'); expect(body.messages.slice(1)).toEqual([...original.messages, { role: 'user', content: original.draft }]);
    expect(body.messages[0].content).toContain('只提问题'); expect(body.messages[0].content).not.toContain('润色指定段落');
    for (const message of body.messages) expect(preview.previewText).toContain(message.content);
    expect(JSON.stringify(result)).not.toContain('conversation-test-secret');
    await expect(service.execute({ ...preview, confirmed: true })).rejects.toThrow(/过期|使用/); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('未确认、篡改hash与过期均不发送', async () => {
    const { service, fetcher, advance } = setup(), preview = service.prepare(input());
    await expect(service.execute({ ...preview, confirmed: false })).rejects.toThrow(/确认/);
    await expect(service.execute({ ...preview, requestHash: 'changed', confirmed: true })).rejects.toThrow(/一致|确认/);
    advance(); await expect(service.execute({ ...preview, confirmed: true })).rejects.toThrow(/过期/); expect(fetcher).not.toHaveBeenCalled();
  });
  it('关闭云功能、空草稿或超长历史拒绝且不静默截断', () => {
    const { service, fetcher } = setup(), request = input();
    expect(() => service.prepare({ ...request, provider: { ...request.provider, enabled: false } })).toThrow(/关闭/);
    expect(() => service.prepare({ ...request, draft: '  ' })).toThrow(/草稿|内容/);
    expect(() => service.prepare({ ...request, messages: [{ role: 'user', content: '字'.repeat(200000) }] })).toThrow(/过长|范围|容量/);
    expect(() => service.prepare({ ...request, provider: { ...request.provider, contextWindowTokens: 1024 } })).toThrow(/容量/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('发送前最后一次状态核对失败，凭据即使读取也不能发送', async () => {
    const { service, fetcher } = setup(), preview = service.prepare(input());
    await expect(service.execute({ ...preview, confirmed: true }, { beforeSend: async () => { throw new Error('会话已变化'); } })).rejects.toThrow(/会话已变化/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('取消预览与发送中的请求保留状态，不自动重发', async () => {
    const { service, fetcher } = setup(), preview = service.prepare(input()); service.cancel(preview.confirmationToken);
    await expect(service.execute({ ...preview, confirmed: true })).rejects.toThrow(/过期|取消/);
    fetcher.mockImplementationOnce(async () => new Promise(() => undefined));
    const next = service.prepare(input()), pending = expect(service.execute({ ...next, confirmed: true })).rejects.toThrow(/取消/);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); service.cancel(next.confirmationToken);
    await pending; expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('超时即使网络不响应取消也结束且不重发', async () => {
    const { service, fetcher } = setup(20); fetcher.mockImplementationOnce(async () => new Promise(() => undefined));
    const preview = service.prepare(input()); await expect(service.execute({ ...preview, confirmed: true })).rejects.toThrow(/超时/); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['length', 'content_filter', 'tool_calls', 'unknown'])('非完整响应 %s 不作为可保存回答', async finish_reason => {
    const { service, fetcher } = setup(); fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: '半段回答' } }] })));
    const preview = service.prepare(input()); await expect(service.execute({ ...preview, confirmed: true })).rejects.toThrow(/完整|截断|过滤|工具/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('临时预览过期后自动清理，取消旧预览可释放100项上限', () => {
    const { service, advance } = setup();
    const first = service.prepare(input());
    for (let index = 1; index < 100; index++) service.prepare(input());
    expect(() => service.prepare(input())).toThrow(/过多/);
    service.cancel(first.confirmationToken); expect(() => service.prepare(input())).not.toThrow();
    advance(); expect(() => service.prepare(input())).not.toThrow();
  });
  it('外部取消信号在执行前或执行期间取消也不得发送或重发', async () => {
    const { service, fetcher } = setup(), before = new AbortController(); before.abort();
    let preview = service.prepare(input());
    await expect(service.execute({ ...preview, confirmed: true }, { signal: before.signal })).rejects.toThrow(/取消/); expect(fetcher).not.toHaveBeenCalled();
    const during = new AbortController(); fetcher.mockImplementationOnce(async () => new Promise(() => undefined)); preview = service.prepare(input());
    const pending = expect(service.execute({ ...preview, confirmed: true }, { signal: during.signal })).rejects.toThrow(/取消/);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); during.abort(); await pending;
  });
  it('分页历史明确披露最近条数与总数，范围说明进入真正发送的系统消息', async () => {
    const { service, fetcher } = setup(), request = { ...input(), totalMessageCount: 305 }, preview = service.prepare(request);
    expect(preview.scopeLabel).toContain('最近2条/共305条'); expect(preview.scopeLabel).toContain('早期未发送');
    await service.execute({ ...preview, confirmed: true });
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string); expect(body.messages[0].content).toContain(preview.scopeLabel); expect(body.messages).toHaveLength(4);
  });
});
