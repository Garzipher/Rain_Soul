import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { checkBundledModelPackage } from '../../scripts/check-bundled-model-package.mjs';
import { prepareBundledRetrievalModel, type ModelProvenance } from '../../scripts/prepare-bundled-retrieval-model.mjs';
import { fixedManifest } from '../../src/shared/retrieval-model';

const roots: string[] = [], hash = (value: string) => createHash('sha256').update(value).digest('hex');
const originalArgv = [...process.argv], originalExitCode = process.exitCode;
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rainsoul-package-')); roots.push(root);
  const manifest = structuredClone(fixedManifest), inputDirectory = join(root, 'input'), evidenceDirectory = join(root, 'evidence'), resources = join(root, 'resources');
  mkdirSync(inputDirectory); mkdirSync(evidenceDirectory);
  for (const file of manifest.files) { const data = `公开${file.path}`; file.bytes = Buffer.byteLength(data); file.sha256 = hash(data); const path = join(inputDirectory, file.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); }
  const trustedAnchor: ModelProvenance = { schemaVersion: 1, repository: manifest.repository, revision: manifest.revision, upstreamRepository: manifest.upstreamRepository, upstreamRevision: manifest.upstreamReferenceRevision, manifestSha256: hash(JSON.stringify(manifest)), artifacts: ['upstream-card', 'candidate-card', 'license', 'conversion'].map((kind, index) => {
    const path = `notice-${index}.txt`, data = kind === 'license' ? manifest.licenseText : `经审查材料${kind}`; writeFileSync(join(evidenceDirectory, path), data);
    return { kind: kind as ModelProvenance['artifacts'][number]['kind'], path, bytes: Buffer.byteLength(data), sha256: hash(data), url: kind === 'license' ? manifest.licenseUrl : `https://huggingface.co/${kind === 'upstream-card' ? manifest.upstreamRepository : manifest.repository}/raw/${kind === 'upstream-card' ? manifest.upstreamReferenceRevision : manifest.revision}/${path}` };
  }) };
  writeFileSync(join(evidenceDirectory, 'provenance.json'), JSON.stringify(trustedAnchor));
  const outputDirectory = join(resources, 'retrieval-model', manifest.revision);
  await prepareBundledRetrievalModel({ inputDirectory, evidenceDirectory, outputDirectory, manifest, trustedAnchor });
  return { root, resources, outputDirectory, manifest, trustedAnchor };
}
afterEach(() => {
  process.argv.splice(0, process.argv.length, ...originalArgv); process.exitCode = originalExitCode;
  vi.restoreAllMocks(); vi.resetModules();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it('实际resources中的精确版本、五文件和独立声明通过', async () => {
  const value = await fixture(); await expect(checkBundledModelPackage(value.resources, value.manifest, value.trustedAnchor)).resolves.toBeUndefined();
});
it.each(['旧失败标记', '缺许可', '坏权重', '旧revision', '作者库', '研究日志', '未知顶层'])('%s阻断最终包核验', async change => {
  const value = await fixture();
  if (change === '旧失败标记') writeFileSync(value.outputDirectory + '.pending', '上次失败');
  if (change === '缺许可') rmSync(join(value.outputDirectory, 'notices', 'notice-2.txt'));
  if (change === '坏权重') writeFileSync(join(value.outputDirectory, 'weights', 'config.json'), '坏权重');
  if (change === '旧revision') mkdirSync(join(value.resources, 'retrieval-model', 'a'.repeat(40)));
  if (change === '作者库') { mkdirSync(join(value.outputDirectory, 'Projects')); writeFileSync(join(value.outputDirectory, 'Projects', 'project.sqlite'), '受控数据'); }
  if (change === '研究日志') writeFileSync(join(value.outputDirectory, 'notices', 'research.log'), '研究日志');
  if (change === '未知顶层') writeFileSync(join(value.outputDirectory, 'provenance.json'), '{}');
  await expect(checkBundledModelPackage(value.resources, value.manifest, value.trustedAnchor)).rejects.toThrow();
});
it('包中的模型根目录链接拒绝，缺可信锚不能借用产物放行', async () => {
  const value = await fixture();
  await expect(checkBundledModelPackage(value.resources, value.manifest)).rejects.toThrow(/可信|来源/);
  const other = join(value.root, 'elsewhere'); mkdirSync(other); rmSync(join(value.resources, 'retrieval-model'), { recursive: true }); symlinkSync(other, join(value.resources, 'retrieval-model'), 'junction');
  await expect(checkBundledModelPackage(value.resources, value.manifest, value.trustedAnchor)).rejects.toThrow(/链接/);
});
it('模型根目录为普通文件时拒绝，不把文件当作资源树', async () => {
  const value = await fixture(), root = join(value.resources, 'retrieval-model');
  rmSync(root, { recursive: true }); writeFileSync(root, '普通文件');
  await expect(checkBundledModelPackage(value.resources, value.manifest, value.trustedAnchor)).rejects.toThrow(/资源目录缺失/);
});
it.each(['weights', 'notices'])('版本目录缺少%s且仍有两个成员时拒绝', async missing => {
  const value = await fixture(); rmSync(join(value.outputDirectory, missing), { recursive: true }); mkdirSync(join(value.outputDirectory, 'unexpected'));
  await expect(checkBundledModelPackage(value.resources, value.manifest, value.trustedAnchor)).rejects.toThrow(/weights和notices/);
});
async function runCli(args: string[]) {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  process.argv.splice(0, process.argv.length, process.execPath, resolve('scripts/check-bundled-model-package.mjs'), ...args);
  process.exitCode = undefined; vi.resetModules();
  await import('../../scripts/check-bundled-model-package.mjs');
  return stderr;
}
it.each([{ args: [] }, { args: ['relative/resources'] }, { args: [resolve('dist'), '--trusted-anchor', '{}'] }])('CLI拒绝缺参、相对路径及额外来源参数：$args', async ({ args }) => {
  const stderr = await runCli(args);
  expect(process.exitCode).toBe(1); expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/用法.*绝对resources目录/));
});
it('CLI真实核验资源，夹具来源不能替代仓库锚放行', async () => {
  const value = await fixture(), stderr = await runCli([value.resources]);
  expect(process.exitCode).toBe(1); expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/可信锚.*禁止正式捆绑/));
});
it('作为库加载且没有argv入口时不运行CLI或改退出码', async () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  process.argv.splice(0, process.argv.length, process.execPath); process.exitCode = undefined; vi.resetModules();
  await import('../../scripts/check-bundled-model-package.mjs');
  expect(stderr).not.toHaveBeenCalled(); expect(process.exitCode).toBeUndefined();
});
