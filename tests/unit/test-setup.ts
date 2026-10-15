// 覆盖率与真实 SQLite 同时启用时，8GB Windows 的首屏转换可能超过一秒。
// 只延长异步 DOM 等待预算，不延长产品保存/搜索的验收时限。
if (typeof document !== 'undefined') {
  // jsdom 不实现媒体查询；默认模拟宽屏桌面且不要求减少动态效果。
  // 保持可写、可配置，专项用例可通过 vi.stubGlobal 覆盖并模拟运行时变化。
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true,
      value: (query: string): MediaQueryList => {
        const events = new EventTarget();
        return { media: query, matches: false, onchange: null,
          addListener: listener => { if (listener) events.addEventListener('change', listener as EventListener); },
          removeListener: listener => { if (listener) events.removeEventListener('change', listener as EventListener); },
          addEventListener: events.addEventListener.bind(events),
          removeEventListener: events.removeEventListener.bind(events),
          dispatchEvent: events.dispatchEvent.bind(events),
        };
      },
    });
  }
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 5000 });
}
export {};
