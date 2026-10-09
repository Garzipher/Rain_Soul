import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { StoreService } from '../../src/main/store-service';
import type { WorkDetail } from '../../src/shared/contracts';
import type { SnapshotSummary } from '../../src/shared/snapshots';
import type { ExportManuscript } from '../../src/shared/manuscript';

it('正式Worker快照创建恢复后重启保持旧原稿、当前安全稿及全部历史', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rainsoul-snapshot-worker-'));
  let worker!: Worker;
  function start() {
    worker = new Worker(resolve('dist/desktop/database-worker.cjs'), { workerData: { directory } });
    return new StoreService((command, payload) => new Promise((resolveReply, reject) => {
      const requestId = crypto.randomUUID();
      const failed = (error: Error) => { worker.off('message', receive); reject(error); };
      const receive = (reply: { requestId: string; ok: boolean; data?: unknown; message?: string }) => {
        if (reply.requestId !== requestId) return;
        worker.off('message', receive); worker.off('error', failed);
        if (reply.ok) resolveReply(reply.data); else reject(new Error(reply.message));
      };
      worker.on('message', receive); worker.once('error', failed); worker.postMessage({ requestId, command, payload });
    }));
  }
  let store = start();
  try {
    let work = await store.execute('createWork', { title: '快照真实线程' }) as WorkDetail;
    work = await store.execute('createSnapshot', { workId: work.id, expectedRevision: work.revision, operationId: crypto.randomUUID(), title: '原稿' }) as WorkDetail;
    const original = work.chapters[0];
    const snapshot = (await store.execute('listSnapshots', { workId: work.id }) as SnapshotSummary[])[0];
    const document = structuredClone(original.document); document.content[0].content = [{ type: 'text', text: '当前稿不可丢失' }];
    await store.execute('saveChapter', { workId: work.id, chapterId: original.id, title: '当前章节', document, expectedRevision: work.revision, operationId: crypto.randomUUID() });
    work = await store.execute('openWork', { id: work.id }) as WorkDetail;
    const current = structuredClone(work);
    const frozen = await store.execute('freezeSnapshot', { workId: work.id, snapshotId: snapshot.id }) as ExportManuscript;
    expect(frozen).toMatchObject({ title: '快照真实线程', revision: 1, unvolumedChapters: [{ id: original.id, title: original.title, document: original.document }] });
    expect(await store.execute('openWork', { id: work.id })).toEqual(current);
    expect(await store.execute('listSnapshots', { workId: work.id })).toHaveLength(1);
    await expect(store.execute('freezeSnapshot', { workId: work.id, snapshotId: snapshot.id, path: 'C:/private' })).rejects.toThrow();
    await expect(store.execute('freezeSnapshot', { workId: crypto.randomUUID(), snapshotId: snapshot.id })).rejects.toThrow(/当前作品/);
    const restore = { workId: work.id, expectedRevision: work.revision, operationId: crypto.randomUUID(), snapshotId: snapshot.id };
    work = await store.execute('restoreSnapshot', restore) as WorkDetail;
    expect(work.chapters[0].document).toEqual(original.document); expect(work.revision).toBe(4);
    await worker.terminate(); store = start(); work = await store.execute('openWork', { id: work.id }) as WorkDetail;
    const histories = await store.execute('listSnapshots', { workId: work.id }) as SnapshotSummary[];
    expect(histories).toHaveLength(3); expect((await store.execute('restoreSnapshot', restore) as WorkDetail).revision).toBe(4);
    const safety = histories.find(item => item.title === '恢复前：原稿')!;
    await expect(store.execute('previewSnapshot', { workId: work.id, snapshotId: safety.id })).resolves.toMatchObject({ chapters: [{ id: original.id, title: '当前章节', wordCount: 7 }] });
    work = await store.execute('restoreSnapshot', { ...restore, expectedRevision: work.revision, operationId: crypto.randomUUID(), snapshotId: safety.id }) as WorkDetail;
    expect(work.chapters[0].document).toEqual(document);
  } finally { await worker!.terminate(); await rm(directory, { recursive: true, force: true }); }
});
