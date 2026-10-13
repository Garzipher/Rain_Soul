import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { freezeSource } from '../../src/main/freeze-source';
import { ExtractionDraftStore } from '../../src/main/extraction-draft-store';
import { bookExtractionCommitSchema } from '../../src/shared/book-extraction';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'rainsoul-draft-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function sample() {
  const source = freezeSource({ kind: 'paste', title: '摘选素材', rawBytes: Buffer.from('雨落在岸边。'), segments: [{ text: '雨落在岸边。' }] });
  const categoryId = randomUUID(), segmentId = source.segments[0].id;
  return { schemaVersion: 1 as const, taskId: randomUUID(), workId: randomUUID(), previewToken: randomUUID(), source,
    batches: [{ id: randomUUID(), requestHash: 'a'.repeat(64), segmentIds: [segmentId], status: 'ready' as const,
      categoryIds: [categoryId], tagIds: [], suggestions: [{ segmentId, excerpt: '雨落在岸边。', categoryId, tagIds: [], technique: '借雨写景', usage: '雨夜场景', exercise: '仿写岸边的风' }] }],
    reviews: [{ segmentId, body: '雨落在岸边。', categoryId, tagIds: [], status: 'approved' as const }], committing: null };
}
it('重启保留原文、完成候选和审核草稿，返回副本且不自动联网', async () => {
  const draft = sample(), store = new ExtractionDraftStore(root);
  await store.saveExtractionDraft({ draft, expectedTaskId: null });
  const restarted = new ExtractionDraftStore(root), loaded = await restarted.readExtractionDraft(draft.workId);
  expect(loaded).toEqual(draft);
  loaded!.source.segments[0].text = '篡改返回值';
  expect(await restarted.readExtractionDraft(draft.workId)).toEqual(draft);
  expect(await restarted.readExtractionDraft(randomUUID())).toBeNull();
});
it('受限网页草稿重启完整保留捕获证据，来源身份损坏拒绝恢复', async () => {
  const draft = sample(), store = new ExtractionDraftStore(root);
  draft.source = freezeSource({ kind: 'web', title: '受限来源', rawBytes: Buffer.from('原HTML'), originalUrl: 'https://example.com/article',
    finalUrl: 'https://example.com/article', fetchedAt: '2026-10-13T00:00:00Z', segments: [{ text: '雨落在岸边。' }],
    capture: { captureMethod: 'restricted-browser', capturedAt: '2026-10-13T00:00:00Z', policyVersion: 1, renderedDomHash: 'd'.repeat(64) } });
  const segmentId = draft.source.segments[0].id;
  draft.batches[0].segmentIds = [segmentId]; draft.batches[0].suggestions[0].segmentId = segmentId; draft.reviews[0].segmentId = segmentId;
  await store.saveExtractionDraft({ draft, expectedTaskId: null });
  expect((await new ExtractionDraftStore(root).readExtractionDraft(draft.workId))?.source.capture).toEqual(draft.source.capture);
  const broken = structuredClone(draft); broken.source.capture!.sourceId = randomUUID();
  await writeFile(join(root, `${draft.workId}.json`), JSON.stringify(broken));
  await expect(store.readExtractionDraft(draft.workId)).rejects.toThrow(/损坏/);
});
it('临时写入失败保留旧草稿，清理临时文件；冻结committing请求身份不变', async () => {
  const draft = sample(), store = new ExtractionDraftStore(root);
  await store.saveExtractionDraft({ draft, expectedTaskId: null });
  const request = bookExtractionCommitSchema.parse({ workId: draft.workId, expectedRevision: 7, operationId: randomUUID(), sourceDocument: draft.source,
    items: [{ body: draft.reviews[0].body, source: '冻结出处', segmentId: draft.reviews[0].segmentId, categoryId: draft.reviews[0].categoryId, tagIds: [] }] });
  const requestHash = createHash('sha256').update(JSON.stringify(['book-extraction', request])).digest('hex');
  const next = { ...draft, committing: { request, requestHash } };
  const failure = new ExtractionDraftStore(root, { rename: vi.fn().mockRejectedValue(new Error('磁盘写入失败')) });
  await expect(failure.saveExtractionDraft({ draft: next, expectedTaskId: draft.taskId })).rejects.toThrow('磁盘写入失败');
  expect(await store.readExtractionDraft(draft.workId)).toEqual(draft);
  expect(await readdir(root)).toEqual([`${draft.workId}.json`]);
  await store.saveExtractionDraft({ draft: next, expectedTaskId: draft.taskId });
  expect((await new ExtractionDraftStore(root).readExtractionDraft(draft.workId))?.committing).toEqual(next.committing);
  await expect(store.saveExtractionDraft({ draft: { ...next, committing: { ...next.committing, requestHash: 'b'.repeat(64) } }, expectedTaskId: draft.taskId })).rejects.toThrow(/哈希/);
  const changed = { ...request, expectedRevision: 8 };
  await expect(store.saveExtractionDraft({ draft: { ...next, committing: { request: changed,
    requestHash: createHash('sha256').update(JSON.stringify(['book-extraction', changed])).digest('hex') } }, expectedTaskId: draft.taskId })).rejects.toThrow(/不能改写/);
});
it('损坏JSON、正文hash、伪造摘录、提交hash与路径均拒绝，不擅自删除数据', async () => {
  const draft = sample(), store = new ExtractionDraftStore(root);
  await expect(store.readExtractionDraft('../outside')).rejects.toThrow();
  await expect(store.saveExtractionDraft({ draft: { ...draft, source: { ...draft.source, bodyHash: 'b'.repeat(64) } }, expectedTaskId: null })).rejects.toThrow();
  const forged = structuredClone(draft); forged.batches[0].suggestions[0].excerpt = '原文不存在';
  await expect(store.saveExtractionDraft({ draft: forged, expectedTaskId: null })).rejects.toThrow();
  const wrongCategory = structuredClone(draft); wrongCategory.batches[0].suggestions[0].categoryId = randomUUID();
  await expect(store.saveExtractionDraft({ draft: wrongCategory, expectedTaskId: null })).rejects.toThrow();
  await writeFile(join(root, `${draft.workId}.json`), '{broken');
  await expect(store.readExtractionDraft(draft.workId)).rejects.toThrow(/损坏/);
  expect(await readFile(join(root, `${draft.workId}.json`), 'utf8')).toBe('{broken');
});
it('任务替换执行CAS，同一作品并发更新不会覆盖新任务，旧任务不能删除新草稿', async () => {
  const draft = sample(), store = new ExtractionDraftStore(root);
  await store.saveExtractionDraft({ draft, expectedTaskId: null });
  const next = { ...draft, taskId: randomUUID() };
  const outcomes = await Promise.allSettled([
    store.saveExtractionDraft({ draft: next, expectedTaskId: draft.taskId }),
    store.saveExtractionDraft({ draft, expectedTaskId: draft.taskId }),
  ]);
  expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  await expect(store.discardExtractionDraft(draft.workId, draft.taskId)).rejects.toThrow(/替换/);
  expect((await store.readExtractionDraft(draft.workId))?.taskId).toBe(next.taskId);
  await store.discardExtractionDraft(draft.workId, next.taskId);
  expect(await store.readExtractionDraft(draft.workId)).toBeNull();
  await store.discardExtractionDraft(draft.workId, next.taskId);
});
it('拒绝符号链接文件，重启将未完成发送改为取消并禁止持久授权', async () => {
  const draft = sample(), store = new ExtractionDraftStore(root);
  await store.saveExtractionDraft({ draft: { ...draft, batches: [{ ...draft.batches[0], status: 'running', suggestions: [] }] }, expectedTaskId: null });
  expect((await store.readExtractionDraft(draft.workId))?.batches[0].status).toBe('cancelled');
  await expect(store.saveExtractionDraft({ draft: { ...draft, confirmationToken: '旧授权' }, expectedTaskId: draft.taskId })).rejects.toThrow();
  await rm(join(root, `${draft.workId}.json`));
  const outside = join(root, 'outside.json'); await writeFile(outside, JSON.stringify(draft));
  try { await symlink(outside, join(root, `${draft.workId}.json`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error; }
  await expect(store.readExtractionDraft(draft.workId)).rejects.toThrow(/路径/);
});
