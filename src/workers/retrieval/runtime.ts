import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-web/wasm';
import type { TransformersRuntime } from './model';

interface TokenRow { ids: number[]; attention_mask: number[]; token_type_ids: number[] }
/** 固定BERT模型使用右侧零补齐，不截断、不重建原文。 */
export function padTokenRows(rows: TokenRow[]) {
  if (!rows.length || rows.length > 32) throw new Error('本机模型批次无效。');
  const length = Math.max(...rows.map(row => row.ids.length));
  if (length > 512 || length < 1) throw new Error('本机模型输入超过512 token或为空。');
  for (const row of rows) {
    if (row.attention_mask.length !== row.ids.length || row.token_type_ids.length !== row.ids.length || !row.ids.every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('本机模型token标识无效。');
  }
  const padded = (source: keyof TokenRow) => BigInt64Array.from(rows.flatMap(row => row[source].concat(Array<number>(length - row.ids.length).fill(0))), BigInt);
  return { dimensions: [rows.length, length], input_ids: padded('ids'), attention_mask: padded('attention_mask'), token_type_ids: padded('token_type_ids') };
}
/** 每条文本取首token；Float32累加顺序与已验证的Transformers.js保持一致。 */
export function poolCls(data: ArrayLike<number>, dimensions: readonly number[]): Float32Array {
  const [batch, tokens, width] = dimensions;
  if (dimensions.length !== 3 || !Number.isInteger(batch) || !Number.isInteger(tokens) || batch < 1 || tokens < 1 || width !== 512 || data.length !== batch * tokens * width) throw new Error('本机模型隐藏层维数异常。');
  const output = new Float32Array(batch * width);
  for (let row = 0; row < batch; row++) {
    const start = row * tokens * width;
    let squared = 0;
    for (let index = 0; index < width; index++) squared = Math.fround(squared + data[start + index] ** 2);
    const norm = Math.fround(Math.sqrt(squared));
    if (!Number.isFinite(norm) || norm <= 0) throw new Error('本机模型CLS范数无效。');
    for (let index = 0; index < width; index++) output[row * width + index] = data[start + index] / norm;
  }
  return output;
}
async function loadTokenizer(directory: string) {
  const [json, config] = await Promise.all(['tokenizer.json', 'tokenizer_config.json'].map(name => readFile(join(directory, name), 'utf8').then(JSON.parse)));
  return new Tokenizer(json, config);
}
export const env = { allowRemoteModels: false, allowLocalModels: true, useBrowserCache: false, useFSCache: false };
export const AutoTokenizer: TransformersRuntime['AutoTokenizer'] = {
  async from_pretrained(directory) {
    const tokenizer = await loadTokenizer(directory);
    return (text, options) => ({ input_ids: { data: tokenizer.encode(text, { add_special_tokens: options.add_special_tokens !== false }).ids } });
  },
};
export function createWasmRuntime(runtimeDirectory: string): TransformersRuntime {
  const pipeline: TransformersRuntime['pipeline'] = async (_task, directory) => {
  // WASM运行库与模型均来自校验后的本地文件；不提供URL或远程后备入口。
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmBinary = new Uint8Array(await readFile(join(runtimeDirectory, 'ort-wasm-simd-threaded.wasm')));
  ort.env.wasm.wasmPaths = { mjs: pathToFileURL(join(runtimeDirectory, 'ort-wasm-simd-threaded.mjs')).href };
  const tokenizer = await loadTokenizer(directory);
  const session = await ort.InferenceSession.create(new Uint8Array(await readFile(join(directory, 'onnx/model_quantized.onnx'))), { executionProviders: ['wasm'] });
  return Object.assign(async (texts: string[]) => {
    const data = new Float32Array(texts.length * 512);
    // q8含动态量化；逐条执行防止其他文本改变当前文本的量化范围。
    for (let index = 0; index < texts.length; index++) {
      const padded = padTokenRows([tokenizer.encode(texts[index], { return_token_type_ids: true })]);
      const feeds = Object.fromEntries(['input_ids', 'attention_mask', 'token_type_ids'].map(name => [name, new ort.Tensor('int64', padded[name as keyof Pick<typeof padded, 'input_ids' | 'attention_mask' | 'token_type_ids'>], padded.dimensions)]));
      const output = (await session.run(feeds)).last_hidden_state;
      if (!output || output.type !== 'float32') throw new Error('本机模型缺少浮点隐藏层。');
      data.set(poolCls(output.data as Float32Array, output.dims), index * 512);
    }
    return { dims: [texts.length, 512], data };
  }, { dispose: () => session.release() });
  };
  return { env, AutoTokenizer, pipeline };
}
export const pipeline: TransformersRuntime['pipeline'] = (...args) => createWasmRuntime(join(__dirname.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked'), 'retrieval-wasm')).pipeline(...args);
