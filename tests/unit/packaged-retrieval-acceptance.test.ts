import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createPackageWithOptions } from '@electron/asar';
import { afterEach, expect, it } from 'vitest';
import { inspectPackagedRetrieval, evaluateRetrievalQuality, assertPackagedAcceptance, assertQualificationFixture } from '../../scripts/packaged-retrieval-acceptance.mjs';

const roots: string[] = [];
const digest = (body: string) => createHash('sha256').update(body).digest('hex');
const put = (root: string, path: string, body: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); };
const manifest = { revision: 'a'.repeat(40), files: [{ path: 'config.json', bytes: 5, sha256: digest('model') }], similarityThreshold: .5 };
async function pack() {
  const root = mkdtempSync(join(tmpdir(), 'rainsoul-model-package-')); roots.push(root);
  put(root, 'RainSoul.exe', 'exe'); put(root, `resources/retrieval-model/${manifest.revision}/weights/config.json`, 'model');
  for (const file of ['retrieval-runtime.cjs', 'retrieval-worker.cjs', 'retrieval-ort-wasm.cjs']) put(root, `stage/dist/desktop/${file}`, file);
  for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) put(root, `stage/dist/desktop/retrieval-wasm/${file}`, file);
  await createPackageWithOptions(join(root, 'stage'), join(root, 'resources/app.asar'), { unpack: '**/retrieval-wasm/*' });
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }); });
it('资格拒绝换成极小实验夹具或改标注，只允许既定基准', () => {
  const original = JSON.parse(readFileSync('tests/fixtures/retrieval-quality.json', 'utf8'));
  expect(() => assertQualificationFixture(original)).not.toThrow();
  expect(() => assertQualificationFixture({ ...original, acceptance: original.acceptance.slice(0, 1) })).toThrow();
  original.acceptance[0].relevantIds = [];
  expect(() => assertQualificationFixture(original)).toThrow();
});
it('绑定真实EXE、ASAR、运行库、WASM及权重的字节摘要', async () => {
  const root = await pack(), result = await inspectPackagedRetrieval(join(root, 'RainSoul.exe'), manifest);
  expect(result.executable.sha256).toBe(digest('exe')); expect(result.runtimeFiles).toHaveLength(5);
  expect(result.weights).toEqual(manifest.files); expect(result.asar.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.modelDirectory).toContain(manifest.revision);
});
it('损坏权重或遗漏实际WASM都不能产生资格报告', async () => {
  const root = await pack(); put(root, `resources/retrieval-model/${manifest.revision}/weights/config.json`, 'bad');
  await expect(inspectPackagedRetrieval(join(root, 'RainSoul.exe'), manifest)).rejects.toThrow(/权重/);
  put(root, `resources/retrieval-model/${manifest.revision}/weights/config.json`, 'model');
  rmSync(join(root, 'resources/app.asar.unpacked/dist/desktop/retrieval-wasm/ort-wasm-simd-threaded.wasm'));
  await expect(inspectPackagedRetrieval(join(root, 'RainSoul.exe'), manifest)).rejects.toThrow();
});
it('拒绝相对目录、非RainSoul入口、模型路径穿越和junction', async () => {
  await expect(inspectPackagedRetrieval('RainSoul.exe', manifest)).rejects.toThrow(/绝对/);
  const root = await pack(); put(root, 'Other.exe', 'exe');
  await expect(inspectPackagedRetrieval(join(root, 'Other.exe'), manifest)).rejects.toThrow(/RainSoul/);
  await expect(inspectPackagedRetrieval(join(root, 'RainSoul.exe'), { ...manifest, files: [{ path: '../config.json', bytes: 5, sha256: digest('model') }] })).rejects.toThrow(/路径/);
  const model = join(root, `resources/retrieval-model/${manifest.revision}/weights`);
  rmSync(model, { recursive: true }); symlinkSync(join(root, 'stage'), model, 'junction');
  await expect(inspectPackagedRetrieval(join(root, 'RainSoul.exe'), manifest)).rejects.toThrow(/链接/);
});
it('质量在固定阈值与原标注上评分，不以验收集反调阈值', () => {
  const fixture = { knowledge: [{ id: 'a', body: '雨夜寂寞' }, { id: 'b', body: '人物成长' }], acceptance: [
    { id: 'q1', text: '雨夜', group: '语义', relevantIds: ['a'] }, { id: 'q2', text: '量子', group: '无相关', relevantIds: [] },
  ] };
  const report = evaluateRetrievalQuality(fixture, [[1, 0], [0, 1]], [[1, 0], [-1, 0]], .5);
  expect(report.semanticParaphraseRecall).toBe(1); expect(report.keywordParaphraseRecall).toBe(1);
  expect(report.noRelevantFalsePositiveQueries).toBe(0); expect(report.meetsNumericTargets).toBe(true);
  expect(() => evaluateRetrievalQuality(fixture, [[1, 0]], [[1, 0], [-1, 0]], .5)).toThrow();
  expect(() => evaluateRetrievalQuality(fixture, [[1, 0], [0, 1]], [[1, 0], [-1, 0]], null)).toThrow();
});
it('验收只放行实际同包身份、成功数值与零拦截请求，不冒称全系统网络审计', () => {
  const identity = { executable: { sha256: 'exe' }, asar: { sha256: 'asar' } };
  const result = { identity, quality: { meetsNumericTargets: true }, networkAttempts: 0, coldLoadMs: 50, dimensions: 512 };
  expect(() => assertPackagedAcceptance(identity, result)).not.toThrow();
  for (const patch of [{ networkAttempts: 1 }, { coldLoadMs: 30001 }, { dimensions: 12 }, { quality: { meetsNumericTargets: false } }, { identity: { ...identity, asar: { sha256: 'different' } } }]) {
    expect(() => assertPackagedAcceptance(identity, { ...result, ...patch })).toThrow();
  }
});
