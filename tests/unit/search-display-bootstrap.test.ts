import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const bootstrap = readFileSync(resolve('tests/fixtures/search-display-bootstrap.cjs'), 'utf8');
function environment(initial = '', ready = false, ignoreAppend = false) {
  const switches = new Map([['disable-features', initial], ['enable-features', '保留其他配置']]);
  const calls: [string, string][] = [];
  const app = { isReady: () => ready, commandLine: {
    getSwitchValue: (name: string) => switches.get(name) ?? '',
    appendSwitch: (name: string, value: string) => { calls.push([name, value]); if (!ignoreAppend) switches.set(name, value); },
  } };
  return { switches, calls, run: () => runInNewContext(bootstrap, { require: (name: string) => {
    if (name !== 'electron') throw new Error('测试配置只能访问 Electron');
    return { app };
  } }) };
}

describe('搜索性能窗口的测试专用预加载', () => {
  it('在 ready 前合并遮挡开关，保留 Playwright 已配置的完整列表及其他开关', () => {
    const state = environment('PaintHolding,MediaRouter,ThirdPartyStoragePartitioning'); state.run();
    expect(state.switches.get('disable-features')).toBe('PaintHolding,MediaRouter,ThirdPartyStoragePartitioning,CalculateNativeWinOcclusion');
    expect(state.switches.get('enable-features')).toBe('保留其他配置');
    expect(state.calls).toHaveLength(1);
  });
  it('原列表为空时仍能配置正式生效的遮挡开关', () => {
    const state = environment(); state.run();
    expect(state.switches.get('disable-features')).toBe('CalculateNativeWinOcclusion');
  });
  it('原列表已包含目标时不重复追加，空白和空成员不产生额外开关', () => {
    const state = environment(' PaintHolding, ,CalculateNativeWinOcclusion,PaintHolding'); state.run();
    expect(state.switches.get('disable-features')).toBe('PaintHolding,CalculateNativeWinOcclusion');
  });
  it('已 ready 的运行时拒绝配置，避免写入不能影响初始化行为的开关', () => {
    const state = environment('PaintHolding', true);
    expect(state.run).toThrow(/ready/); expect(state.calls).toHaveLength(0);
  });
  it('配置未被运行时接受时明确失败，不把请求参数冒充真实生效证据', () => {
    const state = environment('PaintHolding', false, true);
    expect(state.run).toThrow(/未生效/);
  });
});

it('开发入口把测试预加载排在主模块之前，由 Playwright 在最前插入其 loader', async () => {
  const helper = readFileSync(resolve('tests/desktop/structure-helper.cjs'), 'utf8');
  const load = createRequire(import.meta.url), calls: { args: string[] }[] = [];
  const module = { exports: {} as { launch?: (directory: string, args: string[]) => Promise<unknown> } };
  runInNewContext(helper, { module, process: { env: {} }, require: (name: string) => name === '@playwright/test'
    ? { _electron: { launch: async (options: { args: string[] }) => { calls.push(options); return { process: () => ({}) }; } } }
    : load(name) });
  await module.exports.launch!('隔离测试目录', ['-r', 'display-bootstrap.cjs']);
  expect(calls[0].args).toEqual(['-r', 'display-bootstrap.cjs', resolve('dist/desktop/main.cjs')]);
});
