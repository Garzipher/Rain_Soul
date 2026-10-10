import { parentPort } from 'node:worker_threads';
import { parseArticleDocument } from './web-article-core';

parentPort?.once('message', ({ bytes, contentType, maxNodes }: { bytes: Uint8Array; contentType: string; maxNodes: number }) => {
  try { parentPort!.postMessage({ ok: true, data: parseArticleDocument(bytes, contentType, maxNodes) }); }
  catch (error) { parentPort!.postMessage({ ok: false, message: error instanceof Error ? error.message : '网页正文解析失败。' }); }
});
