import { EventEmitter } from 'node:events';
import type { Session, WebContents, OnBeforeRequestListenerDetails } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { installRenderNetworkGuard, type RenderNetworkGuard } from '../../src/main/render-network-guard';

const guards: RenderNetworkGuard[] = [];
afterEach(async () => { await Promise.allSettled(guards.splice(0).map(guard => guard.close())); });
const initial = { finalUrl: 'https://article.example.com/page', bytes: Buffer.from('<p>文章</p>'), contentType: 'text/html; charset=utf-8', headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "script-src 'none'" } };
function fixture() {
  const events = new EventEmitter(), steps: string[] = [];
  let before: ((details: OnBeforeRequestListenerDetails, callback: (value: { cancel?: boolean }) => void) => void) | null = null;
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;
  const session = Object.assign(events, {
    isPersistent: (): boolean => false, getPreloadScripts: () => [],
    setProxy: vi.fn(async (_config: unknown) => { steps.push('proxy'); }),
    closeAllConnections: vi.fn(async () => { steps.push('connections'); }),
    clearStorageData: vi.fn(async () => { steps.push('storage'); }), clearAuthCache: vi.fn(async () => undefined),
    setPermissionCheckHandler: vi.fn<(handler: () => boolean) => void>(), setPermissionRequestHandler: vi.fn<(handler: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) => void>(),
    protocol: { isProtocolHandled: vi.fn(async () => false), handle: vi.fn((_scheme, value) => { handler = value; steps.push('handle'); }), unhandle: vi.fn(() => { steps.push('unhandle'); }) },
    webRequest: { onBeforeRequest: vi.fn((_filter, value) => { before = value; steps.push(value ? 'before' : 'remove-before'); }), onCompleted: vi.fn(), onErrorOccurred: vi.fn() },
  });
  const broker = { fetch: vi.fn(async () => ({ bytes: Buffer.from('const 文章=1;'), contentType: 'text/javascript', headers: { 'content-type': 'text/javascript' } })), assertHealthy: vi.fn(), close: vi.fn(async () => { steps.push('broker'); }) };
  const contents = Object.assign(new EventEmitter(), { session, setWindowOpenHandler: vi.fn() });
  const controller = new AbortController();
  return { session, broker, controller, steps, contents, async install(attach = true) { const guard = await installRenderNetworkGuard(session as unknown as Session, broker, controller.signal, initial); guards.push(guard); if (attach) guard.attachWebContents(contents as unknown as WebContents); return guard; },
    request(url: string, resourceType = 'script', method = 'GET', id = 1) { const result = vi.fn(); before!({ id, url, method, resourceType } as OnBeforeRequestListenerDetails, result); return result.mock.calls[0][0]; },
    serve(url: string, method = 'GET') { return handler!(new Request(url, { method })); },
    complete(id: number) { session.webRequest.onCompleted.mock.calls[0][0]({ id, resourceType: 'xhr' }); },
  };
}
it('代理就绪且旧连接关闭后才安装正文通道，移除环回绕过且没有直连回退', async () => {
  const f = fixture(); let ready!: () => void; f.session.setProxy.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
  const installed = f.install(); while (!ready) await new Promise(setImmediate);
  expect(f.session.protocol.handle).not.toHaveBeenCalled(); ready(); await installed;
  const config = f.session.setProxy.mock.calls[0][0] as { mode: string; proxyRules: string; proxyBypassRules: string };
  expect(config).toMatchObject({ mode: 'fixed_servers', proxyBypassRules: '<-loopback>' });
  expect(config.proxyRules).toMatch(/^http=127[.]0[.]0[.]1:[0-9]+;https=127[.]0[.]0[.]1:[0-9]+$/);
  expect(f.steps.indexOf('connections')).toBeLessThan(f.steps.indexOf('handle'));
});
it('只提供一次已校验初始文档，宿主类型关联脚本后才调用broker，原CSP共同生效', async () => {
  const f = fixture(); await f.install();
  expect(f.request(initial.finalUrl, 'mainFrame')).toEqual({ cancel: false });
  const response = await f.serve(initial.finalUrl); expect(await response.text()).toBe('<p>文章</p>');
  const csp = response.headers.get('content-security-policy')!;
  expect(csp).toContain("script-src 'none'"); expect(csp).toContain("worker-src 'none'"); expect(csp).toContain("connect-src 'self'");
  expect(f.broker.fetch).not.toHaveBeenCalled();
  expect(f.request('https://article.example.com/script', 'script', 'GET', 2)).toEqual({ cancel: false });
  expect((await f.serve('https://article.example.com/script')).status).toBe(200);
  expect(f.broker.fetch).toHaveBeenCalledWith('https://article.example.com/script', 'script', expect.any(AbortSignal), 'GET');
});
it.each([['wss://article.example.com/socket', 'webSocket', 'GET'], ['http://article.example.com/a', 'script', 'GET'], ['https://article.example.com/a', 'xhr', 'POST'], ['https://cdn.example.com/a', 'script', 'GET'], ['file:///private', 'mainFrame', 'GET'], ['https://article.example.com/frame', 'subFrame', 'GET']])('安全拒绝 %s 后健康检查失败且不进入broker', async (url, type, method) => {
  const f = fixture(), guard = await f.install(); expect(f.request(url, type, method)).toEqual({ cancel: true });
  expect(() => guard.assertHealthy()).toThrow(); expect(f.broker.fetch).not.toHaveBeenCalled();
});
it('图片字体媒体只增加限制警告，缺少关联或重复主导航仍使任务失败', async () => {
  const f = fixture(), guard = await f.install();
  for (const type of ['image', 'font', 'media']) expect(f.request('https://article.example.com/asset', type)).toEqual({ cancel: true });
  expect(guard.warnings.length).toBeGreaterThan(0);
  expect((await f.serve('https://article.example.com/unobserved')).status).toBe(403); expect(() => guard.assertHealthy()).toThrow();
  const g = fixture(), other = await g.install(); g.request(initial.finalUrl, 'mainFrame');
  expect(g.request(initial.finalUrl, 'mainFrame', 'GET', 2)).toEqual({ cancel: true }); expect(() => other.assertHealthy()).toThrow();
});
it('全部权限和下载拒绝，认证不提供凭据，页面导航和弹窗不能逃逸', async () => {
  const f = fixture(), guard = await f.install(); const callback = vi.fn();
  expect(f.session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
  f.session.setPermissionRequestHandler.mock.calls[0][0](null, 'media', callback); expect(callback).toHaveBeenCalledWith(false);
  const preventDefault = vi.fn(), credentials = vi.fn(); f.contents.emit('login', { preventDefault }, {}, {}, credentials);
  expect(preventDefault).toHaveBeenCalled(); expect(credentials).toHaveBeenCalledWith(); expect(() => guard.assertHealthy()).toThrow();
  const g = fixture(), other = await g.install(), download = vi.fn(); g.session.emit('will-download', { preventDefault: download }); expect(download).toHaveBeenCalled();
  expect(() => other.assertHealthy()).toThrow();
});
it('未绑定属于该session的webContents不能声明认证与导航防护完整', async () => {
  const f = fixture(), guard = await f.install(false); guard.markObserverReady(); expect(() => guard.assertHealthy()).toThrow();
  guard.attachWebContents(f.contents as unknown as WebContents); expect(() => guard.assertHealthy()).not.toThrow();
  const denied = f.contents.setWindowOpenHandler.mock.calls[0][0](); expect(denied).toEqual({ action: 'deny' }); expect(() => guard.assertHealthy()).toThrow();
});
it.each([['file:///private', 'GET'], ['https://127.0.0.1/private', 'GET'], ['https://article.example.com/upload', 'POST']])('非正文图片也不能隐藏非法协议/私网/上传尝试 %s', async (url, method) => {
  const f = fixture(), guard = await f.install(); guard.markObserverReady(); expect(f.request(url, 'image', method)).toEqual({ cancel: true });
  expect(() => guard.assertHealthy()).toThrow();
});
it('先关闭broker和session网络再撤协议，清理失败保留防护并向宿主报错', async () => {
  const f = fixture(), guard = await f.install(); await guard.close(); await guard.close();
  expect(f.steps.indexOf('broker')).toBeLessThan(f.steps.lastIndexOf('connections'));
  expect(f.steps.lastIndexOf('connections')).toBeLessThan(f.steps.indexOf('unhandle'));
  const g = fixture(), other = await g.install(); g.session.closeAllConnections.mockRejectedValue(new Error('关闭失败'));
  await expect(other.close()).rejects.toThrow('关闭失败'); expect(g.session.protocol.unhandle).not.toHaveBeenCalled();
});
it('持久会话、预加载脚本与已取消信号不能安装防护', async () => {
  const f = fixture(); f.session.isPersistent = () => true; await expect(f.install()).rejects.toThrow();
  const g = fixture(); g.session.getPreloadScripts = () => [{ id: 'unsafe', type: 'frame', filePath: '/unsafe' }] as never; await expect(g.install()).rejects.toThrow();
  const h = fixture(); h.controller.abort(); await expect(h.install()).rejects.toThrow();
});
it('没有可信错误观察时不得声明健康，观察建立后失败不能被重新置为健康', async () => {
  const f = fixture(), guard = await f.install(); expect(() => guard.assertHealthy()).toThrow();
  guard.markObserverReady(); expect(() => guard.assertHealthy()).not.toThrow();
  guard.fail('csp'); guard.markObserverReady(); expect(() => guard.assertHealthy()).toThrow();
});
it('普通CSS失败只警告，broker安全或预算失败不能作为样式缺失继续', async () => {
  const f = fixture(), guard = await f.install(); guard.markObserverReady();
  f.broker.fetch.mockRejectedValue(new Error('样式连接失败')); f.request('https://article.example.com/style', 'stylesheet');
  expect((await f.serve('https://article.example.com/style')).status).toBe(403); expect(() => guard.assertHealthy()).not.toThrow(); expect(guard.warnings).toContain('样式未完整加载。');
  const g = fixture(), other = await g.install(); other.markObserverReady(); g.broker.fetch.mockRejectedValue(new Error('超限'));
  g.broker.assertHealthy.mockImplementation(() => { throw new Error('超限'); }); g.request('https://article.example.com/style', 'stylesheet');
  await g.serve('https://article.example.com/style'); expect(() => other.assertHealthy()).toThrow();
});
it('只有全部允许请求结束且安静500ms才继续，有请求或事件会重新等待', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(), guard = await f.install(); guard.markObserverReady(); f.request('https://article.example.com/api', 'xhr', 'GET', 1);
    let finished = false; const quiet = guard.waitForQuiet(Date.now() + 40000, f.controller.signal).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(600); expect(finished).toBe(false);
    f.complete(1); await vi.advanceTimersByTimeAsync(499); expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(26); await quiet; expect(finished).toBe(true);
  } finally { vi.useRealTimers(); }
});
it('等待安静受五秒、总期限与取消限制，不返回未完成文章', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(), guard = await f.install(); guard.markObserverReady(); f.request('https://article.example.com/api', 'xhr');
    const quiet = guard.waitForQuiet(Date.now() + 40000, f.controller.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(5000); expect(await quiet).toBeInstanceOf(Error);
    const g = fixture(), other = await g.install(); other.markObserverReady();
    const expired = other.waitForQuiet(Date.now() + 100, g.controller.signal).catch(error => error); await vi.advanceTimersByTimeAsync(100); expect(await expired).toBeInstanceOf(Error);
    const h = fixture(), last = await h.install(); last.markObserverReady();
    const cancelled = last.waitForQuiet(Date.now() + 40000, h.controller.signal).catch(error => error); h.controller.abort(); expect(await cancelled).toBeInstanceOf(Error);
  } finally { vi.useRealTimers(); }
});
