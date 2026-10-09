import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { validateReleaseEvidence, windowsCases, cloudOperations } from '../../scripts/release-gate.mjs';

const hash = 'a'.repeat(64);
function complete() {
  return { version: '1.0.4', installerSha256: hash,
    windows: ['Windows 10', 'Windows 11'].flatMap(os => windowsCases.map(testCase => ({
      os, case: testCase, osBuild: os === 'Windows 10' ? '19045.1' : '26100.1', standardUser: true, isolation: 'vm',
      version: '1.0.4', installerSha256: hash, date: '2026-10-09', result: 'passed',
      expectedOutcome: testCase === 'uninstall-cancel' ? 'cancelled' : testCase === 'uninstall-running-refusal' ? 'refused' : 'completed',
      exitCode: testCase === 'uninstall-running-refusal' ? 2 : 0, expectedExitCode: testCase === 'uninstall-running-refusal' ? 2 : 0,
      assetsVerified: true, checks: { programState: true, authorDataState: true, externalBackupUnchanged: true },
      artifacts: { screenshot: ['screens/test.png'], journal: 'journal/test.txt' },
      ...(testCase === 'upgrade' ? { oldVersion: '1.0.3', oldInstallerSha256: 'b'.repeat(64) } : {}),
    }))),
    cloud: cloudOperations.map(operation => ({ operation, version: '1.0.4', result: 'passed', date: '2026-10-09', realService: true,
      service: '验收专用云', serviceUrl: 'https://provider.example.com/v1', model: '实测模型', syntheticOnly: true, authorized: true,
      noCredentialsInArtifacts: true, noAutoRetry: true, responseCompatibility: true, requestHash: hash,
      billingEvidence: 'screens/billing.png', billingDescription: '0 USD，免费模型', authorizationEvidence: 'screens/authorize.png',
      responseEvidence: 'journal/redacted-response.json', noAutoRetryEvidence: 'journal/network-count.txt', artifacts: { screenshot: ['screens/cloud.png'], journal: 'journal/cloud.txt' },
    })) };
}
it('空输入、缺少矩阵/云证据不能通过；完整声明仅表示证据结构齐全', () => {
  expect(validateReleaseEvidence(null).status).toBe('blocked');
  expect(validateReleaseEvidence({}).issues.length).toBeGreaterThan(15);
  const result = validateReleaseEvidence(complete());
  expect(result).toEqual(expect.objectContaining({ status: 'evidence-complete', schemaOnly: true, issues: [] }));
  expect(result.warning).toContain('真实性');
});
it('逐格校验真实环境、哈希/版本、资产结果、截图/日志与预期退出码', () => {
  const input = complete();
  input.windows[0].standardUser = false; input.windows[1].isolation = 'same-account-directory';
  input.windows[2].installerSha256 = 'c'.repeat(64); input.windows[3].result = 'failed';
  input.windows[4].checks.authorDataState = false; input.windows[5].expectedExitCode = 0;
  input.windows[6].artifacts.screenshot = []; input.windows[7].osBuild = ''; input.windows[8].oldInstallerSha256 = '';
  const result = validateReleaseEvidence(input);
  expect(result.status).toBe('blocked');
  for (const key of ['standardUser', 'isolation', 'installerSha256', 'result', 'authorDataState', 'exitCode', 'screenshot', 'osBuild', 'oldInstallerSha256']) {
    expect(result.issues.some(item => item.path.includes(key))).toBe(true);
  }
});
it('未知、重复、遗漏矩阵和过期版本不能冒充覆盖；成功安装不能接受非零退出码', () => {
  const input = complete(); input.windows.pop(); input.windows.push({ ...input.windows[0] });
  input.windows[0].exitCode = 9; input.windows[0].expectedExitCode = 9; input.windows[1].case = 'unsupported';
  input.cloud[0].version = '1.0.3'; input.cloud[1].date = '2026-02-30';
  const result = validateReleaseEvidence(input);
  expect(result.issues.some(item => item.message.includes('重复'))).toBe(true);
  expect(result.issues.some(item => item.message.includes('缺少'))).toBe(true);
  expect(result.issues.some(item => item.path.endsWith('exitCode'))).toBe(true);
  expect(result.issues.some(item => item.path.endsWith('date'))).toBe(true);
});
it('真实云每操作均需授权、费用、返回格式、无自动重试与无凭据证据', () => {
  const input = complete(); input.cloud[0].realService = false; input.cloud[1].syntheticOnly = false;
  input.cloud[2].authorized = false; input.cloud[3].billingEvidence = ''; input.cloud[4].responseCompatibility = false;
  input.cloud[5].noAutoRetry = false; input.cloud[6].noCredentialsInArtifacts = false;
  expect(validateReleaseEvidence(input).issues).toHaveLength(7);
  input.cloud[0].serviceUrl = 'http://127.0.0.1:8999'; input.cloud[1].model = ''; input.cloud[2].requestHash = '假哈希';
  expect(validateReleaseEvidence(input).issues.length).toBeGreaterThan(7);
});
it('CLI只读证据，blocked返回2；不能把pending模板当成功，损坏JSON返回1', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-release-gate-')), path = join(directory, 'evidence.json');
  try {
    writeFileSync(path, JSON.stringify({ version: '1.0.4', installerSha256: '', windows: [], cloud: [] }));
    const before = readFileSync(path, 'utf-8');
    const blocked = spawnSync(process.execPath, ['scripts/release-gate.mjs', path], { encoding: 'utf-8' });
    expect(blocked.status).toBe(2); expect(JSON.parse(blocked.stdout).status).toBe('blocked'); expect(readFileSync(path, 'utf-8')).toBe(before);
    writeFileSync(path, JSON.stringify(complete()));
    expect(spawnSync(process.execPath, ['scripts/release-gate.mjs', path]).status).toBe(0);
    writeFileSync(path, '\ufeff' + JSON.stringify(complete()));
    expect(spawnSync(process.execPath, ['scripts/release-gate.mjs', path]).status).toBe(0);
    writeFileSync(path, '{');
    expect(spawnSync(process.execPath, ['scripts/release-gate.mjs', path]).status).toBe(1);
    expect(spawnSync(process.execPath, ['scripts/release-gate.mjs']).status).toBe(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
