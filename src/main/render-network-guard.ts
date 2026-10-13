import type { Session, WebContents } from 'electron';
import type { RenderResource } from './render-resource-broker';
import { createRenderDenyProxy } from './render-deny-proxy';
import { publicWebAddress } from './public-web-address';
import { renderLimits } from './restricted-render-policy';

type Broker = { fetch(url: string, type: string, signal?: AbortSignal, method?: string): Promise<RenderResource>; assertHealthy(): void; close(): Promise<void> };
export type RenderFailure = 'network' | 'permission' | 'authentication' | 'navigation' | 'download' | 'observer' | 'csp' | 'script' | 'connect';
export interface RenderNetworkGuard {
  readonly warnings: readonly string[];
  assertHealthy(): void; fail(type: RenderFailure): void; markObserverReady(): void;
  attachWebContents(contents: WebContents): void; close(): Promise<void>;
  waitForQuiet(deadline: number, signal: AbortSignal): Promise<void>;
}
const restrictiveCsp = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; img-src 'none'; font-src 'none'; media-src 'none'";
/** 仅用于新的一次性会话；宿主在首次导航前传入已校验原文并建立错误观察。 */
export async function installRenderNetworkGuard(session: Session, broker: Broker, signal: AbortSignal,
  initial: RenderResource & { finalUrl: string }): Promise<RenderNetworkGuard> {
  signal.throwIfAborted();
  if (session.isPersistent() || session.getPreloadScripts().length) throw new Error('受限渲染需要没有预加载的一次性会话。');
  const finalUrl = publicWebAddress(initial.finalUrl).url, origin = new URL(finalUrl).origin;
  if (await session.protocol.isProtocolHandled('https')) throw new Error('会话已有HTTPS处理，不能覆盖。');
  const proxy = await createRenderDenyProxy(), controller = new AbortController();
  const warnings: string[] = [], requests = new Map<string, { id: number; type: string }>();
  const active = new Set<number>(); let lastActivity = Date.now();
  let failed: RenderFailure | null = null, observerReady = false, closed = false, documentRequested = false, documentServed = false;
  let closing: Promise<void> | undefined, installed = false;
  let attached: WebContents | undefined;
  const warn = (value: string) => { if (!warnings.includes(value) && warnings.length < 4) warnings.push(value); };
  const fail = (type: RenderFailure) => { failed ??= type; controller.abort(new Error('受限渲染安全检查失败：' + failed)); };
  const abort = () => fail('network'); signal.addEventListener('abort', abort, { once: true });
  const healthy = () => { if (closed || failed || !observerReady || !attached || signal.aborted) throw new Error('受限渲染尚未通过完整性检查。'); proxy.assertHealthy(); broker.assertHealthy(); };
  const download = (event: Electron.Event) => { event.preventDefault(); fail('download'); };
  const login = (event: Electron.Event, _details: Electron.AuthenticationResponseDetails, _info: Electron.AuthInfo, callback: (username?: string, password?: string) => void) => {
    event.preventDefault(); callback(); fail('authentication');
  };
  const navigation = (event: Electron.Event) => { event.preventDefault(); fail('navigation'); };
  const waitForQuiet = async (deadline: number, cancellation: AbortSignal) => {
    const end = Math.min(deadline, Date.now() + renderLimits.maxQuietWaitMs), combined = AbortSignal.any([controller.signal, cancellation]);
    while (true) {
      healthy(); combined.throwIfAborted(); const now = Date.now();
      if (now >= end) { fail('network'); throw new Error('正文请求未在限定时间内安静结束。'); }
      if (!active.size && now - lastActivity >= renderLimits.quietPeriodMs) return;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(combined.reason); };
        const timer = setTimeout(() => { combined.removeEventListener('abort', abort); resolve(); }, Math.min(25, end - now));
        combined.addEventListener('abort', abort, { once: true });
      });
    }
  };
  const close = () => {
    closing ??= (async () => {
      closed = true; controller.abort(); await broker.close();
      // 任何关闭失败都保留协议/请求拒绝和代理，宿主必须阻止后续任务。
      await session.closeAllConnections(); await session.clearStorageData(); await session.clearAuthCache();
      if (installed) { session.protocol.unhandle('https'); session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, null); session.webRequest.onCompleted(null); session.webRequest.onErrorOccurred(null); }
      session.removeListener('will-download', download);
      attached?.removeListener('login', login); attached?.removeListener('will-navigate', navigation); attached?.removeListener('will-frame-navigate', navigation); attached?.removeListener('will-redirect', navigation);
      signal.removeEventListener('abort', abort); requests.clear(); active.clear(); await proxy.close();
    })(); return closing;
  };
  try {
    await session.setProxy({ mode: 'fixed_servers', proxyRules: proxy.proxyRules, proxyBypassRules: '<-loopback>' });
    await session.closeAllConnections(); signal.throwIfAborted();
    session.setPermissionCheckHandler(() => false);
    session.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); fail('permission'); });
    session.on('will-download', download);
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (closed || failed || signal.aborted) { callback({ cancel: true }); return; }
      const { resourceType: type, method, id } = details;
      let url: string;
      try { url = publicWebAddress(details.url).url; } catch { fail('network'); callback({ cancel: true }); return; }
      if (method !== 'GET') { fail('network'); callback({ cancel: true }); return; }
      if (['image', 'font', 'media'].includes(type)) { warn('图片、字体和媒体已限制加载。'); callback({ cancel: true }); return; }
      if (method !== 'GET' || new URL(url).origin !== origin || !['mainFrame', 'script', 'stylesheet', 'xhr'].includes(type)
        || type === 'mainFrame' && (documentRequested || url !== finalUrl) || requests.has(url) || active.size >= renderLimits.maxRequests) {
        fail(type === 'mainFrame' ? 'navigation' : 'network'); callback({ cancel: true }); return;
      }
      if (type === 'mainFrame') documentRequested = true;
      requests.set(url, { id, type }); active.add(id); lastActivity = Date.now(); callback({ cancel: false });
    });
    session.webRequest.onCompleted(details => { active.delete(details.id); lastActivity = Date.now(); for (const [url, entry] of requests) if (entry.id === details.id) requests.delete(url); });
    session.webRequest.onErrorOccurred(details => {
      active.delete(details.id); lastActivity = Date.now();
      if (['script', 'xhr', 'mainFrame'].includes(details.resourceType)) fail('network');
      else if (details.resourceType === 'stylesheet') warn('样式未完整加载。');
      for (const [url, entry] of requests) if (entry.id === details.id) requests.delete(url);
    });
    session.protocol.handle('https', async request => {
      let type: string | undefined;
      try {
        if (closed || failed || signal.aborted || request.method !== 'GET') throw new Error('捕获已停止。');
        const url = publicWebAddress(request.url).url, entry = requests.get(url);
        if (!entry) throw new Error('请求缺少可信宿主类型。'); requests.delete(url); type = entry.type;
        let resource: RenderResource;
        if (entry.type === 'mainFrame') { if (documentServed || url !== finalUrl) throw new Error('主文档不可重复加载。'); documentServed = true; resource = initial; }
        else resource = await broker.fetch(url, entry.type, controller.signal, request.method);
        const headers = new Headers(resource.headers); headers.append('content-security-policy', restrictiveCsp);
        headers.set('x-content-type-options', 'nosniff');
        return new Response(new Uint8Array(resource.bytes), { status: 200, headers });
      } catch {
        if (type === 'stylesheet' && !closed && !failed && !signal.aborted) {
          try { broker.assertHealthy(); proxy.assertHealthy(); warn('样式未完整加载。'); return new Response(null, { status: 403 }); } catch { /* 安全或预算失败必须终止。 */ }
        }
        fail('network'); return new Response(null, { status: 403 });
      }
    }); installed = true;
    return { warnings, assertHealthy: healthy, fail, markObserverReady() { if (!closed && !failed) observerReady = true; },
      attachWebContents(contents) {
        if (attached || contents.session !== session) throw new Error('渲染页面不属于一次性会话。'); attached = contents;
        contents.on('login', login); contents.on('will-navigate', navigation); contents.on('will-frame-navigate', navigation); contents.on('will-redirect', navigation);
        contents.setWindowOpenHandler(() => { fail('navigation'); return { action: 'deny' }; });
      }, close, waitForQuiet,
    };
  } catch (error) { try { await close(); } catch { throw new Error('受限网络防护安装失败且未完成清理。', { cause: error }); } throw error; }
}
