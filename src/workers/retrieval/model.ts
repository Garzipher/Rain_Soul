import { fixedManifest } from '../../shared/retrieval-model';
export interface Tokenizer { (text: string, options: { add_special_tokens?: boolean; padding: boolean; truncation: boolean }): { input_ids: { data: ArrayLike<number | bigint> } } }
export interface Extractor {
  (texts: string[], options: { pooling: 'cls'; normalize: true }): Promise<{ dims: number[]; data: ArrayLike<number> }>;
  dispose(): Promise<unknown>;
}
export interface TransformersRuntime {
  env: { allowRemoteModels: boolean; allowLocalModels: boolean; useBrowserCache: boolean; useFSCache: boolean };
  AutoTokenizer: { from_pretrained(directory: string, options: { local_files_only: true }): Promise<Tokenizer> };
  pipeline(task: string, directory: string, options: { local_files_only: true; device: 'cpu'; dtype: 'q8'; session_options: { intraOpNumThreads: number; interOpNumThreads: number } }): Promise<Extractor>;
}
export interface CpuEmbeddingModel {
  tokenize(text: string): number[];
  embed(texts: string[], kind: 'query' | 'document'): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}
/** 仅在独立检索Worker加载。调用方提供已校验激活目录，不接收模型脚本或URL。 */
export async function createCpuEmbeddingModel(directory: string, dependencies: { loadRuntime?: () => Promise<TransformersRuntime> } = {}): Promise<CpuEmbeddingModel> {
  const loadRuntime = dependencies.loadRuntime ?? (async () => { const name = '@huggingface/transformers'; return await import(name) as TransformersRuntime; });
  const runtime = await loadRuntime();
  Object.assign(runtime.env, { allowRemoteModels: false, allowLocalModels: true, useBrowserCache: false, useFSCache: false });
  const tokenizer = await runtime.AutoTokenizer.from_pretrained(directory, { local_files_only: true });
  const extractor = await runtime.pipeline('feature-extraction', directory, { local_files_only: true, device: 'cpu', dtype: fixedManifest.dtype, session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
  let disposed = false;
  const available = () => { if (disposed) throw new Error('本机模型已关闭。'); };
  const tokens = (text: string, special: boolean) => Array.from(tokenizer(text, { add_special_tokens: special, padding: false, truncation: false }).input_ids.data, Number);
  return {
    tokenize(text) { available(); return tokens(text, false); },
    async embed(texts, kind) {
      available();
      if (kind !== 'query' && kind !== 'document' || !Array.isArray(texts) || texts.length > 32) throw new Error('本机模型批次无效，请缩小范围。');
      if (!texts.length) return [];
      const inputs = texts.map(text => {
        if (typeof text !== 'string' || !text.trim()) throw new Error('嵌入文本不能为空。');
        if (tokens(text, false).length > fixedManifest.textTokens) throw new Error('检索范围超过400 token，请缩小范围；未截断原文。');
        const input = kind === 'query' ? fixedManifest.queryPrefix + text : text;
        if (tokens(input, true).length > fixedManifest.windowTokens) throw new Error('本机模型总输入超过512 token，请缩小范围。');
        return input;
      });
      const output = await extractor(inputs, { pooling: 'cls', normalize: true });
      if (output.dims.length !== 2 || output.dims[0] !== inputs.length || output.dims[1] !== fixedManifest.dimensions || output.data.length !== inputs.length * fixedManifest.dimensions) throw new Error('本机模型向量维数异常。');
      const values = Array.from(output.data);
      return inputs.map((_, index) => {
        const vector = Float32Array.from(values.slice(index * 512, (index + 1) * 512));
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
        if (!vector.every(Number.isFinite) || Math.abs(norm - 1) > 1e-4) throw new Error('本机模型向量包含无效值或未归一化。');
        return vector;
      });
    },
    async dispose() { if (!disposed) { disposed = true; await extractor.dispose(); } },
  };
}
