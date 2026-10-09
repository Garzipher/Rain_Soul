import { describe, expect, it, vi } from 'vitest';
import { AiService } from '../../src/main/ai-service';
import type { AiPrepareRequest } from '../../src/shared/ai';
import { responseFromPublicHttp } from '../../src/main/ai-service';
const secret = 'unit-test-secret';
function request(): AiPrepareRequest { return { provider: { id: 'cloud', name: '自选云服务', baseUrl: 'https://api.example.com/v1', model: 'author-model' }, operation: 'paragraphPolish', context: { workId: crypto.randomUUID(), baselineRevision: 7, paragraphIds: [crypto.randomUUID()], scopeLabel: '当前章节', text: '窗外的雨落在旧站台。' } }; }
function setup(response: unknown = { choices: [{ message: { content: '雨丝拂过旧站台。' } }] }) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } }));
  const credentials = { read: vi.fn(async () => secret) };
  const resolveHost = vi.fn(async () => ['8.8.8.8']);
  let now = Date.parse('2026-10-09T00:00:00Z');
  const service = new AiService({ credentials, fetch: fetcher, resolveHost, now: () => now, timeoutMs: 1000, confirmationTtlMs: 10000 });
  return { service, fetcher, credentials, resolveHost, advance: (ms: number) => { now += ms; } };
}
describe('云端 AI 冻结、授权和候选保护', () => {
  it('云端总开关关闭时保留配置但不能准备发送、读取密钥或联网', () => {
    const { service, fetcher, credentials } = setup(), input = request();
    input.provider = { ...input.provider, enabled: false };
    expect(() => service.prepare(input)).toThrow(/关闭/);
    expect(fetcher).not.toHaveBeenCalled(); expect(credentials.read).not.toHaveBeenCalled();
  });
  it('精确单句选择随冻结请求传递，调用方后续修改不能改变候选替换范围', async () => {
    const { service } = setup(), input = request(); input.operation = 'sentencePolish';
    input.context.selection = { paragraphId: input.context.paragraphIds[0], from: 0, to: 3, text: '窗外的' };
    const original = structuredClone(input.context.selection), prepared = service.prepare(input);
    input.context.selection.text = '更改后的'; input.context.selection.to = 4;
    const result = await service.execute({ ...prepared, confirmed: true }); expect(result.selection).toEqual(original);
  });
  it('prepare 不读凭据不发送；确认后只发送冻结内容并保留基线，候选不改原文', async () => {
    const { service, fetcher, credentials } = setup(), input = request(), original = structuredClone(input);
    const prepared = service.prepare(input);
    expect(prepared).toMatchObject({ service: '自选云服务', model: 'author-model', scopeLabel: '当前章节' });
    expect(prepared.previewText).toContain(input.context.text);
    expect(prepared.billingHint).toMatch(/计费/);
    expect(fetcher).not.toHaveBeenCalled(); expect(credentials.read).not.toHaveBeenCalled();
    input.context.text = '不应发送的新内容'; input.provider.baseUrl = 'https://other.example.com'; input.context.paragraphIds.push(crypto.randomUUID());
    const candidate = await service.execute({ confirmationToken: prepared.confirmationToken, requestHash: prepared.requestHash, confirmed: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(options?.redirect).toBe('error');
    const payload = JSON.parse(options!.body as string);
    expect(payload.messages.at(-1).content).toContain(original.context.text);
    for (const message of payload.messages) expect(prepared.previewText).toContain(message.content);
    expect(JSON.stringify(payload)).not.toContain(input.context.text);
    expect(candidate).toMatchObject({ text: '雨丝拂过旧站台。', baselineRevision: 7, paragraphIds: original.context.paragraphIds, operation: 'paragraphPolish' });
    expect(JSON.stringify(candidate)).not.toContain(secret);
    await expect(service.execute({ confirmationToken: prepared.confirmationToken, requestHash: prepared.requestHash, confirmed: true })).rejects.toThrow(/失效|使用/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('没有明确确认、payload hash 不同和过期 token 均不发送', async () => {
    const { service, fetcher, advance } = setup(), prepared = service.prepare(request());
    await expect(service.execute({ confirmationToken: prepared.confirmationToken, requestHash: prepared.requestHash, confirmed: false })).rejects.toThrow(/确认/);
    await expect(service.execute({ confirmationToken: prepared.confirmationToken, requestHash: 'changed', confirmed: true })).rejects.toThrow(/确认|内容/);
    advance(10001);
    await expect(service.execute({ confirmationToken: prepared.confirmationToken, requestHash: prepared.requestHash, confirmed: true })).rejects.toThrow(/过期|失效/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['sentencePolish', 'paragraphPolish', 'continue', 'correct', 'consistency', 'plotFeel', 'extractKnowledge'] as const)('支持 %s 且仅返回待审核候选', async operation => {
    const { service } = setup(), input = request(); input.operation = operation;
    const prepared = service.prepare(input);
    expect(await service.execute({ ...prepared, confirmed: true })).toMatchObject({ operation, baselineRevision: 7 });
  });
});
describe('地址与故障保护', () => {
  it.each([204, 205, 304])('无正文状态 %s 不能构造带body响应或使进程崩溃', status => {
    const response = responseFromPublicHttp(status, Buffer.from('意外响应体'));
    expect(response.status).toBe(status); expect(response.body).toBeNull();
  });
  it('最终读取凭据时携带冻结模型配置，不能换服务后发送到旧域名', async () => {
    const { service, credentials } = setup(), input = request(), prepared = service.prepare(input);
    await service.execute({ ...prepared, confirmed: true });
    expect(credentials.read).toHaveBeenCalledWith(input.provider.id, input.provider);
  });
  it.each(['http://api.example.com', 'https://name:pass@api.example.com', 'https://localhost/v1', 'https://127.0.0.1', 'https://2130706433', 'https://10.1.2.3', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://169.254.169.254'])('拒绝非公开安全端点 %s', baseUrl => {
    const { service } = setup(), input = request(); input.provider.baseUrl = baseUrl;
    expect(() => service.prepare(input)).toThrow(/地址|HTTPS|公开/);
  });
  it('DNS 返回私网地址、缺凭据时不会发送，凭据异常不暴露原始错误', async () => {
    const { service, fetcher, resolveHost, credentials } = setup();
    resolveHost.mockResolvedValueOnce(['10.0.0.1']);
    let prepared = service.prepare(request());
    await expect(service.execute({ ...prepared, confirmed: true })).rejects.toThrow(/公开/);
    credentials.read.mockRejectedValueOnce(new Error(`无法解密${secret}`)); prepared = service.prepare(request());
    await expect(service.execute({ ...prepared, confirmed: true })).rejects.toThrow('无法读取云端服务凭据，请重新配置。');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 402, 429, 500])('HTTP %s 失败不重发且不暴露响应中的密钥', async status => {
    const { service, fetcher } = setup(); fetcher.mockResolvedValueOnce(new Response(secret, { status }));
    const prepared = service.prepare(request());
    await expect(service.execute({ ...prepared, confirmed: true })).rejects.toThrow(/服务|额度|认证/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('取消冻结请求后不发送；网络错误不重发，不泄露密钥', async () => {
    const { service, fetcher } = setup();
    const prepared = service.prepare(request()); service.cancel(prepared.confirmationToken);
    await expect(service.execute({ ...prepared, confirmed: true })).rejects.toThrow(/取消|失效/);
    const next = service.prepare(request()); fetcher.mockRejectedValueOnce(new Error(`网络出错：${secret}`));
    await expect(service.execute({ ...next, confirmed: true })).rejects.toThrow('云端服务连接失败，请检查网络后手动重试。');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('取消正在发送的请求会 abort，停止后不自动重新发送', async () => {
    const { service, fetcher } = setup();
    fetcher.mockImplementationOnce(async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true })));
    const prepared = service.prepare(request()), pending = service.execute({ ...prepared, confirmed: true });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); service.cancel(prepared.confirmationToken);
    await expect(pending).rejects.toThrow(/取消/); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('空或格式异常响应只提示失败，正文和候选不自动修改', async () => {
    const { service } = setup({ choices: [{ message: { content: '' } }] }), prepared = service.prepare(request());
    await expect(service.execute({ ...prepared, confirmed: true })).rejects.toThrow(/响应/);
  });
  it('响应回显凭据时拒绝返回候选', async () => {
    const { service } = setup({ choices: [{ message: { content: secret } }] }), prepared = service.prepare(request());
    await expect(service.execute({ ...prepared, confirmed: true })).rejects.toThrow(/敏感凭据/);
  });
  it('超时结束即使注入 fetch 未响应 abort 也不再发送', async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const service = new AiService({ fetch: fetcher, credentials: { read: async () => secret }, resolveHost: async () => ['8.8.8.8'], timeoutMs: 20 });
    const prepared = service.prepare(request());
    await expect(service.execute({ ...prepared, confirmed: true })).rejects.toThrow(/超时/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('上下文容量不足要求重新选范围，不静默截断', () => {
    const { service } = setup(), input = request(); input.provider.contextWindowTokens = 1024;
    expect(() => service.prepare(input)).toThrow(/超过模型容量/);
  });
});
