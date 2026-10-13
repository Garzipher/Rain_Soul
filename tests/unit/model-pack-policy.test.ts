import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { createPackage } from '@electron/asar';
import { createModelPackConfiguration } from '../../scripts/model-pack-policy.mjs';

const roots: string[] = [];
const failures = vi.hoisted(() => ({ rename: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: async (...args: Parameters<typeof actual.rename>) => {
    if (failures.rename) throw new Error('模拟原子替换失败');
    return actual.rename(...args);
  } };
});
const require = createRequire(import.meta.url);
const minimatch = require('minimatch').minimatch as (path: string, pattern: string) => boolean;
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'rainsoul-pack-policy-')); roots.push(root); mkdirSync(join(root, 'dist')); return root; };
afterEach(() => { failures.rename = false; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
// 实际builder首次require会冷加载发布依赖树，覆盖率与低内存磁盘换页时超过默认5秒。
it('实际builder合并默认与授权配置后，许可声明只复制一次并保留门禁', async () => {
  const root = fixture();
  const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
  writeFileSync(join(root, 'package.json'), JSON.stringify(metadata));
  const packing = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'] });
  const { getConfig } = require('app-builder-lib/out/util/config/config') as typeof import('app-builder-lib/out/util/config/config');
  const effective = await getConfig(root, null, packing.config);
  const notices = (effective.extraResources as { from: string; to: string }[]).filter(resource => resource.to === 'THIRD_PARTY_NOTICES.txt');
  expect(notices).toEqual([{ from: join(root, 'dist', 'desktop', 'THIRD_PARTY_NOTICES.txt'), to: 'THIRD_PARTY_NOTICES.txt' }]);
  expect(effective.beforePack).toBe(packing.config.beforePack);
  expect(effective.afterPack).toBe(packing.config.afterPack);
}, 60000);
it('安装器显式关闭更新配置推断，实际builder不生成更新服务配置', async () => {
  const packing = await createModelPackConfiguration({ projectDirectory: fixture(), args: ['--without-bundled-model', '--installer'] });
  expect(packing.config).toHaveProperty('publish', null);
  const { getAppUpdatePublishConfiguration } = require('app-builder-lib/out/publish/PublishManager');
  const packager = { config: packing.config, platformSpecificBuildOptions: {}, info: { config: packing.config } };
  expect(await getAppUpdatePublishConfiguration(packager, null, 'x64', false)).toBeNull();
}, 60000);
it('普通用户安装不打包提权助手，实际builder不取得或复制助手资源', async () => {
  const root = fixture(), packing = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model', '--installer'] });
  expect(packing.config).toHaveProperty('nsis', { perMachine: false, packElevateHelper: false, allowElevation: false });
  const { CopyElevateHelper } = require('app-builder-lib/out/targets/nsis/nsisUtil');
  const target = { options: packing.config.nsis, packager: { info: { framework: { isCopyElevateHelper: true } }, config: { get toolsets() { throw new Error('不应取得提权工具'); } } } };
  await expect(new CopyElevateHelper().copy(root, target)).resolves.toBeUndefined();
  expect(readdirSync(root)).toEqual(['dist']);
});
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
  const stage = join(root, 'stage'); mkdirSync(join(stage, 'dist'), { recursive: true }); writeFileSync(join(stage, 'package.json'), '{}');
  await createPackage(stage, join(appOutDir, 'resources', 'app.asar'));
  await expect(first.config.afterPack({ appOutDir })).resolves.toBeUndefined();
  const report = JSON.parse(readFileSync(join(first.config.directories.output, 'acceptance', 'desktop-package-audit.json'), 'utf8'));
  expect(report.asarSha256).toMatch(/^[a-f0-9]{64}$/); expect(report.memberCount).toBe(1);
  mkdirSync(join(appOutDir, 'resources', 'retrieval-model'));
  await expect(first.config.afterPack({ appOutDir })).rejects.toThrow(/未捆绑|残留/);
});
it('研究包创建和beforePack均拒绝构建树的意外作者数据库，不能依靠glob忽略', async () => {
  const root = fixture(), packing = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'] });
  mkdirSync(join(root, 'dist', 'Projects')); writeFileSync(join(root, 'dist', 'Projects', 'project.sqlite'), '作者数据');
  await expect(packing.config.beforePack()).rejects.toThrow(/构建|成员/);
  await expect(createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'] })).rejects.toThrow(/构建|成员/);
});
it('afterPack再次核对输入，构建期间出现未知日志即使未入ASAR也阻断', async () => {
  const root = fixture(), packing = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'] });
  const appOutDir = join(root, 'package'), stage = join(root, 'stage'); mkdirSync(join(appOutDir, 'resources'), { recursive: true });
  mkdirSync(stage); writeFileSync(join(stage, 'package.json'), '{}'); await createPackage(stage, join(appOutDir, 'resources', 'app.asar'));
  writeFileSync(join(root, 'dist', 'research.log'), '意外研究日志');
  await expect(packing.config.afterPack({ appOutDir })).rejects.toThrow(/构建|成员/);
});
it('同一打包任务可原子更新审计记录，后续验收失败时保留上次完整记录', async () => {
  const root = fixture(), packing = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'] });
  const appOutDir = join(root, 'package'), stage = join(root, 'stage'); mkdirSync(join(appOutDir, 'resources'), { recursive: true });
  mkdirSync(stage); writeFileSync(join(stage, 'package.json'), '{}'); await createPackage(stage, join(appOutDir, 'resources', 'app.asar'));
  await packing.config.afterPack({ appOutDir });
  const acceptance = join(packing.config.directories.output, 'acceptance'), report = join(acceptance, 'desktop-package-audit.json');
  const first = readFileSync(report, 'utf8'); writeFileSync(join(acceptance, '保留.txt'), '其他已有证据');
  writeFileSync(join(stage, 'package.json'), '{"name":"second"}'); await createPackage(stage, join(appOutDir, 'resources', 'app.asar'));
  await expect(packing.config.afterPack({ appOutDir })).resolves.toBeUndefined();
  const second = readFileSync(report, 'utf8'); expect(JSON.parse(second).asarSha256).not.toBe(JSON.parse(first).asarSha256);
  writeFileSync(join(root, 'dist', 'unexpected.log'), '验收失败');
  await expect(packing.config.afterPack({ appOutDir })).rejects.toThrow(); expect(readFileSync(report, 'utf8')).toBe(second);
  expect(readFileSync(join(acceptance, '保留.txt'), 'utf8')).toBe('其他已有证据');
  expect(readdirSync(acceptance).sort()).toEqual(['desktop-package-audit.json', '保留.txt'].sort());
});
it('审计记录目标若为作者文件或目录必须拒绝并保持原内容', async () => {
  const root = fixture(), packing = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'] });
  const appOutDir = join(root, 'package'), stage = join(root, 'stage'); mkdirSync(join(appOutDir, 'resources'), { recursive: true });
  mkdirSync(stage); writeFileSync(join(stage, 'package.json'), '{}'); await createPackage(stage, join(appOutDir, 'resources', 'app.asar'));
  const acceptance = join(packing.config.directories.output, 'acceptance'), report = join(acceptance, 'desktop-package-audit.json'); mkdirSync(acceptance, { recursive: true });
  writeFileSync(report, '作者原稿'); await expect(packing.config.afterPack({ appOutDir })).rejects.toThrow(); expect(readFileSync(report, 'utf8')).toBe('作者原稿');
  rmSync(report); mkdirSync(report); writeFileSync(join(report, '保留.txt'), '作者资料');
  await expect(packing.config.afterPack({ appOutDir })).rejects.toThrow(); expect(readFileSync(join(report, '保留.txt'), 'utf8')).toBe('作者资料');
  expect(readdirSync(acceptance)).toEqual(['desktop-package-audit.json']);
});
it('原子替换失败时旧记录字节保持不变，清理本次临时文件', async () => {
  const root = fixture(), packing = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'] });
  const appOutDir = join(root, 'package'), stage = join(root, 'stage'); mkdirSync(join(appOutDir, 'resources'), { recursive: true });
  mkdirSync(stage); writeFileSync(join(stage, 'package.json'), '{}'); await createPackage(stage, join(appOutDir, 'resources', 'app.asar'));
  await packing.config.afterPack({ appOutDir });
  const acceptance = join(packing.config.directories.output, 'acceptance'), report = join(acceptance, 'desktop-package-audit.json'), before = readFileSync(report, 'utf8');
  failures.rename = true; await expect(packing.config.afterPack({ appOutDir })).rejects.toThrow(/模拟原子替换失败/);
  expect(readFileSync(report, 'utf8')).toBe(before); expect(readdirSync(acceptance)).toEqual(['desktop-package-audit.json']);
});
it('审计记录目标为junction时拒绝，不写入链接指向的作者目录', async () => {
  const root = fixture(), packing = await createModelPackConfiguration({ projectDirectory: root, args: ['--without-bundled-model'] });
  const appOutDir = join(root, 'package'), stage = join(root, 'stage'); mkdirSync(join(appOutDir, 'resources'), { recursive: true });
  mkdirSync(stage); writeFileSync(join(stage, 'package.json'), '{}'); await createPackage(stage, join(appOutDir, 'resources', 'app.asar'));
  const acceptance = join(packing.config.directories.output, 'acceptance'), outside = join(root, 'author'); mkdirSync(acceptance, { recursive: true }); mkdirSync(outside);
  writeFileSync(join(outside, '保留.txt'), '作者资料'); symlinkSync(outside, join(acceptance, 'desktop-package-audit.json'), 'junction');
  await expect(packing.config.afterPack({ appOutDir })).rejects.toThrow(/链接/);
  expect(readdirSync(outside)).toEqual(['保留.txt']); expect(readFileSync(join(outside, '保留.txt'), 'utf8')).toBe('作者资料');
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
it('正式包拒绝结构合法但与仓库固定锚不符的外部来源协议', async () => {
  const root = fixture(), revision = '75c43b069aac4d136ba6bc1122f995fedcfd2781', notices = join(root, 'dist', 'retrieval-model', revision, 'notices');
  mkdirSync(notices, { recursive: true }); mkdirSync(join(root, 'dist', 'retrieval-model', revision, 'weights'));
  const external = JSON.parse(readFileSync('assets/retrieval-model-provenance.json', 'utf8'));
  external.repository = 'external/bge-small-zh-v1.5';
  writeFileSync(join(notices, 'provenance.json'), JSON.stringify(external));
  await expect(createModelPackConfiguration({ projectDirectory: root, args: [] })).rejects.toThrow('来源证据与仓库可信锚不一致');
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
    expect(accepted('dist/Projects/project.sqlite')).toBe(false);
    expect(accepted('dist/research.log')).toBe(false);
  }
});
