import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { RenderFailure } from './render-network-guard';

type Guard = { fail(type: RenderFailure): void; markObserverReady(): void };
export interface RenderErrorObserver { close(mode?: 'terminate'): Promise<void> }
/** 首次导航前调用；在隔离世界的文档创建脚本中注册监听，页面没有应用API。 */
export async function installRenderErrorObserver(contents: WebContents, guard: Guard): Promise<RenderErrorObserver> {
  const debuggerApi = contents.debugger;
  if (debuggerApi.isAttached()) throw new Error('受限错误观察不能复用已有调试会话。');
  const token = randomUUID(), binding = 'rainCapture_' + randomUUID().replaceAll('-', ''), world = 'RainSoulCapture_' + randomUUID();
  const contexts = new Set<number>();
  let frame: string | undefined, scriptId: string | undefined, closed = false, closing: Promise<void> | undefined;
  const source = `(() => {
    const notify = window[${JSON.stringify(binding)}].bind(window);
    const encode = JSON.stringify;
    let sent = 0;
    const report = type => { if (sent++ < 8) notify(encode({ token: ${JSON.stringify(token)}, type })); };
    window.addEventListener('securitypolicyviolation', event => {
      const directive = event.effectiveDirective;
      if (directive.startsWith('script-src')) report('script');
      else if (directive === 'connect-src') report('connect');
      else if (!['img-src', 'font-src', 'media-src', 'style-src', 'style-src-elem', 'style-src-attr'].includes(directive)) report('csp');
    }, true);
    window.addEventListener('error', event => { if (event.target?.tagName !== 'LINK' && event.target?.tagName !== 'IMG') report('script'); }, true);
    window.addEventListener('unhandledrejection', () => report('connect'), true);
    report('ready');
  })();`;
  const failure = () => { if (!closed) guard.fail('observer'); };
  const message = (_event: Electron.Event, method: string, params: Record<string, unknown>) => {
    if (closed) return;
    if (method === 'Runtime.executionContextCreated') {
      const context = params.context as { id?: unknown; name?: unknown; auxData?: { frameId?: unknown; isDefault?: unknown } } | undefined;
      if (context?.name === world && context.auxData?.frameId === frame && context.auxData?.isDefault === false && typeof context.id === 'number') contexts.add(context.id);
    } else if (method === 'Runtime.executionContextDestroyed' && contexts.has(params.executionContextId as number)) failure();
    else if (method === 'Runtime.executionContextsCleared' && contexts.size) failure();
    else if (method === 'Network.loadingFailed') {
      if (params.type === 'Fetch' || params.type === 'XHR') guard.fail('connect');
      else if (params.type === 'Script') guard.fail('script');
      else if (params.type === 'Document') guard.fail('navigation');
    }
    else if (method === 'Runtime.bindingCalled' && params.name === binding) {
      if (!contexts.has(params.executionContextId as number) || typeof params.payload !== 'string' || params.payload.length > 128) { failure(); return; }
      let data: unknown;
      try { data = JSON.parse(params.payload); } catch { failure(); return; }
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 2 || !('token' in data) || data.token !== token || !('type' in data)) { failure(); return; }
      if (data.type === 'ready') guard.markObserverReady();
      else if (data.type === 'script' || data.type === 'connect' || data.type === 'csp') guard.fail(data.type);
      else failure();
    }
  };
  const close = (mode?: 'terminate') => {
    closing ??= (async () => {
      closed = true; debuggerApi.removeListener('message', message); debuggerApi.removeListener('detach', failure);
      // 取消后宿主紧接着销毁独立任务窗口；CDP命令和同步detach都可能被死循环阻塞。
      if (mode === 'terminate') return;
      try {
        if (scriptId) await debuggerApi.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
        await debuggerApi.sendCommand('Runtime.removeBinding', { name: binding });
      } finally { debuggerApi.detach(); }
    })(); return closing;
  };
  try {
    debuggerApi.attach('1.3'); debuggerApi.on('message', message); debuggerApi.on('detach', failure);
    await debuggerApi.sendCommand('Page.enable'); await debuggerApi.sendCommand('Runtime.enable'); await debuggerApi.sendCommand('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 });
    const tree = await debuggerApi.sendCommand('Page.getFrameTree') as { frameTree?: { frame?: { id?: unknown } } };
    if (typeof tree.frameTree?.frame?.id !== 'string') throw new Error('无法验证受限主frame。'); frame = tree.frameTree.frame.id;
    await debuggerApi.sendCommand('Runtime.addBinding', { name: binding, executionContextName: world });
    const installed = await debuggerApi.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source, worldName: world }) as { identifier?: unknown };
    if (typeof installed.identifier !== 'string') throw new Error('无法验证受限观察脚本。'); scriptId = installed.identifier;
    return { close };
  } catch (error) { guard.fail('observer'); try { await close(); } catch { /* 安装失败仍拒绝结果，宿主继续销毁窗口。 */ } throw error; }
}
