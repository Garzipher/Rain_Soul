import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BookExtractionAiCommands } from '../../src/main/book-extraction-ai-commands';
import { BookExtractionAiService } from '../../src/main/book-extraction-ai-service';
import { ExtractionDraftStore } from '../../src/main/extraction-draft-store';
import { ExtractionDraftCoordinator } from '../../src/main/extraction-draft-coordinator';
import { freezeSource } from '../../src/main/freeze-source';
import { sourcePreview } from '../../src/main/web-extraction-commands';
import { extractionDraftSchema } from '../../src/shared/extraction-draft';
import type { AiPreparedRequest } from '../../src/shared/ai';
import type { BookExtractionAiResult } from '../../src/shared/book-extraction-ai';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'rainsoul-ai-draft-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function setup() {
  const workId = randomUUID(), categoryId = randomUUID(), tagId = randomUUID();
  let revision = 1, categoryName = '景物描写';
  let preview = sourcePreview(workId, freezeSource({ kind: 'paste', title: '雨景', rawBytes: Buffer.from('雨落窗边'), segments: [{ text: '雨落窗边' }] }));
  const suggestion = { segmentId: preview.segments[0].id, excerpt: '雨落窗边', categoryId, tagIds: [tagId], technique: '听觉', usage: '雨夜', exercise: '写风声' };
  const rawText = JSON.stringify({ suggestions: [suggestion] });
  const response = (content: string) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  const fetcher = vi.fn<typeof fetch>(async () => response(rawText));
  const store = { execute: vi.fn(async () => ({ id: workId, revision, assets: { categories: [{ id: categoryId, name: categoryName }], tags: [{ id: tagId, name: '感官' }] } })) };
  const drafts = new ExtractionDraftStore(root), coordinator = new ExtractionDraftCoordinator(drafts, store);
  await coordinator.begin(preview);
  const create = () => new BookExtractionAiCommands(store, { get: () => ({ provider: { id: 'cloud', name: '测试', baseUrl: 'https://api.example.com/v1', model: 'test' }, hasCredential: true }) },
    { getPreview: (id, token) => { if (id !== workId || token !== preview.token) throw new Error('预览已失效'); return structuredClone(preview); } },
    new BookExtractionAiService({ credentials: { read: async () => 'test-key' }, fetch: fetcher, resolveHost: async () => ['8.8.8.8'], timeoutMs: 1000 }), coordinator);
  const commands = create();
  const prepare = () => commands.execute('prepareBookExtractionAi', { workId, token: preview.token, segmentIds: [preview.segments[0].id], permissionConfirmed: true }) as Promise<AiPreparedRequest>;
  const execute = (prepared: AiPreparedRequest) => commands.execute('executeBookExtractionAi', { confirmed: true, confirmationToken: prepared.confirmationToken, requestHash: prepared.requestHash }) as Promise<BookExtractionAiResult>;
  const lookup = (prepared: AiPreparedRequest) => ({ workId, previewToken: preview.token, requestHash: prepared.requestHash });
  return { workId, preview, categoryId, commands, coordinator, drafts, fetcher, create, prepare, execute, lookup, rawText, response,
    changeRevision: () => { revision++; }, renameCategory: () => { categoryName = '人物描写'; },
    replace: async () => { preview = sourcePreview(workId, freezeSource({ kind: 'paste', title: '新素材', rawBytes: Buffer.from('新原文'), segments: [{ text: '新原文' }] })); await coordinator.begin(preview); } };
}

it('网络发送之前持久running，完成后独立保存候选和完整回答；重启零网络核对', async () => {
  const state = await setup(), prepared = await state.prepare();
  state.fetcher.mockImplementationOnce(async () => {
    const saved = JSON.parse(await readFile(join(root, `${state.workId}.json`), 'utf8'));
    expect(saved.batches[0]).toMatchObject({ status: 'running', requestHash: prepared.requestHash, suggestions: [], rawText: '' });
    return state.response(state.rawText);
  });
  const result = await state.execute(prepared);
  expect((await state.drafts.readExtractionDraft(state.workId))?.batches[0]).toMatchObject({ status: 'ready', rawText: state.rawText, suggestions: result.suggestions });
  const restarted = state.create();
  await expect(restarted.execute('getBookExtractionAiResult', state.lookup(prepared))).resolves.toEqual({ status: 'ready', result });
  expect(state.fetcher).toHaveBeenCalledTimes(1);
});
it('发送状态无法落盘则拒绝联网，收到完整回答后落盘失败仍能核对内存结果', async () => {
  const state=await setup(), prepared=await state.prepare();
  const record=vi.spyOn(state.coordinator,'recordBatch'); record.mockRejectedValueOnce(new Error('磁盘已满'));
  await expect(state.execute(prepared)).rejects.toThrow('磁盘已满'); expect(state.fetcher).not.toHaveBeenCalled();
  const next=await state.prepare(), original=state.coordinator.recordBatch.bind(state.coordinator);
  record.mockRestore(); const failReady=vi.spyOn(state.coordinator,'recordBatch');
  failReady.mockImplementation((workId,token,batch)=>batch.status==='ready'?Promise.reject(new Error('磁盘已满')):original(workId,token,batch));
  const result=await state.execute(next); expect(result.rawText).toBe(state.rawText); expect(result.validationError).toMatch(/落盘/);
  await expect(state.commands.execute('getBookExtractionAiResult',state.lookup(next))).resolves.toMatchObject({status:'ready',result});
  expect(state.fetcher).toHaveBeenCalledTimes(1);
});
it('完成候选不因其他批次入库的revision变化失效，字典改名仍拒绝；发送前revision不放宽', async () => {
  const state = await setup(), prepared = await state.prepare(); await state.execute(prepared);
  const unsent = await state.prepare(); state.changeRevision();
  await expect(state.execute(unsent)).rejects.toThrow(/变化/);
  const restored=await state.create().execute('getBookExtractionAiResult',state.lookup(prepared)) as {status:'ready';result:BookExtractionAiResult};
  expect(restored.status).toBe('ready'); expect(restored.result.validationError).toBeUndefined();
  state.renameCategory();
  await expect(state.create().execute('getBookExtractionAiResult', state.lookup(prepared))).resolves.toMatchObject({ status: 'ready', result: { validationError: expect.any(String) } });
  expect(state.fetcher).toHaveBeenCalledTimes(1);
});
it('取消完成候选不删除ready；后续失败和取消均保留前批，重启不重发', async () => {
  const state = await setup(), ready = await state.prepare(); await state.execute(ready);
  await state.commands.execute('cancelBookExtractionAi', { confirmationToken: ready.confirmationToken });
  const failed = await state.prepare(); state.fetcher.mockRejectedValueOnce(new Error('断网'));
  await expect(state.execute(failed)).rejects.toThrow(/连接云端服务失败/);
  const cancelled = await state.prepare(); state.fetcher.mockImplementationOnce(async () => new Promise(() => {}));
  const rejected = expect(state.execute(cancelled)).rejects.toThrow(/取消/);
  await vi.waitFor(() => expect(state.fetcher).toHaveBeenCalledTimes(3));
  await state.commands.execute('cancelBookExtractionAi', { confirmationToken: cancelled.confirmationToken }); await rejected;
  expect((await state.drafts.readExtractionDraft(state.workId))?.batches.map(batch => batch.status)).toEqual(['ready', 'failed', 'cancelled']);
  await expect(state.create().execute('getBookExtractionAiResult', state.lookup(ready))).resolves.toMatchObject({ status: 'ready' });
  await expect(state.create().execute('getBookExtractionAiResult', state.lookup(cancelled))).resolves.toEqual({ status: 'missing' });
  expect(state.fetcher).toHaveBeenCalledTimes(3);
});
it('取消命令返回时本批已停止且可核对missing，不等待无关请求', async () => {
  const state = await setup(), prepared = await state.prepare();
  state.fetcher.mockImplementationOnce(async () => new Promise(() => {}));
  const pending = state.execute(prepared).catch(() => {});
  await vi.waitFor(() => expect(state.fetcher).toHaveBeenCalledTimes(1));
  await state.commands.execute('cancelBookExtractionAi', { confirmationToken: prepared.confirmationToken });
  await expect(state.commands.execute('getBookExtractionAiResult', state.lookup(prepared))).resolves.toEqual({ status: 'missing' });
  await pending;
  expect((await state.drafts.readExtractionDraft(state.workId))?.batches[0].status).toBe('cancelled');
});
it('格式不合法仍持久完整原始回答及错误，重启保持不可应用', async () => {
  const state = await setup(), prepared = await state.prepare(); state.fetcher.mockResolvedValueOnce(state.response('不合法JSON'));
  const result = await state.execute(prepared); expect(result.validationError).toBeTruthy();
  await expect(state.create().execute('getBookExtractionAiResult', state.lookup(prepared))).resolves.toEqual({ status: 'ready', result });
  expect((await state.drafts.readExtractionDraft(state.workId))?.batches[0]).toMatchObject({ rawText: '不合法JSON', suggestions: [], validationError: result.validationError });
});
it('收到回答期间其他批次仅更新revision，已完成原文建议仍可审核', async () => {
  const state=await setup(), prepared=await state.prepare();
  state.fetcher.mockImplementationOnce(async()=>{state.changeRevision();return state.response(state.rawText);});
  const result=await state.execute(prepared); expect(result.validationError).toBeUndefined();
});
it('替换素材后迟到回答不写入新任务；完整回答仍在内存可核对', async () => {
  const state = await setup(), prepared = await state.prepare();
  state.fetcher.mockImplementationOnce(async () => { await state.replace(); return state.response(state.rawText); });
  const result = await state.execute(prepared); expect(result.validationError).toBeTruthy();
  expect((await state.drafts.readExtractionDraft(state.workId))?.batches).toEqual([]);
});
it('批次受限保存拒绝token、身份和冻结证据篡改，原始回答容量严格受限', async () => {
  const state = await setup(), prepared = await state.prepare(); await state.execute(prepared);
  const draft = (await state.drafts.readExtractionDraft(state.workId))!, batch = draft.batches[0];
  await expect(state.coordinator.recordBatch(state.workId, randomUUID(), batch)).rejects.toThrow(/预览/);
  await expect(state.coordinator.recordBatch(state.workId, draft.previewToken, { ...batch, segmentIds: [randomUUID()] })).rejects.toThrow();
  await expect(state.coordinator.recordBatch(state.workId, draft.previewToken, { ...batch, rawText: '替换完整结果' })).rejects.toThrow(/只读|批次/);
  expect(extractionDraftSchema.safeParse({ ...draft, batches: [{ ...batch, rawText: 'a'.repeat(128001) }] }).success).toBe(false);
  expect(extractionDraftSchema.safeParse({ ...draft, batches: [{ ...batch, confirmationToken: '禁止持久授权' }] }).success).toBe(false);
});
