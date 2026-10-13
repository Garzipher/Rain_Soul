import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { RenderResourceBroker } from '../../src/main/render-resource-broker';

type Reply = { status?: number; headers?: IncomingMessage['headers']; bytes?: Buffer; hanging?: boolean };
function fixture(replies: Reply[] = [{}]) {
  const streams: IncomingMessage[] = [];
  const openRequest = vi.fn((...args: unknown[]) => {
    const receive = args[2] as (response: IncomingMessage) => void, reply = replies.shift() ?? {};
    const raw = new PassThrough(), response = raw as unknown as IncomingMessage;
    response.statusCode = reply.status ?? 200; response.headers = { 'content-type': 'text/html; charset=utf-8', ...reply.headers }; streams.push(response);
    const request = new EventEmitter() as ClientRequest;
    request.destroy = vi.fn(() => request);
    request.end = vi.fn(() => { queueMicrotask(() => { receive(response); if (!reply.hanging) raw.end(reply.bytes ?? Buffer.from('<p>原文</p>')); }); return request; }) as ClientRequest['end'];
    return request;
  });
  const resolveHost = vi.fn(async () => ['8.8.8.8']);
  const broker = new RenderResourceBroker({ initialUrl: 'https://article.example.com/', deadline: Date.now() + 40000, signal: new AbortController().signal, dependencies: { resolveHost, openRequest: openRequest as never } });
  return { broker, openRequest, resolveHost, streams };
}
afterEach(() => vi.useRealTimers());
it('初始重定向固定最终origin，脚本只读同源且固定公网IP；过滤状态头和旧长度', async () => {
  const f = fixture([{ status: 302, headers: { location: 'https://final.example.com/article' }, bytes: Buffer.from('跳转') }, { headers: { 'set-cookie': ['secret'], refresh: '0;url=https://bad.example.com', link: '<https://bad.example.com>;rel=prefetch', 'content-security-policy': "script-src 'self'", 'content-length': '999' } }, { headers: { 'content-type': 'text/javascript' }, bytes: Buffer.from('document.body.textContent="文章"') }]);
  const initial = await f.broker.initialize();
  expect(initial.finalUrl).toBe('https://final.example.com/article');
  expect(initial.headers['set-cookie']).toBeUndefined(); expect(initial.headers.refresh).toBeUndefined(); expect(initial.headers.link).toBeUndefined();
  expect(initial.headers['content-length']).toBe(String(initial.bytes.length));
  expect(initial.headers['content-security-policy']).toBe("script-src 'self'");
  const script = await f.broker.fetch('https://final.example.com/main.js', 'script');
  expect(script.bytes.toString()).toContain('文章');
  await expect(f.broker.fetch('https://article.example.com/main.js', 'script')).rejects.toThrow(/同源/);
  const options = f.openRequest.mock.calls[2][1] as { lookup: (h: string,o: object,c: (...v: unknown[]) => void) => void; headers: Record<string,string> };
  const lookup = vi.fn(); options.lookup('rebound', {}, lookup); expect(lookup).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  expect(options.headers.Cookie).toBeUndefined(); expect(options.headers.Authorization).toBeUndefined();
  await f.broker.close();
});
it('任何混合私网DNS拒绝，脚本与fetch跨源跳转、坏MIME、POST、凭据和不可识别类型拒绝', async () => {
  const privateTarget = fixture(); privateTarget.resolveHost.mockResolvedValue(['8.8.8.8','127.0.0.1']);
  await expect(privateTarget.broker.initialize()).rejects.toThrow(/公开/); expect(privateTarget.openRequest).not.toHaveBeenCalled();
  for (const reply of [{ status:302, headers:{ location:'https://cdn.example.com/x' } }, { headers:{ 'content-type':'application/pdf' } }]) {
    const f = fixture([{},reply]); await f.broker.initialize();
    await expect(f.broker.fetch('https://article.example.com/api', 'xhr')).rejects.toThrow(); await f.broker.close();
  }
  const f = fixture(); await f.broker.initialize();
  for (const [url,type,method] of [['https://u:p@article.example.com/x','script','GET'],['https://article.example.com/x','script','POST'],['https://article.example.com/x','other','GET']] as const)
    await expect(f.broker.fetch(url,type,undefined,method)).rejects.toThrow();
  await f.broker.close();
});
it('解压后长度与编码正确，重定向正文计入任务总预算而非只计最终HTML', async () => {
  const content = Buffer.from('const 中文 = 1;');
  const f = fixture([{}, { headers:{ 'content-type':'text/javascript','content-encoding':'gzip','content-length':'1' }, bytes:gzipSync(content) }]);
  await f.broker.initialize(); const result = await f.broker.fetch('https://article.example.com/main.js','script');
  expect(result.bytes).toEqual(content); expect(result.headers['content-encoding']).toBeUndefined(); expect(result.headers['content-length']).toBe(String(content.length)); await f.broker.close();
  const g = fixture([{}, ...Array.from({length:7},(_,i)=>({status:302,headers:{location:`/jump${i+1}`},bytes:Buffer.alloc(2*1024*1024)}))]);
  await g.broker.initialize();
  await expect(g.broker.fetch('https://article.example.com/api','xhr')).rejects.toThrow();
  expect(g.streams.every(s=>s.destroyed)).toBe(true); await g.broker.close();
});
it('请求总数包含初始文档，第81次不联网；累计展开超过24MiB则终止', async () => {
  const f = fixture([{},...Array.from({length:79},()=>({headers:{'content-type':'application/json'},bytes:Buffer.from('{}')}))]);
  await f.broker.initialize(); for(let i=0;i<79;i++) await f.broker.fetch(`https://article.example.com/api${i}`,'xhr');
  await expect(f.broker.fetch('https://article.example.com/api80','xhr')).rejects.toThrow(/请求/); expect(f.openRequest).toHaveBeenCalledTimes(80); await f.broker.close();
  const g = fixture([{},...Array.from({length:5},()=>({headers:{'content-type':'text/plain','content-encoding':'gzip'},bytes:gzipSync(Buffer.alloc(5*1024*1024))}))]);
  await g.broker.initialize(); for(let i=0;i<4;i++) await g.broker.fetch(`https://article.example.com/a${i}`,'xhr');
  await expect(g.broker.fetch('https://article.example.com/a4','xhr')).rejects.toThrow(/总|累计/); await g.broker.close();
});
it('最多四并发，取消排队与悬挂请求，迟到DNS不得连接', async () => {
  const f = fixture([{},...Array.from({length:4},()=>({hanging:true,headers:{'content-type':'application/json'}}))]);
  await f.broker.initialize(); const pending = Array.from({length:5},(_,i)=>f.broker.fetch(`https://article.example.com/a${i}`,'xhr').catch(e=>e));
  await new Promise(r=>setImmediate(r)); expect(f.openRequest).toHaveBeenCalledTimes(5);
  await f.broker.close(); const errors=await Promise.all(pending); expect(errors.every(e=>e instanceof Error)).toBe(true); expect(f.streams.every(s=>s.destroyed)).toBe(true);
  const g=fixture(); let done!: (a:string[])=>void; g.resolveHost.mockImplementation(()=>new Promise(r=>{done=r;}));
  const result=g.broker.initialize().catch(e=>e); await g.broker.close(); expect(await result).toBeInstanceOf(Error); done(['8.8.8.8']); await Promise.resolve(); expect(g.openRequest).not.toHaveBeenCalled();
});
it('40秒总期限覆盖DNS，初始阶段30秒即结束，后续不可启动', async () => {
  vi.useFakeTimers(); const f=fixture(); f.resolveHost.mockImplementation(()=>new Promise(()=>{}));
  const result=f.broker.initialize().catch(e=>e); await vi.advanceTimersByTimeAsync(30000); expect((await result).message).toMatch(/超时|期限/);
  await expect(f.broker.fetch('https://article.example.com/a','script')).rejects.toThrow(); expect(f.openRequest).not.toHaveBeenCalled(); await f.broker.close();
});
it('正文接口失败终止整个任务，单资源超限后不再建立后续连接', async () => {
  for(const reply of [{headers:{'content-type':'application/pdf'}}, {headers:{'content-type':'text/plain'},bytes:Buffer.alloc(2*1024*1024+1)}]) {
    const f=fixture([{},reply]); await f.broker.initialize();
    await expect(f.broker.fetch('https://article.example.com/api','xhr')).rejects.toThrow();
    await expect(f.broker.fetch('https://article.example.com/next','script')).rejects.toThrow();
    expect(f.openRequest).toHaveBeenCalledTimes(2); await f.broker.close();
  }
});
it.each([
  ['https://other.example.com/x', 'script', 'GET'],
  ['https://u:p@article.example.com/x', 'script', 'GET'],
  ['https://article.example.com/x', 'stylesheet', 'POST'],
  ['https://article.example.com/x', 'webSocket', 'GET'],
])('安全拒绝 %s 后终止整个任务', async (url,type,method) => {
  const f=fixture(); await f.broker.initialize();
  await expect(f.broker.fetch(url,type,undefined,method)).rejects.toThrow();
  await expect(f.broker.fetch('https://article.example.com/next','xhr')).rejects.toThrow();
  expect(f.openRequest).toHaveBeenCalledTimes(1); await f.broker.close();
});
it('CSS超过单资源预算终止全任务，普通CSS获取失败可以继续', async () => {
  const oversized=fixture([{}, {headers:{'content-type':'text/css'},bytes:Buffer.alloc(2*1024*1024+1)}]);
  await oversized.broker.initialize();
  await expect(oversized.broker.fetch('https://article.example.com/style.css','stylesheet')).rejects.toThrow();
  await expect(oversized.broker.fetch('https://article.example.com/next','xhr')).rejects.toThrow();
  expect(oversized.openRequest).toHaveBeenCalledTimes(2); await oversized.broker.close();
  const ordinary=fixture([{}, {status:404}, {headers:{'content-type':'application/json'},bytes:Buffer.from('{}')}]);
  await ordinary.broker.initialize();
  await expect(ordinary.broker.fetch('https://article.example.com/style.css','stylesheet')).rejects.toThrow();
  expect((await ordinary.broker.fetch('https://article.example.com/next','xhr')).bytes.toString()).toBe('{}');
  await ordinary.broker.close();
});
it('四连接挂起时请求预算在入队前生效，取消全部等待', async () => {
  const f=fixture([{},...Array.from({length:4},()=>({hanging:true,headers:{'content-type':'application/json'}}))]);
  await f.broker.initialize();
  const requests=Array.from({length:80},(_,i)=>f.broker.fetch(`https://article.example.com/a${i}`,'xhr').catch(e=>e));
  const result=await Promise.race([requests[79],new Promise(resolve=>setTimeout(()=>resolve(null),100))]);
  expect(result).toBeInstanceOf(Error);
  await f.broker.close(); expect((await Promise.all(requests)).every(e=>e instanceof Error)).toBe(true);
  expect(f.openRequest.mock.calls.length).toBeLessThanOrEqual(5);
});
