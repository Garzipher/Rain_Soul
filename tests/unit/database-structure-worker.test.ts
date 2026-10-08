import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { emptyDocument } from '../../src/shared/document';
import type { StructureAction, WorkDetail } from '../../src/shared/contracts';
import { StoreService } from '../../src/main/store-service';

it('主进程与实际 Worker 往返保留卷章归属、删除及恢复权限', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rainsoul-structure-worker-'));
  const worker = new Worker(resolve('dist/desktop/database-worker.cjs'), { workerData: { directory } });
  const transport = (command: string, payload: unknown) => new Promise<unknown>((resolveResult, reject) => {
    const requestId = crypto.randomUUID();
    const failed = (error: Error) => { worker.off('message', received); reject(error); };
    const received = (reply: { requestId: string; ok: boolean; data?: unknown; message?: string }) => {
      if (reply.requestId !== requestId) return;
      worker.off('message', received); worker.off('error', failed);
      if (reply.ok) resolveResult(reply.data); else reject(new Error(reply.message));
    };
    worker.on('message', received); worker.once('error', failed);
    worker.postMessage({ requestId, command, payload });
  });
  const service = new StoreService(transport);
  try {
    const initial = await service.execute('listWorks', {}) as { id: string; title: string; chapterCount: number }[];
    expect(initial).toEqual([expect.objectContaining({ title: '项目全流程开发学习' })]);
    const learning = await service.execute('openWork', { id: initial[0].id }) as WorkDetail;
    expect(learning.volumes.length).toBeGreaterThanOrEqual(4);
    expect(learning.chapters.length).toBeGreaterThanOrEqual(12);
    expect(JSON.stringify(learning.chapters[0].document)).toContain('学习目标');
    let work = await service.execute('createWork', { title: '链路验收' }) as WorkDetail;
    const change = async (action: StructureAction) => {
      const result = await service.execute('manageStructure', { workId: work.id, expectedRevision: work.revision, operationId: crypto.randomUUID(), action });
      if (result) work = result as WorkDetail;
      return result;
    };
    await change({ type: 'createVolume', title: '春雨卷' });
    const volumeId = work.volumes[0].id;
    work = await service.execute('addChapter', { workId: work.id, title: '卷内章', expectedRevision: work.revision, operationId: crypto.randomUUID(), volumeId }) as WorkDetail;
    const chapter = work.chapters.find(item => item.title === '卷内章')!;
    expect(chapter.volumeId).toBe(volumeId);
    const document = emptyDocument();
    document.content[0].content = [{ type: 'text', text: '不要丢失' }];
    await service.execute('saveChapter', { workId: work.id, chapterId: chapter.id, title: chapter.title, document, expectedRevision: work.revision, operationId: crypto.randomUUID() });
    work = await service.execute('openWork', { id: work.id }) as WorkDetail;
    await change({ type: 'deleteVolume', volumeId });
    expect(work.chapters.find(item => item.id === chapter.id)).toBeUndefined();
    await change({ type: 'restoreVolume', volumeId });
    expect(work.chapters.find(item => item.id === chapter.id)).toMatchObject({ volumeId, document });
    await change({ type: 'deleteWork' });
    await expect(service.execute('listWorks', {})).resolves.toEqual(initial);
    const deleted = await service.execute('listDeletedWorks', {}) as { id: string; revision: number }[];
    expect(deleted[0].id).toBe(work.id);
    await expect(service.execute('openWork', { id: work.id })).rejects.toThrow();
    await service.execute('manageStructure', { workId: work.id, expectedRevision: deleted[0].revision, operationId: crypto.randomUUID(), action: { type: 'restoreWork' } });
    work = await service.execute('openWork', { id: work.id }) as WorkDetail;
    expect(work.chapters.find(item => item.id === chapter.id)?.document).toEqual(document);
  } finally { await worker.terminate(); await rm(directory, { recursive: true, force: true }); }
});
