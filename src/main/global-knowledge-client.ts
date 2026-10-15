import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { operationError } from '../shared/operation-errors';

/** 独立全局worker按首次访问启动；退出或失败绝不终止作品存储。 */
export class GlobalKnowledgeClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private failure: Error | null = null;
  constructor(private readonly directory: string) {}
  private start() {
    if (this.worker) return this.worker;
    const worker = new Worker(join(__dirname, 'global-knowledge-worker.cjs'), { workerData: { directory: this.directory } }); this.worker = worker;
    worker.on('message', (reply: { requestId: string; ok: boolean; data?: unknown; message?: string; code?: string }) => {
      const request = this.pending.get(reply.requestId); if (!request) return;
      this.pending.delete(reply.requestId);
      if (reply.ok) request.resolve(reply.data); else request.reject(operationError(reply.message ?? '全局知识库操作失败。', reply.code));
    });
    worker.on('error', () => this.fail(new Error('全局知识库服务异常，作品编辑不受影响。')));
    worker.on('exit', () => this.fail(new Error('全局知识库服务已停止，作品编辑不受影响。')));
    return worker;
  }
  request(command: string, payload: unknown): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    try {
      const worker = this.start(), requestId = randomUUID();
      return new Promise((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject });
        try { worker.postMessage({ requestId, command, payload }); } catch { this.pending.delete(requestId); reject(new Error('全局知识库请求未能发送。')); }
      });
    } catch { return Promise.reject(new Error('全局知识库启动失败，作品编辑不受影响。')); }
  }
  close(): void { this.fail(new Error('全局知识库已关闭。')); void this.worker?.terminate(); }
  private fail(error: Error) { this.failure = error; for (const request of this.pending.values()) request.reject(error); this.pending.clear(); }
}
