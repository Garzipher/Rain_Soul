import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { StoreService } from '../../src/main/store-service';
import type { WorkDetail } from '../../src/shared/contracts';

it('实际Worker接受受控资产命令，保存正文后搜索可定位，非法请求不停止链路', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rainsoul-assets-worker-'));
  const worker = new Worker(resolve('dist/desktop/database-worker.cjs'), { workerData: { directory } });
  const transport = (command: string, payload: unknown) => new Promise<unknown>((resolveReply, reject) => {
    const requestId = crypto.randomUUID();
    const failed = (error: Error) => { worker.off('message', receive); reject(error); };
    const receive = (reply: { requestId: string; ok: boolean; data?: unknown; message?: string }) => {
      if (reply.requestId !== requestId) return;
      worker.off('message', receive); worker.off('error', failed);
      if (reply.ok) resolveReply(reply.data); else reject(new Error(reply.message));
    };
    worker.on('message', receive); worker.once('error', failed); worker.postMessage({ requestId, command, payload });
  });
  const store = new StoreService(transport);
  try {
    let work = await store.execute('createWork', { title: '资产链路验收' }) as WorkDetail;
    expect(work.assets!.categories.map(category => category.name)).toContain('人物描写');
    const operationId = crypto.randomUUID();
    const request = { workId: work.id, expectedRevision: work.revision, operationId, action: { type: 'createTag', name: '雨夜' } };
    work = await store.execute('manageAssets', request) as WorkDetail;
    expect(work.assets!.tags.map(tag => tag.name)).toEqual(['雨夜']);
    expect((await store.execute('manageAssets', request) as WorkDetail).revision).toBe(work.revision);
    await expect(store.execute('manageAssets', { ...request, operationId: crypto.randomUUID(), action: { type: 'deleteCategory', id: 'invalid', destinationId: null } })).rejects.toThrow();
    const chapter = work.chapters[0]; const document = structuredClone(chapter.document);
    document.content[0].content = [{ type: 'text', text: '雨夜灯塔旁，旧钟再次响起。' }];
    await store.execute('saveChapter', { workId: work.id, chapterId: chapter.id, title: chapter.title, document, expectedRevision: work.revision, operationId: crypto.randomUUID() });
    const results = await store.execute('searchWork', { workId: work.id, query: { text: '灯塔旁', mode: 'all' } });
    expect(results).toEqual([expect.objectContaining({ kind: 'paragraph', chapterId: chapter.id, paragraphId: document.content[0].attrs.id })]);
    const reopened = await store.execute('openWork', { id: work.id }) as WorkDetail;
    expect(reopened.assets!.tags.map(tag => tag.name)).toEqual(['雨夜']);
    work = await store.execute('manageAssets', { workId: work.id, expectedRevision: reopened.revision, operationId: crypto.randomUUID(), action: { type: 'createKnowledge', body: '灯塔旁的雨夜描写', source: '原作第二章', categoryId: work.assets!.categories[1].id, tagIds: [] } }) as WorkDetail;
    const target = await store.execute('createWork', { title: '复用知识的作品' }) as WorkDetail;
    const scope = await store.execute('readKnowledgeScope', { scopeId: null }) as Awaited<ReturnType<WorkRepositoryScope['readKnowledgeScope']>>;
    expect(scope.knowledge).toHaveLength(1);
    const owner = scope.entryOwners[scope.knowledge[0].id];
    const copied = await store.execute('copyKnowledge', { workId: target.id, expectedRevision: target.revision, operationId: crypto.randomUUID(), sourceWorkId: owner.workId, sourceEntryId: owner.sourceEntryId, sourceExpectedRevision: owner.sourceRevision, categoryId: target.assets!.categories[0].id, tagIds: [] }) as WorkDetail;
    expect(copied.assets!.knowledge[0].origin).toMatchObject({ workId: work.id, entryId: work.assets!.knowledge[0].id });
    await expect(store.execute('manageAssets', { workId: target.id, expectedRevision: copied.revision, operationId: crypto.randomUUID(), action: { type: 'createTag', name: '风雨' } })).resolves.toMatchObject({ id: target.id });
  } finally { await worker.terminate(); await rm(directory, { recursive: true, force: true }); }
});
type WorkRepositoryScope = import('../../src/shared/contracts').DesktopApi;
