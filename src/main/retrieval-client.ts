import { Worker } from 'node:worker_threads';
import type { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EngineQuery, IndexEntry } from '../workers/retrieval/engine';
import type { RetrievalHit } from '../shared/retrieval';

interface WorkerLike {
  on: EventEmitter['on'];
  postMessage(value: unknown): void; terminate(): Promise<number>;
}
interface Dependencies {
  createWorker?: (directory: string) => WorkerLike; loadTimeout?: number; queryTimeout?: number;
  memoryLimit?: number; rss?: () => number;
}
/** 独立Worker失败即终止，保留作者库；重建仅发生在下次作者主动查询。 */
export class RetrievalClient {
  private worker: WorkerLike | null = null;
  private directory: string | null = null;
  private loading: Promise<void> | null = null;
  private indexing = 0;
  private readonly activeQueries = new Map<string, object>();
  private monitor?: ReturnType<typeof setInterval>;
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; queryId?: string }>();
  constructor(private readonly cacheDirectory: string, private readonly dependencies: Dependencies = {}) {}
  private async start(directory: string): Promise<void> {
    if (this.worker && this.directory === directory) { await this.loading; return; }
    this.close(); this.directory = directory;
    const worker: WorkerLike = this.dependencies.createWorker?.(directory) ?? new Worker(join(__dirname, 'retrieval-worker.cjs'), {
      workerData: { directory, cacheDirectory: this.cacheDirectory }, resourceLimits: { maxOldGenerationSizeMb: 384 },
    });
    this.worker = worker;
    worker.on('message', ((reply: { id: string; ok: boolean; data?: unknown; message?: string } | null) => {
      if (worker !== this.worker) return;
      if (!reply || typeof reply !== 'object' || typeof reply.id !== 'string' || typeof reply.ok !== 'boolean') {
        this.fail(new Error('本机检索回执无效。')); return;
      }
      const pending = this.pending.get(reply.id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(reply.id);
      if (reply.ok) pending.resolve(reply.data); else pending.reject(new Error(reply.message ?? '本机模型执行失败。'));
    }));
    worker.on('error', ((error: Error) => { if (worker === this.worker) this.fail(error); }));
    worker.on('exit', (() => { if (worker === this.worker) this.fail(new Error('本机检索服务停止。')); }));
    const rss = this.dependencies.rss ?? (() => process.memoryUsage().rss), baseline = rss();
    this.monitor = setInterval(() => { if (worker === this.worker && rss() - baseline > (this.dependencies.memoryLimit ?? 1.5 * 1024 ** 3)) this.fail(new Error('本机模型内存超过预算。')); }, 100);
    this.monitor.unref();
    const loading = this.send('load', {}, this.dependencies.loadTimeout ?? 30000).then(() => {});
    this.loading = loading;
    try { await loading; } catch (error) { if (worker === this.worker) this.fail(error instanceof Error ? error : new Error('模型加载失败。')); throw error; }
  }
  private send(command: string, payload: unknown, timeout: number, queryId?: string): Promise<unknown> {
    const worker = this.worker; if (!worker) return Promise.reject(new Error('本机检索未启动。'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('本机检索超时，已退回关键词。')), timeout);
      this.pending.set(id, { resolve, reject, timer, queryId });
      try { worker.postMessage({ id, command, payload }); }
      catch (error) { this.fail(error instanceof Error ? error : new Error('模型命令发送失败。')); }
    });
  }
  async search(request: EngineQuery, directory: string, queryId: string): Promise<RetrievalHit[]> {
    const identity = {};
    if (this.activeQueries.has(queryId)) throw new Error('检索查询身份重复。');
    this.activeQueries.set(queryId, identity);
    try {
      await this.start(directory);
      if (this.activeQueries.get(queryId) !== identity) throw new Error('检索已取消。');
      return await this.send('search', request, this.dependencies.queryTimeout ?? 30000, queryId) as RetrievalHit[];
    } finally { if (this.activeQueries.get(queryId) === identity) this.activeQueries.delete(queryId); }
  }
  async index(entries: IndexEntry[], directory: string): Promise<void> {
    await this.start(directory); this.indexing++;
    try { await this.send('index', entries, 30 * 60 * 1000); } finally { this.indexing = Math.max(0, this.indexing - 1); }
  }
  isIndexing() { return this.indexing > 0; }
  invalidateWork(workId: string): void { this.worker?.postMessage({ id: randomUUID(), command: 'invalidate', payload: workId }); }
  cancel(queryId: string): void {
    this.activeQueries.delete(queryId);
    for (const [id, pending] of this.pending) if (pending.queryId === queryId) {
      this.worker?.postMessage({ id: randomUUID(), command: 'cancel', payload: id });
      clearTimeout(pending.timer); this.pending.delete(id); pending.reject(new Error('检索已取消。'));
    }
  }
  close() { this.fail(new Error('本机检索已关闭。')); }
  private fail(error: Error) {
    const worker = this.worker; this.worker = null; this.directory = null; this.loading = null; this.indexing = 0;
    clearInterval(this.monitor);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); if (worker) void worker.terminate();
  }
}
