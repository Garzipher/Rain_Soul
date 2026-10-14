import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface DisplayState { visible: boolean; focused: boolean; minimized: boolean; backgroundThrottling: boolean }
interface NativeWindow {
  isVisible(): boolean; isFocused(): boolean; isMinimized(): boolean;
  restore(): void; show(): void; focus(): void;
  webContents: { getBackgroundThrottling(): boolean };
}
type ElectronInput = { BrowserWindow: { getAllWindows(): NativeWindow[] } };
const load = createRequire(import.meta.url);
const { restoreSearchWindow, readSearchWindow, isSearchDisplayValid, assertSearchDisplayValid } = load('../fixtures/search-display-state.cjs') as {
  restoreSearchWindow(input: ElectronInput): DisplayState;
  readSearchWindow(input: ElectronInput): DisplayState;
  isSearchDisplayValid(state: DisplayState): boolean;
  assertSearchDisplayValid(state: DisplayState, stage: string): void;
};
function nativeWindow(minimized = true, restoreEffective = true, showEffective = true) {
  const state: DisplayState = { visible: !minimized, focused: false, minimized, backgroundThrottling: false };
  const calls: string[] = [];
  const window: NativeWindow = {
    isVisible: () => state.visible, isFocused: () => state.focused, isMinimized: () => state.minimized,
    restore: () => { calls.push('restore'); if (restoreEffective) state.minimized = false; },
    show: () => { calls.push('show'); if (showEffective) state.visible = true; },
    focus: () => { calls.push('focus'); state.focused = state.visible && !state.minimized; },
    webContents: { getBackgroundThrottling: () => state.backgroundThrottling },
  };
  return { input: { BrowserWindow: { getAllWindows: () => [window] } }, state, calls };
}
describe('搜索性能样本的原生窗口状态门禁', () => {
  it('最小化窗口按 restore→show→focus 恢复，并读取真实可见状态', () => {
    const native = nativeWindow();
    expect(restoreSearchWindow(native.input)).toEqual({ visible: true, focused: true, minimized: false, backgroundThrottling: false });
    expect(native.calls).toEqual(['restore', 'show', 'focus']);
  });
  it('未最小化的窗口不调用 restore，但仍显示并聚焦', () => {
    const native = nativeWindow(false); restoreSearchWindow(native.input);
    expect(native.calls).toEqual(['show', 'focus']);
  });
  it('读取状态没有恢复副作用，保留测量结束时的最小化证据', () => {
    const native = nativeWindow(); expect(readSearchWindow(native.input)).toEqual(native.state);
    expect(native.calls).toEqual([]);
  });
  it.each([[false, true], [true, false]])('恢复失败 restore=%s/show=%s 时不把请求动作当成真实可用状态', (restoreEffective, showEffective) => {
    const native = nativeWindow(true, restoreEffective, showEffective), state = restoreSearchWindow(native.input);
    expect(isSearchDisplayValid(state)).toBe(false);
    expect(() => assertSearchDisplayValid(state, '输入前')).toThrow(/环境无效/);
  });
  it.each([{ visible: false, minimized: false }, { visible: true, minimized: true }])('结束状态%o无效时明确阻断，不恢复或静默丢弃样本', invalid => {
    const state = { ...invalid, focused: false, backgroundThrottling: false };
    expect(() => assertSearchDisplayValid(state, '测量结束')).toThrow(/环境无效.*测量结束/);
    expect(isSearchDisplayValid(state)).toBe(false);
  });
  it('正常可见结束状态通过；焦点单独保留为证据', () => {
    const state = { visible: true, focused: false, minimized: false, backgroundThrottling: false };
    expect(isSearchDisplayValid(state)).toBe(true);
    expect(() => assertSearchDisplayValid(state, '测量结束')).not.toThrow();
  });
});
