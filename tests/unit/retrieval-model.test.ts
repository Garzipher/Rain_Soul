import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createCpuEmbeddingModel, type TransformersRuntime } from '../../src/workers/retrieval/model';

const prefix = '为这个句子生成表示以用于检索相关文章：';
function runtimeFixture() {
  const vector = new Float32Array(512); vector[0] = 1;
  const extractor = Object.assign(vi.fn(async (texts: string[]) => ({ dims: [texts.length, 512], data: Float32Array.from(texts.flatMap(() => Array.from(vector))) })), { dispose: vi.fn(async () => undefined) });
  const tokenizer = vi.fn((text: string, options: { add_special_tokens?: boolean }) => ({ input_ids: { data: BigInt64Array.from(Array.from(text).map((_, index) => BigInt(index + 1)).concat(options.add_special_tokens === false ? [] : [1n, 2n])) } }));
  const runtime = { env: { allowRemoteModels: true, allowLocalModels: false, useBrowserCache: true, useFSCache: true }, AutoTokenizer: { from_pretrained: vi.fn(async () => tokenizer) }, pipeline: vi.fn(async () => extractor) } satisfies TransformersRuntime;
  return { runtime, extractor, tokenizer };
}
it('初始化只允许本机CPU，明确CLS/L2与查询前缀，文档不加前缀', async () => {
  const { runtime, extractor } = runtimeFixture();
  const model = await createCpuEmbeddingModel('verified-directory', { loadRuntime: async () => runtime });
  expect(runtime.env).toMatchObject({ allowRemoteModels: false, allowLocalModels: true, useBrowserCache: false, useFSCache: false });
  expect(runtime.pipeline).toHaveBeenCalledWith('feature-extraction', 'verified-directory', expect.objectContaining({ local_files_only: true, device: 'cpu', dtype: 'q8' }));
  expect(model.tokenize('雨夜')).toHaveLength(2);
  expect(await model.embed(['雨夜'], 'query')).toHaveLength(1);
  expect(extractor).toHaveBeenLastCalledWith([prefix + '雨夜'], { pooling: 'cls', normalize: true });
  await model.embed(['雨夜'], 'document');
  expect(extractor).toHaveBeenLastCalledWith(['雨夜'], { pooling: 'cls', normalize: true });
  await model.dispose(); expect(extractor.dispose).toHaveBeenCalledOnce();
  expect(() => model.tokenize('雨')).toThrow(/关闭/);
  await expect(model.embed(['雨'], 'query')).rejects.toThrow(/关闭/);
});
it('400token边界、512总窗口和空白/批量上限均在推理前检查，禁止截断', async () => {
  const { runtime, extractor, tokenizer } = runtimeFixture();
  const model = await createCpuEmbeddingModel('verified-directory', { loadRuntime: async () => runtime });
  await model.embed(['雨'.repeat(400)], 'query'); expect(extractor).toHaveBeenCalledOnce();
  for (const texts of [['雨'.repeat(401)], [' '], Array.from({ length: 33 }, () => '雨')]) await expect(model.embed(texts, 'query')).rejects.toThrow(/范围|文本|批次/);
  tokenizer.mockImplementation(text => ({ input_ids: { data: BigInt64Array.from(Array.from({ length: text.startsWith(prefix) ? 513 : 2 }, () => 1n)) } }));
  await expect(model.embed(['雨'], 'query')).rejects.toThrow(/512/);
  expect(extractor).toHaveBeenCalledOnce(); expect(await model.embed([], 'document')).toEqual([]);
  await model.dispose();
});
it.each(['dimension', 'nan', 'norm'])('拒绝运行库输出错误：%s', async fault => {
  const { runtime, extractor } = runtimeFixture();
  extractor.mockImplementation(async () => {
    const data = new Float32Array(512); data[0] = fault === 'nan' ? NaN : 2;
    return { dims: [1, fault === 'dimension' ? 384 : 512], data };
  });
  const model = await createCpuEmbeddingModel('verified-directory', { loadRuntime: async () => runtime });
  await expect(model.embed(['雨夜'], 'query')).rejects.toThrow(/向量/); await model.dispose();
});
const temporary = resolve('.tmp-model-qualification');
it.skipIf(!existsSync(resolve(temporary, 'model/onnx/model_quantized.onnx')))('真实固定模型离线生成512维CLS/L2中文向量并保持重复一致', async () => {
  const requireRuntime = createRequire(resolve(temporary, 'runtime/package.json'));
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('真实离线试验禁止外发'); });
  const model = await createCpuEmbeddingModel(resolve(temporary, 'model'), { loadRuntime: async () => requireRuntime('@huggingface/transformers') as TransformersRuntime });
  try {
    const query = (await model.embed(['怎样用天气写出人物孤独？'], 'query'))[0];
    const repeated = (await model.embed(['怎样用天气写出人物孤独？'], 'query'))[0];
    const documents = await model.embed(['冷雨敲击窗户，他独自守着空房间，用环境映照孤独心境。', '数据库事务通过原子提交和回滚维护一致性。'], 'document');
    const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, value, index) => sum + value * b[index], 0);
    expect(query).toHaveLength(512); expect(dot(query, query)).toBeCloseTo(1, 5);
    expect(Array.from(query)).toEqual(Array.from(repeated));
    expect(dot(query, documents[0])).toBeGreaterThan(dot(query, documents[1]));
    await expect(model.embed(['雨'.repeat(401)], 'query')).rejects.toThrow(/400/);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { await model.dispose(); fetchSpy.mockRestore(); }
}, 30000);
