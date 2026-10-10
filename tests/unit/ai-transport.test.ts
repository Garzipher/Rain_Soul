import { describe, expect, it, vi } from 'vitest';
import { aiCompletionEndpoint, sendAiCompletion } from '../../src/main/ai-transport';
import type { AiTransportDependencies, AiTransportRequest } from '../../src/main/ai-transport';

const provider = { id: 'cloud-default', name: '测试服务', baseUrl: 'https://api.example.com/v1', model: 'test' };
function fixture() {
  const credentials = { read: vi.fn(async () => 'isolated-test-secret') };
  const resolveHost = vi.fn(async () => ['8.8.8.8']);
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '完整回复' } }] })));
  const dependencies: AiTransportDependencies = { credentials, resolveHost, fetch: fetcher };
  const request: AiTransportRequest = { provider, url: 'https://api.example.com/v1/chat/completions', hostname: 'api.example.com', body: '{"messages":[]}' };
  return { dependencies, request, fetcher, credentials, resolveHost };
}
describe('正文与会话共享的云传输边界', () => {
  it('只构建公开HTTPS聊天端点，协议和IP拒绝规则一致', () => {
    expect(aiCompletionEndpoint(provider.baseUrl)).toEqual({ url: 'https://api.example.com/v1/chat/completions', hostname: 'api.example.com' });
    for (const url of ['http://api.example.com', 'https://127.0.0.1', 'https://a:b@api.example.com', 'https://api.example.com?key=bad']) expect(() => aiCompletionEndpoint(url)).toThrow();
  });
  it('冻结正文与凭据配置送入一次请求，完整文本才返回', async () => {
    const { dependencies, request, fetcher, credentials } = fixture();
    expect(await sendAiCompletion(request, dependencies, new AbortController().signal)).toBe('完整回复');
    expect(credentials.read).toHaveBeenCalledWith(provider.id, provider);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(request.url, expect.objectContaining({ redirect: 'error', body: request.body }));
  });
  it('DNS混合公开和私网地址整体拒绝，凭据不读取', async () => {
    const { dependencies, request, credentials, fetcher, resolveHost } = fixture(); resolveHost.mockResolvedValue(['8.8.8.8', '10.0.0.1']);
    await expect(sendAiCompletion(request, dependencies, new AbortController().signal)).rejects.toThrow(/公开/);
    expect(credentials.read).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('传输收到截断或密钥回显只返回安全错误', async () => {
    const { dependencies, request, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '半句' } }] })));
    await expect(sendAiCompletion(request, dependencies, new AbortController().signal)).rejects.toThrow(/截断/);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'isolated-test-secret' } }] })));
    await expect(sendAiCompletion(request, dependencies, new AbortController().signal)).rejects.toThrow(/敏感凭据/);
  });
  it.each(['value', 'field'])('结构化回复的%s中转义凭据也禁止返回到界面', async place => {
    const { dependencies, request, fetcher } = fixture();
    const escaped = '\\u0069solated-test-secret';
    const content = place === 'value' ? `{"suggestions":[{"technique":"${escaped}"}]}` : `{"${escaped}":"正常文本"}`;
    expect(content).not.toContain('isolated-test-secret');
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] })));
    await expect(sendAiCompletion(request, dependencies, new AbortController().signal)).rejects.toThrow('云端服务响应包含敏感凭据，已阻止展示。');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('正常JSON与非JSON正文均可返回，深层结构不绕过凭据检查', async () => {
    const { dependencies, request, fetcher } = fixture();
    const content = '{"suggestions":[],"text":"完整回复"}';
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content } }] })));
    expect(await sendAiCompletion(request, dependencies, new AbortController().signal)).toBe(content);
    const nested = '['.repeat(2000) + '"\\u0069solated-test-secret"' + ']'.repeat(2000);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: nested } }] })));
    await expect(sendAiCompletion(request, dependencies, new AbortController().signal)).rejects.toThrow(/敏感凭据/);
  });
  it.each(['https://[2001:0::1]', 'https://[2001::1]', 'https://[2001:0000:0000:0000:0000:0000:0000:1]'])('IPv6规范化后仍拒绝Teredo过渡地址 %s', baseUrl => {
    expect(() => aiCompletionEndpoint(baseUrl)).toThrow(/公开地址/);
  });
  it('DNS返回压缩Teredo或文档保留IPv6时，不读凭据也不发送', async () => {
    const { dependencies, request, resolveHost, credentials, fetcher } = fixture();
    for (const address of ['2001::1', '2001:0000::1', '2001:db8::1']) {
      resolveHost.mockResolvedValueOnce([address]);
      await expect(sendAiCompletion(request, dependencies, new AbortController().signal)).rejects.toThrow(/公开地址/);
    }
    expect(credentials.read).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
});
