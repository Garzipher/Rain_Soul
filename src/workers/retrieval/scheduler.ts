import { AsyncLocalStorage } from 'node:async_hooks';
import type { CpuEmbeddingModel } from './model';

interface Job { text: string; kind: 'query' | 'document'; queryId?: string; settled: boolean; resolve(vector: Float32Array): void; reject(error: Error): void }
/** 单条CPU推理不可中断；取消立即拒绝等待者并丢弃回执，查询抢占排队文档。 */
export class RetrievalScheduler {
  private readonly context = new AsyncLocalStorage<string>();
  private readonly foreground: Job[] = [];
  private readonly documents: Job[] = [];
  private current?: Job;
  private running = false;
  private readonly canceled = new Set<string>();
  readonly background: CpuEmbeddingModel;
  constructor(private readonly model: CpuEmbeddingModel) { this.background = this.adapter(); }
  query(queryId: string): CpuEmbeddingModel { return this.adapter(queryId); }
  async withQuery<T>(queryId: string, action: () => Promise<T>): Promise<T> {
    try { return await this.context.run(queryId, action); }
    finally { this.canceled.delete(queryId); }
  }
  cancel(queryId: string) {
    if (!this.foreground.some(job => job.queryId === queryId) && this.current?.queryId !== queryId) return;
    this.canceled.add(queryId);
    for (const job of [...this.foreground, ...(this.current ? [this.current] : [])]) if (job.queryId === queryId) this.reject(job, new Error('检索已取消。'));
    for (let index = this.foreground.length - 1; index >= 0; index--) if (this.foreground[index].queryId === queryId) this.foreground.splice(index, 1);
  }
  private reject(job: Job, error: Error) { if (!job.settled) { job.settled = true; job.reject(error); } }
  private adapter(queryId?: string): CpuEmbeddingModel {
    return { tokenize: text => this.model.tokenize(text), dispose: () => this.model.dispose(),
      embed: (texts, kind) => Promise.all(texts.map(text => new Promise<Float32Array>((resolve, reject) => {
        const id = queryId ?? this.context.getStore();
        if (id && this.canceled.has(id)) { reject(new Error('检索已取消。')); return; }
        (kind === 'query' ? this.foreground : this.documents).push({ text, kind, queryId: id, settled: false, resolve, reject });
        void this.drain();
      }))) };
  }
  private async drain() {
    if (this.running) return; this.running = true;
    try {
      while (this.foreground.length || this.documents.length) {
        const job = this.current = this.foreground.shift() ?? this.documents.shift()!;
        try {
          const vectors = await this.model.embed([job.text], job.kind);
          if (!job.settled) { job.settled = true; job.resolve(vectors[0]); }
        } catch (error) { this.reject(job, error instanceof Error ? error : new Error('本机推理失败。')); }
        this.current = undefined;
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    } finally { this.running = false; }
  }
}
