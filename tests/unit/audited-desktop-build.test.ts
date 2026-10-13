import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createPackage } from '@electron/asar';
import { afterEach, expect, it, vi } from 'vitest';
import { auditedDesktopBuild } from '../../scripts/audited-desktop-build.mjs';
import { createModelPackConfiguration } from '../../scripts/model-pack-policy.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('等待builder结束后才执行最终审计', async () => {
  let finishBuild!: (result: string[]) => void;
  const builder = new Promise<string[]>(resolve => { finishBuild = resolve; });
  const audit = vi.fn(async () => undefined);
  const operation = auditedDesktopBuild(() => builder, audit);
  await Promise.resolve();
  expect(audit).not.toHaveBeenCalled();
  const artifacts = ['安装器.exe']; finishBuild(artifacts);
  await expect(operation).resolves.toBe(artifacts);
  expect(audit).toHaveBeenCalledTimes(1);
});

it.each(['同步', '异步'])('builder%s失败时原样拒绝且不执行审计', async mode => {
  const failure = new Error('构建失败'), audit = vi.fn(async () => undefined);
  const build = () => { if (mode === '同步') throw failure; return Promise.reject(failure); };
  await expect(auditedDesktopBuild(build, audit)).rejects.toBe(failure);
  expect(audit).not.toHaveBeenCalled();
});

it('等待最终审计完成后才返回builder原始产物', async () => {
  let finishAudit!: () => void;
  const pendingAudit = new Promise<void>(resolve => { finishAudit = resolve; });
  const artifacts = ['安装器.exe', 'win-unpacked'];
  let completed = false;
  const audit = vi.fn(() => pendingAudit);
  const operation = auditedDesktopBuild(async () => artifacts, audit).then(result => { completed = true; return result; });
  await nextTurn();
  expect(audit).toHaveBeenCalledTimes(1);
  expect(completed).toBe(false);
  finishAudit();
  await expect(operation).resolves.toBe(artifacts);
});

it.each(['同步', '异步'])('最终审计%s失败时必须原样拒绝，不交付builder产物', async mode => {
  const failure = new Error('最终资源审计失败');
  const audit = () => { if (mode === '同步') throw failure; return Promise.reject(failure); };
  await expect(auditedDesktopBuild(async () => ['安装器.exe'], audit)).rejects.toBe(failure);
});

it('真实afterPack拒绝builder末尾追加的未知elevate.exe并保留此前完整报告', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rainsoul-final-audit-')); roots.push(root);
  mkdirSync(join(root, 'dist'));
  const packing = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model', '--installer'] });
  const appOutDir = join(packing.config.directories.output, 'win-unpacked'), resources = join(appOutDir, 'resources');
  mkdirSync(resources, { recursive: true });
  const stage = join(root, 'stage'); mkdirSync(stage); writeFileSync(join(stage, 'package.json'), '{}');
  await createPackage(stage, join(resources, 'app.asar'));
  await packing.config.afterPack({ appOutDir });
  const report = join(packing.config.directories.output, 'acceptance', 'desktop-package-audit.json');
  const previous = readFileSync(report, 'utf8');
  const build = async () => { writeFileSync(join(resources, 'elevate.exe'), '未知提升程序'); return ['安装器.exe']; };
  await expect(auditedDesktopBuild(build, () => packing.config.afterPack({ appOutDir }))).rejects.toThrow();
  expect(readFileSync(report, 'utf8')).toBe(previous);
});
