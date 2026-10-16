import { afterEach, describe, expect, it, vi } from 'vitest';
import { transitionPage } from '../../src/renderer/motion/page-transition';

afterEach(() => vi.unstubAllGlobals());
describe('页面动效导航保护', () => {
  it('组合输入或减少动态效果时直接提交一次', () => {
    const start = vi.fn(); vi.stubGlobal('document', { startViewTransition: start });
    const commit = vi.fn(); transitionPage(commit, { reduced: false, composing: true });
    expect(commit).toHaveBeenCalledOnce(); expect(start).not.toHaveBeenCalled();
  });
  it('接口同步失败后仍只提交一次', () => {
    vi.stubGlobal('document', { startViewTransition: (callback: () => void) => { callback(); throw Error('快照失败'); } });
    const commit = vi.fn(); transitionPage(commit, { reduced: false, composing: false });
    expect(commit).toHaveBeenCalledOnce();
  });
  it('连续导航不再提交已过时的回调', async () => {
    const callbacks: (() => void)[] = [];
    vi.stubGlobal('document', { startViewTransition: (callback: () => void) => { callbacks.push(callback); return { skipTransition: vi.fn(), ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() }; } });
    const first = vi.fn(), last = vi.fn();
    transitionPage(first, { reduced: false, composing: false }); transitionPage(last, { reduced: false, composing: false });
    callbacks.forEach(callback => callback()); await Promise.resolve();
    expect(first).not.toHaveBeenCalled(); expect(last).toHaveBeenCalledOnce();
  });
  it('浏览器跳过快照时消费ready拒绝，业务回调仍只执行一次', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      vi.stubGlobal('document', { startViewTransition: (callback: () => void) => {
        callback();
        return { skipTransition: vi.fn(), ready: Promise.reject(new DOMException('Transition was skipped', 'AbortError')),
          finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
      } });
      const commit = vi.fn();
      transitionPage(commit, { reduced: false, composing: false });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(commit).toHaveBeenCalledOnce();
    } finally { process.off('unhandledRejection', unhandled); }
  });
});
