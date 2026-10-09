import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { emptyDocument } from '../../src/shared/document';
import type { WorkDetail } from '../../src/shared/contracts';

it('编译后的Worker接受白名单请求并真实持久化，错误不停止后续请求', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rainsoul-worker-'));
  const worker = new Worker(resolve('dist/desktop/database-worker.cjs'), { workerData: { directory } });
  const request = (command: string, payload: unknown) => new Promise<unknown>((resolveResult, reject) => {
    const requestId = crypto.randomUUID();
    const handler = (reply: { requestId: string; ok: boolean; data?: unknown; message?: string }) => {
      if (reply.requestId !== requestId) return;
      worker.off('message', handler);
      if (reply.ok) resolveResult(reply.data); else reject(new Error(reply.message));
    };
    worker.on('message', handler);
    worker.once('error', reject);
    worker.postMessage({ requestId, command, payload });
  });
  try {
    await expect(request('unsafeSQL', {})).rejects.toThrow('未知存储命令');
    const work = await request('createWork', { title: '真实线程' }) as WorkDetail;
    const document = emptyDocument();
    document.content[0].content = [{ type: 'text', text: '落盘' }];
    await expect(request('saveChapter', { workId: work.id, chapterId: work.chapters[0].id, title: '第一章', document, expectedRevision: work.revision, operationId: crypto.randomUUID() })).resolves.toMatchObject({ revision: 2, wordCount: 2 });
    const reopened = await request('openWork', { id: work.id }) as WorkDetail;
    expect(reopened.chapters[0].document).toEqual(document);
  } finally { await worker.terminate(); await rm(directory, { recursive: true, force: true }); }
});
