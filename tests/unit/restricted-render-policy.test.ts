import { describe, expect, it } from 'vitest';
import { evaluateRenderCapability, getWebRenderCapability, renderLimits } from '../../src/main/restricted-render-policy';

const identity = { packageSha256: 'a'.repeat(64), electronVersion: '44.7.0', platform: 'win32' };
const evidence = { ...identity, policyVersion: 1, networkIsolation: 'passed', cleanup: 'passed', realPackage: 'passed' };

describe('受限渲染资格门禁', () => {
  it('正式能力缺失受信构建资格时禁用', () => {
    expect(getWebRenderCapability()).toMatchObject({ enabled: false, policyVersion: 1 });
    expect(getWebRenderCapability().message.trim().length).toBeGreaterThan(0);
  });
  it.each([undefined, null, {}, { ...evidence, extra: true }, { ...evidence, policyVersion: 2 },
    { ...evidence, networkIsolation: 'pending' }, { ...evidence, cleanup: 'failed' }, { ...evidence, realPackage: 'pending' },
    { ...evidence, packageSha256: 'b'.repeat(64) }, { ...evidence, electronVersion: '44.7.1' }, { ...evidence, platform: 'linux' },
  ])('缺失、未通过或不匹配本构建的证据禁止启用 %j', value => {
    expect(evaluateRenderCapability(value, identity).enabled).toBe(false);
  });
  it('纯函数仅接受完全通过且属于本构建的资格', () => {
    expect(evaluateRenderCapability(evidence, identity)).toMatchObject({ enabled: true, policyVersion: 1 });
    expect(getWebRenderCapability().enabled).toBe(false);
  });
  it('策略预算不可被页面或调用者修改', () => {
    expect(() => Reflect.set(renderLimits, 'totalTimeoutMs', 999999)).not.toThrow();
    expect(renderLimits.totalTimeoutMs).toBe(40000);
    expect(Object.isFrozen(renderLimits)).toBe(true);
  });
});
