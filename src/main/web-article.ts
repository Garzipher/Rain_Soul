import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ArticleText } from './web-article-core';

export interface ArticleLimits { deadline: number; maxNodes: number }
export interface ArticleWorkerDependencies { createWorker?: () => Worker }

/** 主进程看门狗负责终止CPU解析；取消不会等待Worker返回。 */
export function parseWebArticle(bytes: Buffer, contentType: string, signal: AbortSignal, limits: ArticleLimits, dependencies: ArticleWorkerDependencies = {}): Promise<ArticleText> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('网页解析已取消。')); return; }
    const remaining = limits.deadline - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) { reject(new Error('网页解析超时。')); return; }
    if (bytes.length > 5 * 1024 * 1024) { reject(new Error('网页正文过大。')); return; }
    let worker: Worker;
    try { worker = dependencies.createWorker?.() ?? new Worker(join(__dirname, 'web-article-worker.cjs'), { resourceLimits: { maxOldGenerationSizeMb: 128 } }); }
    catch { reject(new Error('无法启动网页解析，请稍后重试。')); return; }
    let settled = false;
    const finish = (error: Error | null, result?: ArticleText) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new Error('网页解析已取消。'));
    const timer = setTimeout(() => finish(new Error('网页解析超时，请粘贴正文。')), Math.min(remaining, 30000));
    signal.addEventListener('abort', abort, { once: true });
    worker.once('error', () => finish(new Error('网页解析失败，请粘贴正文。')));
    worker.once('exit', () => finish(new Error('网页解析中断，请粘贴正文。')));
    worker.once('message', (reply: { ok: boolean; data?: ArticleText; message?: string }) => {
      if (signal.aborted) { abort(); return; }
      if (Date.now() >= limits.deadline) { finish(new Error('网页解析超时。')); return; }
      if (!reply || typeof reply !== 'object' || typeof reply.ok !== 'boolean') { finish(new Error('网页解析结果无效。')); return; }
      if (!reply.ok) { finish(new Error(typeof reply.message === 'string' ? reply.message : '网页正文解析失败。')); return; }
      if (!reply.data || typeof reply.data.title !== 'string' || !Array.isArray(reply.data.paragraphs) || !reply.data.paragraphs.every(text => typeof text === 'string')) {
        finish(new Error('网页解析结果无效。')); return;
      }
      finish(null, reply.data);
    });
    try { worker.postMessage({ bytes: Uint8Array.from(bytes), contentType, maxNodes: limits.maxNodes }); }
    catch { finish(new Error('网页解析任务无效。')); }
  });
}
