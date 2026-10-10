import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { poolCls, padTokenRows, createWasmRuntime } from '../../src/workers/retrieval/runtime';
import { createCpuEmbeddingModel } from '../../src/workers/retrieval/model';

it('不同长度文本右侧补零，保留attention与分段标识，不截断原token', () => {
  const result = padTokenRows([
    { ids: [101, 7, 102], attention_mask: [1, 1, 1], token_type_ids: [0, 0, 0] },
    { ids: [101, 102], attention_mask: [1, 1], token_type_ids: [0, 0] },
  ]);
  expect(result.dimensions).toEqual([2, 3]);
  expect(Array.from(result.input_ids)).toEqual([101n, 7n, 102n, 101n, 102n, 0n]);
  expect(Array.from(result.attention_mask)).toEqual([1n, 1n, 1n, 1n, 1n, 0n]);
  expect(Array.from(result.token_type_ids)).toEqual([0n, 0n, 0n, 0n, 0n, 0n]);
});
it('CLS只取每条文本第一个token并归一化，不混入其他token', () => {
  const data = new Float32Array(2 * 3 * 512); data[0] = 3; data[1] = 4;
  data[512] = 99; data[3 * 512 + 2] = 2;
  const output = poolCls(data, [2, 3, 512]);
  expect(output).toHaveLength(1024);
  expect(output[0]).toBeCloseTo(0.6); expect(output[1]).toBeCloseTo(0.8);
  expect(output[512]).toBe(0); expect(output[514]).toBe(1);
});
it('拒绝窗口溢出、token标识长度不一致、损坏维度及零范数', () => {
  expect(() => padTokenRows([])).toThrow(/批次/);
  expect(() => padTokenRows([{ ids: Array(513).fill(1), attention_mask: Array(513).fill(1), token_type_ids: Array(513).fill(0) }])).toThrow(/512/);
  expect(() => padTokenRows([{ ids: [1], attention_mask: [], token_type_ids: [0] }])).toThrow(/token/);
  expect(() => poolCls(new Float32Array(512), [1, 1, 384])).toThrow(/维数/);
  expect(() => poolCls(new Float32Array(512), [1, 1, 512])).toThrow(/范数/);
});
it.skipIf(!existsSync(resolve('.tmp-model-qualification/model/onnx/model_quantized.onnx')))('纯WASM源码真实tokenizer到CLS闭环无外发，批量不同长度不污染向量', async () => {
  const runtime = createWasmRuntime(resolve('dist/desktop/retrieval-wasm'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('离线推理禁止联网'); };
  const model = await createCpuEmbeddingModel(resolve('.tmp-model-qualification/model'), { loadRuntime: async () => runtime });
  try {
    const first = (await model.embed(['冷雨映出一个人的孤独'], 'document'))[0];
    const batch = await model.embed(['冷雨映出一个人的孤独', '数据库'], 'document');
    expect(model.tokenize('雨夜')).toHaveLength(2);
    expect(first).toHaveLength(512); expect(batch).toHaveLength(2);
    expect(Math.max(...first.map((value, index) => Math.abs(value - batch[0][index])))).toBeLessThan(1e-5);
  } finally { await model.dispose(); globalThis.fetch = originalFetch; }
}, 30000);
