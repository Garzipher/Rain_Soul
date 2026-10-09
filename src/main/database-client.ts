import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { operationError } from '../shared/operation-errors';

export class DatabaseClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private failure: Error | null = null;
  constructor(directory: string) {
    this.worker = new Worker(join(__dirname, 'database-worker.cjs'), { workerData: { directory } });
    this.worker.on('message', (reply: { requestId: string; ok: boolean; data?: unknown; message?: string; code?: string }) => {
      const request = this.pending.get(reply.requestId);
      if (!request) return;
      this.pending.delete(reply.requestId);
      if (reply.ok) request.resolve(reply.data); else request.reject(operationError(reply.message ?? '保存失败', reply.code));
    });
    this.worker.on('error', error => this.fail(error instanceof Error ? error : new Error('存储服务启动失败')));
    this.worker.on('exit', () => this.fail(new Error('存储服务已停止，请保留草稿并重新启动应用')));
  }
  request(command: string, payload: unknown): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ requestId, command, payload });
    });
  }
  close(): void { void this.worker.terminate(); }
  private fail(error: Error): void {
    this.failure = error;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
