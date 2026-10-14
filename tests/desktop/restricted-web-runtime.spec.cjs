const { test, expect } = require('@playwright/test');

test('真实Electron动态正文、CSP提前拒绝与死循环取消清理', async () => {
  test.setTimeout(200000);
  const { qualifyRestrictedRender } = await import('../../scripts/qualify-restricted-render.mjs');
  const file = test.info().outputPath('restricted-render-runtime-report.json');
  const report = await qualifyRestrictedRender(file);
  await test.info().attach('受限渲染实际运行时证据', { path: file, contentType: 'application/json' });
  expect(report.productionCapability.enabled).toBe(false);
  expect(report.qualification).toEqual({ runtimeFixtures: 'passed', controlledTargets: 'passed', systemNetworkAudit: 'pending', realPackage: 'pending', networkIsolation: 'pending' });
  expect(report.executableSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.results).toHaveLength(8);
  for (const result of report.results) {
    expect(result.status, result.name + ': ' + (result.error ?? '')).toBe('passed');
    expect(result.remainingContents).toBe(0);
    expect(result.network.tcpConnections).toBe(0);
    expect(result.network.uploadBytes).toBe(0);
    expect(result.stages).toContain('observer-closed');expect(result.stages).toContain('guard-closed');
  }
  const dynamic = report.results.find(result => result.name === 'same-origin-script-fetch-xhr');
  expect(dynamic.requests.map(url => new URL(url).pathname)).toEqual(['/', '/article.js', '/fetch', '/xhr']);
  expect(dynamic.renderedDomHash).toMatch(/^[a-f0-9]{64}$/);
  for (const name of ['delayed-article', 'staged-article']) {
    const result = report.results.find(item => item.name === name);
    expect(result.error, name + ': ' + (result.error ?? '')).toBeUndefined();
    expect(result.renderedDomHash).toMatch(/^[a-f0-9]{64}$/);
  }
  for (const name of ['csp-cross-origin-script', 'csp-connect-caught']) {
    const result = report.results.find(result => result.name === name);
    expect(result.requests).toEqual(['https://capture.example.com/']);
    expect(result.stages.some(stage => stage.startsWith('guard-failed:'))).toBe(true);
  }
  const cancel = report.results.find(result => result.name === 'infinite-loop-cancel');
  expect(cancel.error).toContain('取消');expect(cancel.elapsedMs).toBeLessThan(10000);
});
