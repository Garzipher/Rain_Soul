import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { expect, it, vi } from 'vitest';
import { installRenderErrorObserver } from '../../src/main/render-error-observer';

function fixture() {
  const debuggerApi = Object.assign(new EventEmitter(), {
    isAttached: (): boolean => false, attach: vi.fn(), detach: vi.fn(),
    sendCommand: vi.fn(async (method: string, _parameters?: unknown) => method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } } : method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'script-1' } : {}),
  });
  const guard = { fail: vi.fn(), markObserverReady: vi.fn() };
  return { debuggerApi, guard, contents: { debugger: debuggerApi } as unknown as WebContents,
    message(method: string, parameters: unknown) { debuggerApi.emit('message', {}, method, parameters); },
    script() { return debuggerApi.sendCommand.mock.calls.find(([method]) => method === 'Page.addScriptToEvaluateOnNewDocument')?.[1] as unknown as { source: string; worldName: string }; },
  };
}
it('首次导航前注册隔离世界脚本；只允许同一主frame上下文的受限binding通知观察已建立', async () => {
  const f = fixture(), observer = await installRenderErrorObserver(f.contents, f.guard);
  const script = f.script(), binding = f.debuggerApi.sendCommand.mock.calls.find(([method]) => method === 'Runtime.addBinding')?.[1] as unknown as { name: string; executionContextName: string };
  expect(script.worldName).toBe(binding.executionContextName);
  expect(f.guard.markObserverReady).not.toHaveBeenCalled();
  const events = new Map<string, (event: Record<string, unknown>) => void>();
  const messages: string[] = [];
  const window = { addEventListener(type: string, listener: (event: Record<string, unknown>) => void) { events.set(type, listener); }, [binding.name]: (payload: string) => messages.push(payload) };
  new Function('window', script.source)(window);
  f.message('Runtime.executionContextCreated', { context: { id: 7, name: script.worldName, auxData: { frameId: 'main', isDefault: false } } });
  f.message('Runtime.bindingCalled', { name: binding.name, executionContextId: 7, payload: messages[0] });
  expect(f.guard.markObserverReady).toHaveBeenCalledOnce();
  events.get('securitypolicyviolation')!({ effectiveDirective: 'connect-src' });
  f.message('Runtime.bindingCalled', { name: binding.name, executionContextId: 7, payload: messages[1] });
  expect(f.guard.fail).toHaveBeenCalledWith('connect'); await observer.close();
});
it('伪造上下文、未知类型与超长binding消息不能置为健康', async () => {
  const f = fixture(), observer = await installRenderErrorObserver(f.contents, f.guard);
  const binding = f.debuggerApi.sendCommand.mock.calls.find(([method]) => method === 'Runtime.addBinding')?.[1] as unknown as { name: string };
  f.message('Runtime.bindingCalled', { name: binding.name, executionContextId: 99, payload: '{}' });
  f.message('Runtime.bindingCalled', { name: binding.name, executionContextId: 99, payload: 'a'.repeat(1025) });
  expect(f.guard.markObserverReady).not.toHaveBeenCalled(); expect(f.guard.fail).toHaveBeenCalledWith('observer'); await observer.close();
});
it('脚本在早期注册错误和CSP监听，不回传页面文本，样式限制不误判正文失败', async () => {
  const f = fixture(), observer = await installRenderErrorObserver(f.contents, f.guard), messages: string[] = [];
  const listeners = new Map<string, (event: Record<string, unknown>) => void>(), binding = f.debuggerApi.sendCommand.mock.calls.find(([method]) => method === 'Runtime.addBinding')?.[1] as unknown as { name: string };
  new Function('window', f.script().source)({ addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => listeners.set(type, listener), [binding.name]: (payload: string) => messages.push(payload) });
  const types = () => messages.map(value => JSON.parse(value).type);
  listeners.get('securitypolicyviolation')!({ effectiveDirective: 'img-src', blockedURI: 'secret' });
  listeners.get('error')!({ target: { tagName: 'LINK' }, message: '作者文本' }); expect(types()).toEqual(['ready']);
  listeners.get('error')!({ target: { tagName: 'SCRIPT' }, message: '作者文本' });
  listeners.get('unhandledrejection')!({ reason: '作者文本' });
  expect(types()).toEqual(['ready', 'script', 'connect']); expect(messages.join('')).not.toContain('作者文本'); await observer.close();
});
it('观察上下文销毁或debugger断开使结果无效；close清除脚本和binding且不会新增失败', async () => {
  const f = fixture(), observer = await installRenderErrorObserver(f.contents, f.guard), worldName = f.script().worldName;
  f.message('Runtime.executionContextCreated', { context: { id: 7, name: worldName, auxData: { frameId: 'main', isDefault: false } } });
  f.message('Runtime.executionContextDestroyed', { executionContextId: 7 }); expect(f.guard.fail).toHaveBeenCalledWith('observer');
  await observer.close(); await observer.close();
  expect(f.debuggerApi.sendCommand).toHaveBeenCalledWith('Page.removeScriptToEvaluateOnNewDocument', { identifier: 'script-1' });
  expect(f.debuggerApi.detach).toHaveBeenCalledOnce();
  f.guard.fail.mockClear(); f.debuggerApi.emit('detach', {}, 'closed'); expect(f.guard.fail).not.toHaveBeenCalled();
});
it('已有调试会话或CDP注册失败拒绝安装且清理自己建立的会话', async () => {
  const f = fixture(); f.debuggerApi.isAttached = () => true; await expect(installRenderErrorObserver(f.contents, f.guard)).rejects.toThrow(); expect(f.debuggerApi.detach).not.toHaveBeenCalled();
  const g = fixture(); g.debuggerApi.sendCommand.mockRejectedValue(new Error('CDP失败')); await expect(installRenderErrorObserver(g.contents, g.guard)).rejects.toThrow(); expect(g.debuggerApi.detach).toHaveBeenCalledOnce(); expect(g.guard.fail).toHaveBeenCalledWith('observer');
});
it('即使页面自行捕获请求错误，宿主网络失败仍拒绝fetch/XHR与脚本结果', async () => {
  const f = fixture(), observer = await installRenderErrorObserver(f.contents, f.guard);
  f.message('Network.loadingFailed', { type: 'Fetch', errorText: '作者文本' }); expect(f.guard.fail).toHaveBeenCalledWith('connect');
  f.message('Network.loadingFailed', { type: 'XHR', errorText: '作者文本' }); expect(f.guard.fail).toHaveBeenCalledWith('connect');
  f.message('Network.loadingFailed', { type: 'Script' }); expect(f.guard.fail).toHaveBeenCalledWith('script');
  f.guard.fail.mockClear(); f.message('Network.loadingFailed', { type: 'Image' }); expect(f.guard.fail).not.toHaveBeenCalled();
  await observer.close();
});
