import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { createModelPackConfiguration } from '../../scripts/model-pack-policy.mjs';

const roots: string[] = [];
const require = createRequire(import.meta.url);
const minimatch = require('minimatch').minimatch as (path: string, pattern: string) => boolean;
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'rainsoul-pack-policy-')); roots.push(root); mkdirSync(join(root, 'dist')); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('默认builder配置实际挂接拒绝旁路门禁，显式研究配置替换该门禁', async () => {
  const packageConfig = JSON.parse(readFileSync('package.json', 'utf8')).build;
  expect(typeof packageConfig.beforePack).toBe('string');
  const { resolveFunction } = require('app-builder-lib/out/util/resolve') as { resolveFunction(type: string | undefined, hook: string | (() => Promise<void>), name: string, root: string): Promise<() => Promise<void>> };
  const beforePack = await resolveFunction(undefined, packageConfig.beforePack, 'beforePack', process.cwd());
  await expect(beforePack()).rejects.toThrow(/pack-desktop|直接/);
  const research = await createModelPackConfiguration({ projectDirectory: fixture(), args: ['--without-bundled-model'] });
  expect(typeof research.config.beforePack).toBe('function');
  const authorized = await resolveFunction(undefined, research.config.beforePack, 'beforePack', process.cwd());
  await expect(authorized()).resolves.toBeUndefined();
});
it('默认正式包缺模型时在调用builder前失败，不能静默生成无模型产物', async () => {
  await expect(createModelPackConfiguration({ projectDirectory: fixture(), args: [] })).rejects.toThrow();
});
it('正式包扫描准备父树，旧pending和未知revision不能只复制正确版本目录逃过检查', async () => {
  const root = fixture(); mkdirSync(join(root, 'dist', 'retrieval-model'));
  writeFileSync(join(root, 'dist', 'retrieval-model', '旧版本.pending'), '准备失败');
  await expect(createModelPackConfiguration({ projectDirectory: root, args: [] })).rejects.toThrow(/残留|准备|未知/);
});
it('显式无模型模式生成新的独立研究目录，并不复制旧dist模型', async () => {
  const root = fixture(); mkdirSync(join(root, 'dist', 'retrieval-model'));
  const first = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'] });
  const second = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'] });
  expect(first.mode).toBe('research-without-model'); expect(first.message).toMatch(/研究包.*未捆绑/);
  expect(first.config.directories.output).not.toBe(second.config.directories.output);
  expect(first.config.directories.output).toContain(join('release', 'research-without-model'));
  expect(first.config.extraResources).toEqual([{ from: join(root, 'dist', 'desktop', 'THIRD_PARTY_NOTICES.txt'), to: 'THIRD_PARTY_NOTICES.txt' }]);
  const appOutDir = join(root, 'package'); mkdirSync(join(appOutDir, 'resources'), { recursive: true });
  await expect(first.config.afterPack({ appOutDir })).resolves.toBeUndefined();
  mkdirSync(join(appOutDir, 'resources', 'retrieval-model'));
  await expect(first.config.afterPack({ appOutDir })).rejects.toThrow(/未捆绑|残留/);
});
it.each(['release/current', 'release', 'dist', 'dist/retrieval-model'])('研究输出%s不能覆盖正式包或构建输入', async output => {
  const root = fixture();
  await expect(createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'], outputDirectory: join(root, output) })).rejects.toThrow();
});
it('研究输出已有内容或junction时拒绝，不改作者已有文件', async () => {
  const root = fixture(), output = join(root, 'old'), target = join(root, 'outside'); mkdirSync(output); writeFileSync(join(output, '保留.txt'), '原产物'); mkdirSync(target); symlinkSync(target, join(root, 'linked'), 'junction');
  for (const path of [output, join(root, 'linked', 'new')]) await expect(createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'], outputDirectory: path })).rejects.toThrow();
  expect(readFileSync(join(output, '保留.txt'), 'utf8')).toBe('原产物');
});
it.each([{ args: ['--trusted-anchor', '{}'] }, { args: ['--manifest', '{}'] }, { args: ['--research'] }, { args: ['--unknown'] }])('CLI策略不接受外部锚或未知参数 $args', async ({ args }) => {
  await expect(createModelPackConfiguration({ projectDirectory: fixture(), args })).rejects.toThrow(/参数/);
});
it('正式包来源材料不能自证放行，即使外部提供看似可信协议也保持失败', async () => {
  const root = fixture(), revision = '75c43b069aac4d136ba6bc1122f995fedcfd2781', notices = join(root, 'dist', 'retrieval-model', revision, 'notices');
  mkdirSync(notices, { recursive: true }); mkdirSync(join(root, 'dist', 'retrieval-model', revision, 'weights'));
  writeFileSync(join(notices, 'provenance.json'), '{}');
  await expect(createModelPackConfiguration({ projectDirectory: root, args: [] })).rejects.toThrow(/可信锚|来源/);
});
it('builder文件规则保留程序/WASM但排除模型树，研究包与默认配置均不把权重混入ASAR', async () => {
  const root = fixture(), packing = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'] });
  const packageConfig = JSON.parse(readFileSync('package.json', 'utf8')).build;
  for (const patterns of [packing.config.files, packageConfig.files] as string[][]) {
    const accepted = (path: string) => patterns.some(pattern => !pattern.startsWith('!') && minimatch(path, pattern)) && patterns.every(pattern => !pattern.startsWith('!') || !minimatch(path, pattern.slice(1)));
    expect(accepted('dist/desktop/main.cjs')).toBe(true);
    expect(accepted('dist/desktop/retrieval-wasm/ort-wasm.wasm')).toBe(true);
    expect(accepted('dist/retrieval-model/revision/weights/onnx/model_quantized.onnx')).toBe(false);
    expect(accepted('dist/retrieval-model/revision.pending')).toBe(false);
  }
});
