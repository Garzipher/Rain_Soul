import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { modelArtifactDigest, prepareBundledRetrievalModel, validateModelProvenance, type ModelProvenance } from '../../scripts/prepare-bundled-retrieval-model.mjs';
import { fixedManifest } from '../../src/shared/retrieval-model';
vi.mock('node:fs/promises', async importOriginal => {
  const actual=await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const roots: string[] = [];
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rainsoul-bundled-')); roots.push(root);
  const manifest = structuredClone(fixedManifest);
  const inputDirectory = join(root, 'input'), evidenceDirectory = join(root, 'evidence');
  mkdirSync(inputDirectory); mkdirSync(evidenceDirectory);
  for (const file of manifest.files) {
    const data = Buffer.from(`公开模型夹具：${file.path}`); file.bytes = data.length; file.sha256 = hash(data);
    const path = join(inputDirectory, file.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data);
  }
  const materials = [
    { kind: 'upstream-card', path: 'upstream.md', data: '固定上游模型卡', url: `https://huggingface.co/${manifest.upstreamRepository}/raw/${manifest.upstreamReferenceRevision}/README.md` },
    { kind: 'candidate-card', path: 'candidate.md', data: '固定转换模型卡', url: `https://huggingface.co/${manifest.repository}/raw/${manifest.revision}/README.md` },
    { kind: 'license', path: 'LICENSE.txt', data: manifest.licenseText, url: manifest.licenseUrl },
    { kind: 'conversion', path: 'conversion.json', data: '经审查的精确输入输出转换证明', url: `https://huggingface.co/${manifest.repository}/raw/${manifest.revision}/conversion.json` },
  ] as const;
  const trustedAnchor: ModelProvenance = { schemaVersion: 1, repository: manifest.repository, revision: manifest.revision,
    upstreamRepository: manifest.upstreamRepository, upstreamRevision: manifest.upstreamReferenceRevision,
    manifestSha256: modelArtifactDigest(manifest), artifacts: materials.map(({ kind, path, data, url }) => {
      writeFileSync(join(evidenceDirectory, path), data); return { kind, path, url, bytes: Buffer.byteLength(data), sha256: hash(data) };
    }) };
  writeFileSync(join(evidenceDirectory, 'provenance.json'), JSON.stringify(trustedAnchor));
  return { root, manifest, inputDirectory, evidenceDirectory, outputDirectory: join(root, 'output', manifest.revision), trustedAnchor };
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('经可信锚核验后复制五权重及独立声明，输入保持不变', async () => {
  const options = fixture(); await prepareBundledRetrievalModel(options);
  expect(readdirSync(options.outputDirectory).sort()).toEqual(['notices', 'weights']);
  for (const file of options.manifest.files) expect(readFileSync(join(options.outputDirectory, 'weights', file.path))).toEqual(readFileSync(join(options.inputDirectory, file.path)));
  expect(readFileSync(join(options.outputDirectory, 'notices', 'LICENSE.txt'), 'utf8')).toBe(fixedManifest.licenseText);
  expect(readdirSync(options.inputDirectory).sort()).toEqual(['config.json', 'onnx', 'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json']);
  expect(existsSync(options.outputDirectory + '.pending')).toBe(false);
});
it('仓库固定来源锚拒绝外部自报通过与不同模型身份', async () => {
  const options = fixture();
  expect(() => validateModelProvenance({ ...options.trustedAnchor, officialSourceVerified: true }, options.manifest)).toThrow();
  await expect(prepareBundledRetrievalModel({ ...options, trustedAnchor: undefined })).rejects.toThrow(/可信|来源/);
  expect(existsSync(options.outputDirectory)).toBe(false);
});
it.each(['缺文件', '坏长度', '坏SHA', '未知文件', '空目录'])('%s阻断准备并留下失败标记', async change => {
  const options = fixture(), path = join(options.inputDirectory, 'config.json');
  if (change === '缺文件') rmSync(path);
  if (change === '坏长度') writeFileSync(path, '坏');
  if (change === '坏SHA') writeFileSync(path, Buffer.alloc(options.manifest.files[0].bytes));
  if (change === '未知文件') writeFileSync(join(options.inputDirectory, 'extra.js'), '未知');
  if (change === '空目录') mkdirSync(join(options.inputDirectory, 'unused'));
  await expect(prepareBundledRetrievalModel(options)).rejects.toThrow();
  expect(existsSync(options.outputDirectory)).toBe(false); expect(existsSync(options.outputDirectory + '.pending')).toBe(true);
});
it.each(['缺许可', '缺转换证明', '坏声明SHA', '未知证据', '伪造版本', '穿越路径'])('%s不能通过来源证据', async change => {
  const options = fixture();
  if (change === '缺许可') rmSync(join(options.evidenceDirectory, 'LICENSE.txt'));
  if (change === '缺转换证明') rmSync(join(options.evidenceDirectory, 'conversion.json'));
  if (change === '坏声明SHA') writeFileSync(join(options.evidenceDirectory, 'candidate.md'), '伪');
  if (change === '未知证据') writeFileSync(join(options.evidenceDirectory, 'credentials.env'), '受控测试');
  if (change === '伪造版本') writeFileSync(join(options.evidenceDirectory, 'provenance.json'), JSON.stringify({ ...options.trustedAnchor, upstreamRevision: 'a'.repeat(40) }));
  if (change === '穿越路径') options.trustedAnchor.artifacts[0].path = '../outside.md';
  await expect(prepareBundledRetrievalModel(options)).rejects.toThrow();
  expect(existsSync(options.outputDirectory)).toBe(false);
});
it('拒绝目录链接且不读取链接指向的权重', async () => {
  const options = fixture(), outside = join(options.root, 'outside'); mkdirSync(outside);
  rmSync(join(options.inputDirectory, 'onnx'), { recursive: true }); symlinkSync(outside, join(options.inputDirectory, 'onnx'), 'junction');
  await expect(prepareBundledRetrievalModel(options)).rejects.toThrow(/链接/);
});
it('失败的新准备使旧资源不可误用，修复后原子替换', async () => {
  const options = fixture(); await prepareBundledRetrievalModel(options);
  writeFileSync(join(options.inputDirectory, 'extra.js'), '未知');
  await expect(prepareBundledRetrievalModel(options)).rejects.toThrow();
  expect(existsSync(options.outputDirectory + '.pending')).toBe(true);
  expect(readFileSync(join(options.outputDirectory, 'notices', 'LICENSE.txt'), 'utf8')).toBe(fixedManifest.licenseText);
  rmSync(join(options.inputDirectory, 'extra.js')); await prepareBundledRetrievalModel(options);
  expect(existsSync(options.outputDirectory + '.pending')).toBe(false);
  expect(readdirSync(dirname(options.outputDirectory))).toEqual([options.manifest.revision]);
});
it('重叠输入输出与根目录输出在任何删除操作前拒绝', async () => {
  const options = fixture();
  await expect(prepareBundledRetrievalModel({ ...options, outputDirectory: options.inputDirectory })).rejects.toThrow(/输出|重叠/);
  expect(existsSync(join(options.inputDirectory, 'config.json'))).toBe(true);
});
it('可信锚缺必需模型卡、重复材料或模型字节身份不一致均拒绝', () => {
  const options = fixture();
  for (const anchor of [
    { ...options.trustedAnchor, artifacts: options.trustedAnchor.artifacts.filter(item => item.kind !== 'candidate-card') },
    { ...options.trustedAnchor, artifacts: [...options.trustedAnchor.artifacts, options.trustedAnchor.artifacts[0]] },
    { ...options.trustedAnchor, manifestSha256: 'a'.repeat(64) },
  ]) expect(() => validateModelProvenance(anchor, options.manifest, anchor)).toThrow();
});
it('固定公开模型卡与许可完整时允许缺精确转换证明，但仍核对五权重', async () => {
  const options = fixture();
  options.trustedAnchor.artifacts = options.trustedAnchor.artifacts.filter(item => item.kind !== 'conversion');
  rmSync(join(options.evidenceDirectory, 'conversion.json'));
  writeFileSync(join(options.evidenceDirectory, 'provenance.json'), JSON.stringify(options.trustedAnchor));
  await prepareBundledRetrievalModel(options);
  expect(readdirSync(join(options.outputDirectory, 'notices')).sort()).toEqual(['LICENSE.txt', 'candidate.md', 'provenance.json', 'upstream.md']);
  for (const file of options.manifest.files) expect(hash(readFileSync(join(options.outputDirectory, 'weights', file.path)))).toBe(file.sha256);
});
it('资格与阈值更新不改变来源字节身份，权重及许可篡改仍阻断', () => {
  const options = fixture();
  for (const key of Object.keys(options.manifest.qualification) as (keyof typeof options.manifest.qualification)[]) options.manifest.qualification[key] = true;
  options.manifest.similarityThreshold = 0.6;
  expect(validateModelProvenance(options.trustedAnchor, options.manifest, options.trustedAnchor)).toEqual(options.trustedAnchor);
  options.manifest.files[0].sha256 = 'b'.repeat(64);
  expect(() => validateModelProvenance(options.trustedAnchor, options.manifest, options.trustedAnchor)).toThrow(/字节身份/);
  const altered = fixture(); altered.manifest.licenseText += '变更';
  expect(() => validateModelProvenance(altered.trustedAnchor, altered.manifest, altered.trustedAnchor)).toThrow(/字节身份/);
});
it('正式CLI拒绝夹具自报可信锚和额外参数，环境变量不能放行', () => {
  const options = fixture();
  const run = (extra: string[] = []) => spawnSync(process.execPath, ['scripts/prepare-bundled-retrieval-model.mjs', options.inputDirectory, options.evidenceDirectory, options.outputDirectory, ...extra], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, RAINSOUL_MODEL_TRUSTED: 'true' } });
  const normal = run(); expect(normal.status).toBe(1); expect(normal.stderr).toMatch(/可信锚/); expect(existsSync(options.outputDirectory)).toBe(false);
  const injected = run(['--trusted-anchor', join(options.evidenceDirectory, 'provenance.json')]); expect(injected.status).toBe(1); expect(injected.stderr).toMatch(/用法/);
});
it.each(['weights', 'provenance'] as const)('%s在检查后增长仍保持读取容量有界，旧输出保留', async kind => {
  const options=fixture(); await prepareBundledRetrievalModel(options);
  const target=join(kind==='weights'?options.inputDirectory:options.evidenceDirectory,kind==='weights'?'config.json':'provenance.json');
  const limit=kind==='weights'?options.manifest.files[0].bytes:65536;
  let observed=0, mutated=false;
  const originalOpen=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).open;
  vi.spyOn(filesystem,'open').mockImplementation(async (...args: Parameters<typeof filesystem.open>) => {
    const handle=await originalOpen(...args);
    if(args[0]===target) {
      const stat=handle.stat.bind(handle), readFile=handle.readFile.bind(handle), read=handle.read.bind(handle);
      vi.spyOn(handle,'stat').mockImplementation(async () => {
        const result=await stat();
        if(!mutated) { mutated=true; appendFileSync(target,Buffer.alloc(limit+1024)); }
        return result;
      });
      vi.spyOn(handle,'readFile').mockImplementation(async (...input: Parameters<typeof handle.readFile>) => {
        const data=await readFile(...input); observed+=Buffer.byteLength(data); return data;
      });
      vi.spyOn(handle,'read').mockImplementation(async (...input: Parameters<typeof handle.read>) => {
        const result=await read(...input); observed+=result.bytesRead; return result;
      });
    }
    return handle;
  });
  await expect(prepareBundledRetrievalModel(options)).rejects.toThrow();
  expect(mutated).toBe(true); expect(observed).toBeLessThanOrEqual(limit+1);
  expect(existsSync(options.outputDirectory+'.pending')).toBe(true);
  expect(readFileSync(join(options.outputDirectory,'notices','LICENSE.txt'),'utf8')).toBe(fixedManifest.licenseText);
});
