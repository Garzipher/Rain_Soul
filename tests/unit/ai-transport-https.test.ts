import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendAiCompletion } from '../../src/main/ai-transport';

const network = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: network.request }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
interface Options { method: string; agent: boolean; signal: AbortSignal; lookup: (hostname: string, options: { all?: boolean }, callback: (...values: unknown[]) => void) => void }
class ResponseStream extends EventEmitter {
  statusCode: number | undefined = 200;
  destroy(reason: Error) { this.emit('error', reason); }
}
const provider = { id: 'cloud-default', name: '传输测试', baseUrl: 'https://api.example.com/v1', model: 'test' };
const request = { provider, url: 'https://api.example.com/v1/chat/completions', hostname: 'api.example.com', body: '{"messages":[]}' };
const credentials = { read: async () => 'isolated-https-secret' };
beforeEach(() => { network.request.mockReset(); network.lookup.mockReset(); network.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]); });
function response(body: string, statusCode: number | undefined = 200) {
  network.request.mockImplementation((_url: string, _options: Options, receive: (stream: ResponseStream) => void) => {
    const outgoing = new EventEmitter() as EventEmitter & { end: (body: string) => void };
    outgoing.end = () => { const incoming = new ResponseStream(); incoming.statusCode = statusCode; receive(incoming); queueMicrotask(() => { incoming.emit('data', Buffer.from(body)); incoming.emit('end'); }); };
    return outgoing;
  });
}
describe('固定公开IP的默认HTTPS通道', () => {
  it('不依赖注入fetch，实际构建POST并只允许已解析的地址进入lookup', async () => {
    response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '完整建议' } }] }));
    expect(await sendAiCompletion(request, { credentials }, new AbortController().signal)).toBe('完整建议');
    expect(network.lookup).toHaveBeenCalledWith(request.hostname, { all: true });
    const [url, options] = network.request.mock.calls[0] as [string, Options];
    expect(url).toBe(request.url); expect(options.method).toBe('POST'); expect(options.agent).toBe(false);
    const single = vi.fn(), all = vi.fn();
    options.lookup('attacker-changed.example.com', {}, single); options.lookup(request.hostname, { all: true }, all);
    expect(single).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(all).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]);
  });
  it('IP端点跳过DNS仍限定公开地址，无效地址DNS与异常lookup均拒绝', async () => {
    response(JSON.stringify({ choices: [{ message: { content: '完整建议' } }] }));
    expect(await sendAiCompletion({ ...request, url: 'https://8.8.8.8/v1/chat/completions', hostname: '8.8.8.8' }, { credentials }, new AbortController().signal)).toBe('完整建议');
    expect(network.lookup).not.toHaveBeenCalled();
    network.lookup.mockResolvedValueOnce([{ address: 'not-an-ip' }]);
    await expect(sendAiCompletion(request, { credentials }, new AbortController().signal)).rejects.toThrow(/公开/);
    network.lookup.mockRejectedValueOnce(new Error('sensitive-dns-error'));
    await expect(sendAiCompletion(request, { credentials }, new AbortController().signal)).rejects.toThrow(/无法确认/);
  });
  it('流式接收超过2MB立即关闭，不把过大回答交给解析器', async () => {
    response('x'.repeat(2000001));
    await expect(sendAiCompletion(request, { credentials }, new AbortController().signal)).rejects.toThrow(/连接失败/);
  });
  it('异常状态码或无状态只提示失败，不暴露服务响应', async () => {
    response('isolated-https-secret', 9999);
    await expect(sendAiCompletion(request, { credentials }, new AbortController().signal)).rejects.toThrow(/连接失败/);
    response('isolated-https-secret');
    const original = network.request.getMockImplementation()!;
    network.request.mockImplementation((url: string, options: Options, listener: (stream: ResponseStream) => void) => original(url, options, (stream: ResponseStream) => { stream.statusCode = undefined; listener(stream); }));
    await expect(sendAiCompletion(request, { credentials }, new AbortController().signal)).rejects.toThrow(/请求失败/);
  });
  it('客户端错误统一转换，无效凭据、超大JSON和坏JSON均不展示原始响应', async () => {
    network.request.mockImplementation(() => { const outgoing = new EventEmitter() as EventEmitter & { end: () => void }; outgoing.end = () => queueMicrotask(() => outgoing.emit('error', new Error('isolated-https-secret'))); return outgoing; });
    await expect(sendAiCompletion(request, { credentials }, new AbortController().signal)).rejects.toThrow('云端服务连接失败，请检查网络后手动重试。');
    await expect(sendAiCompletion(request, { credentials: { read: async () => null } }, new AbortController().signal)).rejects.toThrow(/有效/);
    await expect(sendAiCompletion(request, { credentials: { read: async () => 'invalid\nkey' } }, new AbortController().signal)).rejects.toThrow(/有效/);
    for (const body of ['invalid-json', 'x'.repeat(2000001)]) await expect(sendAiCompletion(request, { credentials, fetch: async () => new Response(body) }, new AbortController().signal)).rejects.toThrow(/格式无效|过大/);
  });
});
