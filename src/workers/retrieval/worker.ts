import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { fixedManifest, isRetrievalModelQualified, modelFingerprint } from '../../shared/retrieval-model';
import { validateModelDirectory } from '../../main/retrieval-model-store';
import { createCpuEmbeddingModel } from './model';
import { RetrievalScheduler } from './scheduler';
import { RetrievalCache } from './cache';
import { RetrievalEngine, type IndexEntry, type EngineQuery } from './engine';

let engine: RetrievalEngine | undefined;
let loading: Promise<void> | undefined;
let indexes: Promise<void> = Promise.resolve();
let scheduler: RetrievalScheduler | undefined;
async function load() {
  const threshold = fixedManifest.similarityThreshold;
  if (!isRetrievalModelQualified() || threshold === null) throw new Error('本机模型资格核验尚未完成。');
  await validateModelDirectory(workerData.directory);
  scheduler = new RetrievalScheduler(await createCpuEmbeddingModel(workerData.directory));
  const fingerprint = createHash('sha256').update(modelFingerprint()).digest('hex');
  engine = new RetrievalEngine(new RetrievalCache(workerData.cacheDirectory), scheduler.background, fingerprint, threshold);
}
parentPort?.on('message', async (input: unknown) => {
  const message = input && typeof input === 'object' ? input as { id?: unknown; command?: unknown; payload?: unknown } : {};
  const id = typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 100 ? message.id : null;
  try {
    if (!id || !['load', 'invalidate', 'search', 'index', 'cancel'].includes(String(message.command))) throw new Error('本机命令无效。');
    if (message.command === 'cancel') { if (typeof message.payload !== 'string' || message.payload.length > 100) throw new Error('取消身份无效。'); scheduler?.cancel(message.payload); return; }
    let data: unknown;
    if (message.command === 'load') { loading ??= load(); await loading; }
    else {
      await loading; if (!engine) throw new Error('本机模型尚未加载。');
      if (message.command === 'invalidate') engine.invalidateWork(message.payload as string);
      else if (message.command === 'search') data = await scheduler!.withQuery(id, () => engine!.search(message.payload as EngineQuery));
      else if (message.command === 'index') {
        const request=message.payload as {entries:IndexEntry[];workIds:string[]};
        const operation = indexes.catch(() => {}).then(() => engine!.index(request.entries,request.workIds)); indexes = operation; await operation;
      } else throw new Error('未知本机检索命令。');
    }
    parentPort!.postMessage({ id, ok: true, data });
  } catch (error) {
    const tooLong = error && typeof error === 'object' && 'code' in error && error.code === 'RETRIEVAL_QUERY_TOO_LONG';
    parentPort!.postMessage({ id, ok: false, ...(tooLong ? { code: 'RETRIEVAL_QUERY_TOO_LONG', message: '查询超过400 token，请缩小范围。' } : { message: '本机模型执行失败，请使用关键词检索。' }) });
  }
});
