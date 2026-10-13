import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { checkBundledModelPackage } from '../../scripts/check-bundled-model-package.mjs';
import { prepareBundledRetrievalModel, type ModelProvenance } from '../../scripts/prepare-bundled-retrieval-model.mjs';
import { fixedManifest } from '../../src/shared/retrieval-model';

const roots: string[] = [], hash = (value: string) => createHash('sha256').update(value).digest('hex');
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
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
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
