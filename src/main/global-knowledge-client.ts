import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { operationError } from '../shared/operation-errors';

/** 独立全局worker按首次访问启动；退出或失败绝不终止作品存储。 */
export class GlobalKnowledgeClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; command: string; payload: unknown }>();
  private readonly replay = new Map<string, { command: string; payload: unknown }>();
  private closed = false;
  private readonly settled = new Set<Promise<unknown>>();
  constructor(private readonly directory: string) {}
  private start() {
    if (this.worker) return this.worker;
    const worker = new Worker(join(__dirname, 'global-knowledge-worker.cjs'), { workerData: { directory: this.directory } }); this.worker = worker;
    worker.on('message', (reply: { requestId: string; ok: boolean; data?: unknown; message?: string; code?: string }) => {
      if (this.worker !== worker) return;
      this.replay.delete(reply.requestId);
      const request = this.pending.get(reply.requestId); if (!request) return;
      this.pending.delete(reply.requestId);
      if (reply.ok) request.resolve(reply.data); else request.reject(operationError(reply.message ?? '全局知识库操作失败。', reply.code));
    });
    worker.on('error', () => this.fail(worker, new Error('全局知识库服务异常，作品编辑不受影响。')));
    worker.on('exit', () => this.fail(worker, new Error('全局知识库服务已停止，作品编辑不受影响。')));
    for (const [requestId, request] of this.replay) {
      try { worker.postMessage({ requestId, ...request }); }
      catch { this.fail(worker, new Error('全局知识库请求未能重放，作品编辑不受影响。')); break; }
    }
    return worker;
  }
  request(command: string, payload: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('全局知识库已关闭。'));
    try {
      const worker = this.start(), requestId = randomUUID();
      const task = new Promise((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject, command, payload });
        try { worker.postMessage({ requestId, command, payload }); } catch { this.pending.delete(requestId); reject(new Error('全局知识库请求未能发送。')); }
      });
      this.settled.add(task);
      void task.then(() => this.settled.delete(task), () => this.settled.delete(task));
      return task;
    } catch { return Promise.reject(new Error('全局知识库启动失败，作品编辑不受影响。')); }
  }
  close(): void {
    this.closed = true;
    const worker = this.worker;
    if (worker) { this.fail(worker, new Error('全局知识库已关闭。')); void worker.terminate(); }
    else this.rejectPending(new Error('全局知识库已关闭。'));
  }
  async drain(): Promise<void> { while (this.settled.size) await Promise.allSettled([...this.settled]); }
  private rejectPending(error: Error) { for (const request of this.pending.values()) request.reject(error); this.pending.clear(); }
  private fail(worker: Worker, error: Error) {
    if (this.worker !== worker) return;
    this.worker = null;
    for (const [requestId, request] of this.pending) {
      if (!this.closed && request.payload && typeof request.payload === 'object' && 'operationId' in request.payload) {
        this.replay.set(requestId, { command: request.command, payload: request.payload });
      }
      request.reject(error);
    }
    this.pending.clear();
  }
}
