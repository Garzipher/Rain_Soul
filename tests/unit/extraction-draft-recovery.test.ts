import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExtractionDraftStore } from '../../src/main/extraction-draft-store';
import { ExtractionDraftCoordinator } from '../../src/main/extraction-draft-coordinator';
import { freezeSource } from '../../src/main/freeze-source';
import { sourcePreview } from '../../src/main/web-extraction-commands';
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'rainsoul-recovery-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function sample() {
  const workId = randomUUID(), categoryId = randomUUID();
  const preview = sourcePreview(workId, freezeSource({ kind: 'paste', title: '雨景', rawBytes: Buffer.from('雨落窗边'), segments: [{ text: '雨落窗边' }] }));
  const store = { execute: vi.fn(async (command: string) => command === 'getBookExtractionReceipt' ? { status: 'missing' } : { id: workId, revision: 2 }) };
  const drafts = new ExtractionDraftStore(root), coordinator = new ExtractionDraftCoordinator(drafts, store);
  await coordinator.begin(preview);
  const request = { workId, expectedRevision: 1, operationId: randomUUID(), sourceDocument: preview.source,
    items: [{ body: '雨落窗边', source: '可信出处', segmentId: preview.segments[0].id, categoryId, tagIds: [] }] };
  return { workId, preview, store, drafts, coordinator, request };
}
it('提交前持久保存完整请求；丢失回执重启按同身份重放，不刷新revision', async () => {
  const { coordinator, store, request, drafts, workId } = await sample();
  store.execute.mockImplementationOnce(async () => { throw new Error('回执丢失'); });
  await expect(coordinator.commit(request)).rejects.toThrow('回执丢失');
  expect((await drafts.readExtractionDraft(workId))?.committing?.request).toEqual(request);
  const restarted = new ExtractionDraftCoordinator(drafts, store);
  await restarted.recover(workId);
  expect(store.execute).toHaveBeenLastCalledWith('importBookExtraction', request);
  const draft = await drafts.readExtractionDraft(workId);
  expect(draft?.committing).toBeNull(); expect(draft?.reviews[0].status).toBe('committed');
});
it('已提交回执恢复只读，不重复入库；仍保留未处理素材', async () => {
  const { coordinator, store, request, drafts, workId } = await sample();
  store.execute.mockImplementationOnce(async () => { throw new Error('回执丢失'); });
  await expect(coordinator.commit(request)).rejects.toThrow();
  store.execute.mockResolvedValueOnce({ status: 'committed', revision: 2, result: { id: workId, revision: 2 } } as never);
  const recovered = await new ExtractionDraftCoordinator(drafts, store).recover(workId);
  expect(recovered?.work).toEqual({ id: workId, revision: 2 }); expect(store.execute).toHaveBeenCalledTimes(2);
  expect((await drafts.readExtractionDraft(workId))?.source.segments).toHaveLength(1);
});
it('待确认回执不能改请求，重复已入库段落和伪造来源拒绝', async () => {
  const { coordinator, store, request } = await sample();
  store.execute.mockRejectedValueOnce(new Error('未知结果'));
  await expect(coordinator.commit(request)).rejects.toThrow();
  await expect(coordinator.commit({ ...request, expectedRevision: 3 })).rejects.toThrow(/回执|冻结/);
  await coordinator.recover(request.workId);
  await expect(coordinator.commit({ ...request, operationId: randomUUID(), expectedRevision: 2 })).rejects.toThrow(/入库/);
  await expect(coordinator.commit({ ...request, sourceDocument: { ...request.sourceDocument!, title: '伪造' } })).rejects.toThrow();
});
it('冻结入库请求禁止普通保存清空、任务替换和删除', async () => {
  const { coordinator,store,request,drafts,workId }=await sample();
  store.execute.mockRejectedValueOnce(new Error('未知结果')); await expect(coordinator.commit(request)).rejects.toThrow();
  const pending=(await drafts.readExtractionDraft(workId))!;
  await expect(drafts.saveExtractionDraft({expectedTaskId:pending.taskId,draft:{...pending,committing:null}})).rejects.toThrow(/冻结|回执/);
  await expect(drafts.saveExtractionDraft({expectedTaskId:pending.taskId,draft:{...pending,taskId:randomUUID()}})).rejects.toThrow(/冻结|回执/);
  await expect(drafts.discardExtractionDraft(workId,pending.taskId)).rejects.toThrow(/冻结|回执/);
  expect((await drafts.readExtractionDraft(workId))?.committing).toEqual(pending.committing);
});
it('跨coordinator实例串行核对回执，未知请求未结束不能替换素材', async () => {
  const { coordinator,store,request,drafts,workId,preview }=await sample();
  store.execute.mockRejectedValueOnce(new Error('未知结果')); await expect(coordinator.commit(request)).rejects.toThrow();
  let release!:()=>void;
  store.execute.mockImplementationOnce(async()=> { await new Promise<void>(resolve=>{release=resolve;}); return {status:'missing'}; });
  store.execute.mockRejectedValueOnce(new Error('暂时无法重放'));
  const recovery=coordinator.recover(workId), rejected=expect(recovery).rejects.toThrow('暂时无法重放');
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  const replacing=new ExtractionDraftCoordinator(drafts,store).begin(preview), replacementRejected=expect(replacing).rejects.toThrow(/回执/);
  release(); await rejected; await replacementRejected;
  expect((await drafts.readExtractionDraft(workId))?.committing?.request).toEqual(request);
});
it('受限审核保存绑定token，已提交只读且不开放伪造committed，discard遵守待回执保护', async () => {
  const {coordinator,store,request,workId,preview,drafts}=await sample();
  const review={segmentId:preview.segments[0].id,body:'雨落窗边',categoryId:request.items[0].categoryId,tagIds:[],status:'approved' as const};
  await coordinator.saveReviews(workId,preview.token,[review]);
  await expect(coordinator.saveReviews(workId,randomUUID(),[review])).rejects.toThrow(/预览/);
  await expect(coordinator.saveReviews(workId,preview.token,[{...review,status:'committed'}])).rejects.toThrow(/提交|入库/);
  store.execute.mockRejectedValueOnce(new Error('未知结果')); await expect(coordinator.commit(request)).rejects.toThrow();
  await expect(coordinator.saveReviews(workId,preview.token,[review])).rejects.toThrow(/回执/);
  const draft=(await drafts.readExtractionDraft(workId))!; await expect(coordinator.discard(workId,draft.taskId)).rejects.toThrow(/回执/);
  await coordinator.recover(workId);
  await expect(coordinator.saveReviews(workId,preview.token,[{...review,body:'篡改已提交'}])).rejects.toThrow(/提交|入库/);
  await coordinator.saveReviews(workId,preview.token,[]); expect((await drafts.readExtractionDraft(workId))?.reviews[0].status).toBe('committed');
});
it('过期回执hash不能清除pending，预览切换回调作废排队中的begin', async () => {
  const {coordinator,store,request,drafts,workId,preview}=await sample();
  store.execute.mockRejectedValueOnce(new Error('未知结果')); await expect(coordinator.commit(request)).rejects.toThrow();
  const draft=(await drafts.readExtractionDraft(workId))!;
  await expect(drafts.settleExtractionDraft({expectedTaskId:draft.taskId,draft:{...draft,committing:null}},request.operationId,'b'.repeat(64))).rejects.toThrow(/回执/);
  await expect(coordinator.begin(preview,()=>false)).rejects.toThrow(/替换/);
  expect((await drafts.readExtractionDraft(workId))?.committing?.request).toEqual(request);
});
