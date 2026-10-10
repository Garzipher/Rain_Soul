import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPublicArticle, type PublicWebDependencies } from '../../src/main/public-web-transport';

type Reply = { status?: number; headers?: IncomingMessage['headers']; bytes?: Buffer; hanging?: boolean };
function fixture(replies: Reply[] = [{}]) {
  const incoming: IncomingMessage[] = [], outgoing: ClientRequest[] = [];
  const openRequest = vi.fn((...args: unknown[]) => {
    const receive = args[2] as (response: IncomingMessage) => void;
    const reply = replies.shift() ?? {};
    const raw = new PassThrough(), stream = raw as unknown as IncomingMessage;
    stream.statusCode = reply.status ?? 200; stream.headers = { 'content-type': 'text/html; charset=utf-8', ...reply.headers };
    incoming.push(stream);
    const request = new EventEmitter() as ClientRequest;
    request.destroy = vi.fn(() => request); request.end = vi.fn(() => {
      queueMicrotask(() => { receive(stream); if (!reply.hanging) raw.end(reply.bytes ?? Buffer.from('<p>公开正文</p>')); });
      return request;
    }) as ClientRequest['end']; outgoing.push(request); return request;
  });
  const resolveHost = vi.fn(async () => ['8.8.8.8', '2606:4700:4700::1111']);
  const dependencies: PublicWebDependencies = { openRequest: openRequest as unknown as PublicWebDependencies['openRequest'], resolveHost };
  return { dependencies, resolveHost, openRequest, incoming, outgoing };
}
afterEach(() => vi.useRealTimers());
describe('安全公开网页GET', () => {
  it('真实流完整返回，固定公开地址lookup且无凭据，截止时间供解析复用', async () => {
    const f = fixture(); f.dependencies.now = () => 1000;
    const result = await fetchPublicArticle('https://article.example.com/page', new AbortController().signal, f.dependencies);
    expect(result).toEqual({ bytes: Buffer.from('<p>公开正文</p>'), finalUrl: 'https://article.example.com/page', contentType: 'text/html; charset=utf-8', deadline: 31000 });
    const options = f.openRequest.mock.calls[0][1] as { method: string; agent: boolean; headers: Record<string, string>; lookup: (host: string, options: { all?: boolean }, callback: (...values: unknown[]) => void) => void };
    expect(options.method).toBe('GET'); expect(options.agent).toBe(false);
    expect(Object.keys(options.headers).map(key => key.toLowerCase())).not.toContain('authorization');
    expect(Object.keys(options.headers).map(key => key.toLowerCase())).not.toContain('cookie');
    const one = vi.fn(), all = vi.fn(); options.lookup('rebound.example.com', {}, one); options.lookup('rebound.example.com', { all: true }, all);
    expect(one).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(all).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]);
  });
  it('混合DNS整体拒绝，IP字面量目标不查询DNS', async () => {
    const f = fixture(); f.resolveHost.mockResolvedValueOnce(['8.8.8.8', '10.0.0.1']);
    await expect(fetchPublicArticle('https://article.example.com', new AbortController().signal, f.dependencies)).rejects.toThrow(/公开/);
    expect(f.openRequest).not.toHaveBeenCalled();
    await expect(fetchPublicArticle('https://8.8.8.8/', new AbortController().signal, f.dependencies)).rejects.toThrow(/地址/);
    expect(f.resolveHost).toHaveBeenCalledTimes(1);
  });
  it('逐跳重新解析并检查，拒绝私网重定向和同域DNS重绑定', async () => {
    const f = fixture([{ status: 302, headers: { location: '/next' } }]);
    f.resolveHost.mockResolvedValueOnce(['8.8.8.8']).mockResolvedValueOnce(['127.0.0.1']);
    await expect(fetchPublicArticle('https://article.example.com', new AbortController().signal, f.dependencies)).rejects.toThrow(/公开/);
    expect(f.resolveHost).toHaveBeenCalledTimes(2); expect(f.openRequest).toHaveBeenCalledTimes(1); expect(f.incoming[0].destroyed).toBe(true);
    for (const target of ['https://10.0.0.1/', 'http://article.example.com/', 'https://user:pass@article.example.com/', 'https://article.example.com:444/']) {
      const g = fixture([{ status: 301, headers: { location: target } }]);
      await expect(fetchPublicArticle('https://article.example.com', new AbortController().signal, g.dependencies)).rejects.toThrow(/地址/);
      expect(g.openRequest).toHaveBeenCalledTimes(1);
    }
  });
  it('三跳成功，第四跳、循环、缺Location均拒绝', async () => {
    const replies = [1, 2, 3].map(n => ({ status: 302, headers: { location: `/p${n}` } }));
    expect((await fetchPublicArticle('https://article.example.com/', new AbortController().signal, fixture([...replies, {}]).dependencies)).finalUrl).toBe('https://article.example.com/p3');
    for (const list of [[...replies, { status: 302, headers: { location: '/p4' } }], [{ status: 302, headers: { location: '/' } }], [{ status: 302 }]]) {
      await expect(fetchPublicArticle('https://article.example.com/', new AbortController().signal, fixture(list).dependencies)).rejects.toThrow(/重定向/);
    }
  });
  it.each([['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]] as const)('完整解压%s并保留正文原字节', async (encoding, compress) => {
    const bytes = Buffer.from('<p>正文与编码</p>'); const f = fixture([{ bytes: compress(bytes), headers: { 'content-encoding': encoding } }]);
    expect((await fetchPublicArticle('https://article.example.com', new AbortController().signal, f.dependencies)).bytes).toEqual(bytes);
  });
  it('流式拒绝压缩前/解压后超限，即使Content-Length伪称很小', async () => {
    for (const reply of [{ bytes: Buffer.alloc(2 * 1024 * 1024 + 1), headers: { 'content-length': '1' } }, { bytes: gzipSync(Buffer.alloc(5 * 1024 * 1024 + 1)), headers: { 'content-encoding': 'gzip' } }]) {
      const f = fixture([reply]); await expect(fetchPublicArticle('https://article.example.com', new AbortController().signal, f.dependencies)).rejects.toThrow(/大小/);
      expect(f.incoming[0].destroyed).toBe(true);
    }
  });
  it('拒绝错误状态、非HTML、未知压缩和截断压缩，不回显敏感响应', async () => {
    for (const reply of [{ status: 401 }, { headers: { 'content-type': 'application/pdf' } }, { headers: { 'content-encoding': 'unknown' } }, { bytes: gzipSync(Buffer.from('secret')).subarray(0, 12), headers: { 'content-encoding': 'gzip' } }]) {
      await expect(fetchPublicArticle('https://article.example.com', new AbortController().signal, fixture([{ ...reply, bytes: reply.bytes ?? Buffer.from('secret-token') }]).dependencies)).rejects.toThrow();
    }
    const f = fixture(); f.resolveHost.mockRejectedValue(new Error('secret-token'));
    await expect(fetchPublicArticle('https://article.example.com', new AbortController().signal, f.dependencies)).rejects.toThrow('网页获取失败，请检查网络后手动重试。');
  });
  it('取消悬挂DNS立即返回，晚解析不建立连接；30秒覆盖DNS等待', async () => {
    const f = fixture(); let finish!: (addresses: string[]) => void;
    f.dependencies.resolveHost = () => new Promise(resolve => { finish = resolve; });
    const controller = new AbortController(), pending = fetchPublicArticle('https://article.example.com', controller.signal, f.dependencies);
    const rejected = expect(pending).rejects.toThrow(/取消/); controller.abort(); await rejected; finish(['8.8.8.8']); await Promise.resolve(); expect(f.openRequest).not.toHaveBeenCalled();
    vi.useFakeTimers(); f.dependencies.resolveHost = () => new Promise(() => {});
    const timeout = expect(fetchPublicArticle('https://article.example.com', new AbortController().signal, f.dependencies)).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(30000); await timeout;
  });
  it('取消响应读取关闭请求与流，预先取消完全不联网', async () => {
    const f = fixture([{ hanging: true }]), controller = new AbortController();
    const pending = fetchPublicArticle('https://article.example.com', controller.signal, f.dependencies);
    const outcome = pending.catch(reason => reason as Error); await new Promise(resolve => setImmediate(resolve)); controller.abort();
    expect(await outcome).toEqual(expect.objectContaining({ message: expect.stringMatching(/取消/) }));
    expect(f.incoming[0].destroyed).toBe(true); expect(f.outgoing[0].destroy).toHaveBeenCalled();
    const g = fixture(); await expect(fetchPublicArticle('https://article.example.com', controller.signal, g.dependencies)).rejects.toThrow(/取消/); expect(g.resolveHost).not.toHaveBeenCalled();
  });
  it('注入网络错误即使伪装本地文案也不能泄漏敏感细节', async () => {
    const f = fixture(); f.resolveHost.mockRejectedValue(new Error('网页地址必须 secret-token'));
    await expect(fetchPublicArticle('https://article.example.com', new AbortController().signal, f.dependencies)).rejects.toThrow('网页获取失败，请检查网络后手动重试。');
  });
  it('连接等待可取消，不接受取消后的响应；跨跳共用原始截止时间', async () => {
    const f = fixture(); let receive!: (response: IncomingMessage) => void;
    const outgoing = new EventEmitter() as ClientRequest; outgoing.destroy = vi.fn(() => outgoing); outgoing.end = vi.fn(() => outgoing) as ClientRequest['end'];
    f.dependencies.openRequest = ((_url: unknown, _options: unknown, callback: unknown) => { receive = callback as typeof receive; return outgoing; }) as PublicWebDependencies['openRequest'];
    const controller = new AbortController(), outcome = fetchPublicArticle('https://article.example.com', controller.signal, f.dependencies).catch(reason => reason as Error);
    await new Promise(resolve => setImmediate(resolve)); controller.abort();
    expect(await outcome).toEqual(expect.objectContaining({ message: expect.stringMatching(/取消/) }));
    const late = new PassThrough() as unknown as IncomingMessage; receive(late); expect(late.destroyed).toBe(true); expect(outgoing.destroy).toHaveBeenCalled();
    const g = fixture([{ status: 302, headers: { location: '/next' } }]); let clock = 0; g.dependencies.now = () => clock;
    g.resolveHost.mockImplementation(async () => { clock = 30000; return ['8.8.8.8']; });
    await expect(fetchPublicArticle('https://article.example.com', new AbortController().signal, g.dependencies)).rejects.toThrow(/超时/);
    expect(g.openRequest).not.toHaveBeenCalled();
  });
});
