import { describe, expect, it, vi } from 'vitest';
import { BookExtractionAiCommands } from '../../src/main/book-extraction-ai-commands';
import { BookExtractionAiService } from '../../src/main/book-extraction-ai-service';
import type { AiPreparedRequest } from '../../src/shared/ai';
import type { BookExtractionPreview } from '../../src/shared/book-extraction';
import type { BookExtractionAiResult } from '../../src/shared/book-extraction-ai';

function setup() {
  const workId = crypto.randomUUID(), categoryId = crypto.randomUUID(), tagId = crypto.randomUUID();
  let revision = 3, allowRead = true, hasCredential = true;
  let provider = { id: 'cloud-default', name: '测试服务', baseUrl: 'https://api.example.com/v1', model: 'test' };
  let preview: BookExtractionPreview = { workId, token: crypto.randomUUID(), filename: '原书.txt', fileHash: 'a'.repeat(64), format: 'txt', warnings: [],
    segments: [{ id: crypto.randomUUID(), chapterTitle: '第一章', chapterIndex: 1, paragraphIndex: 1, text: '风穿过门缝。' }, { id: crypto.randomUUID(), chapterTitle: '秘密', chapterIndex: 2, paragraphIndex: 1, text: '未选中的秘密原文' }] };
  const answer = new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ suggestions: [{ segmentId: preview.segments[0].id, excerpt: '风穿过门缝。', categoryId, tagIds: [tagId], technique: '听觉', usage: '悬疑', exercise: '练习' }] }) } }] }));
  const fetcher = vi.fn<typeof fetch>(async () => answer.clone()), credentials = { read: vi.fn(async () => 'book-test-key') };
  const service = new BookExtractionAiService({ credentials, fetch: fetcher, resolveHost: async () => ['8.8.8.8'], timeoutMs: 1000 });
  const store = { execute: vi.fn(async (command: string, payload: unknown) => {
    if (command !== 'freezeWork') throw new Error('AI 不应写库');
    if (!allowRead || (payload as { workId: string }).workId !== workId) throw new Error('非当前作品或读取失败');
    return { id: workId, revision, title: '不允许发送的作品标题', chapters: [{ text: '不允许发送的作品正文' }], assets: {
      categories: [{ id: categoryId, name: '描写', deletedAt: null }, { id: crypto.randomUUID(), name: '删除分类', deletedAt: '2026' }],
      tags: [{ id: tagId, name: '感官', deletedAt: null }, { id: crypto.randomUUID(), name: '删除标签', deletedAt: '2026' }], knowledge: [{ body: '不允许发送的既有知识' }],
    } };
  }) };
  const previews = { getPreview: (id: string, token: string) => { if (id !== preview.workId || token !== preview.token) throw new Error('预览已失效'); return structuredClone(preview); } };
  const commands = new BookExtractionAiCommands(store, { get: () => ({ provider, hasCredential }) }, previews, service);
  const request = { workId, token: preview.token, segmentIds: [preview.segments[0].id], permissionConfirmed: true as const };
  const prepare = () => commands.execute('prepareBookExtractionAi', request) as Promise<AiPreparedRequest>;
  const execute = (prepared: AiPreparedRequest) => commands.execute('executeBookExtractionAi', { confirmationToken: prepared.confirmationToken, requestHash: prepared.requestHash, confirmed: true }) as Promise<BookExtractionAiResult>;
  const lookup = (prepared: AiPreparedRequest) => ({ workId, previewToken: request.token, requestHash: prepared.requestHash });
  return { commands, store, fetcher, credentials, request, prepare, execute, lookup, answer, changeRevision: () => { revision++; }, changeProvider: () => { provider = { ...provider, model: 'changed' }; }, denyRead: () => { allowRead = false; }, allowRead: () => { allowRead = true; }, clearCredential: () => { hasCredential = false; }, replacePreview: () => { preview = { ...preview, token: crypto.randomUUID() }; } };
}
describe('拆书 AI 命令只推荐不写入', () => {
  it('仅接受四项命令，授权前零网络，真实请求不泄漏未选段落、作品和既有知识', async () => {
    const { commands, store, fetcher, prepare, execute, request } = setup();
    expect(commands.accepts('prepareBookExtractionAi')).toBe(true); expect(commands.accepts('getBookExtractionAiResult')).toBe(true); expect(commands.accepts('importBookExtraction')).toBe(false);
    await expect(commands.execute('importBookExtraction', {})).rejects.toThrow(/未知/);
    await expect(commands.execute('prepareBookExtractionAi', { ...request, permissionConfirmed: false })).rejects.toThrow();
    await expect(commands.execute('prepareBookExtractionAi', { ...request, segmentIds: [crypto.randomUUID()] })).rejects.toThrow(/段落/);
    const prepared = await prepare(); expect(fetcher).not.toHaveBeenCalled();
    const result = await execute(prepared); expect(result.suggestions).toHaveLength(1); expect(result.validationError).toBeUndefined();
    const body = fetcher.mock.calls[0][1]!.body as string;
    for (const forbidden of ['未选中的秘密原文', '不允许发送的作品', '不允许发送的既有知识', '删除分类', '删除标签', '原书.txt']) expect(body).not.toContain(forbidden);
    expect(store.execute.mock.calls.every(([command]) => command === 'freezeWork')).toBe(true);
  });
  it.each(['revision', 'provider', 'preview', 'credential'])('确认后%s变化阻止旧授权联网', async change => {
    const state = setup(), prepared = await state.prepare();
    if (change === 'revision') state.changeRevision(); else if (change === 'provider') state.changeProvider(); else if (change === 'preview') state.replacePreview(); else state.clearCredential();
    await expect(state.execute(prepared)).rejects.toThrow(/变化|失效|配置/); expect(state.fetcher).not.toHaveBeenCalled();
  });
  it('凭据读取期间变化在最后检查阻止网络', async () => {
    const state = setup(), prepared = await state.prepare(); state.credentials.read.mockImplementationOnce(async () => { state.changeRevision(); return 'book-test-key'; });
    await expect(state.execute(prepared)).rejects.toThrow(/变化/); expect(state.fetcher).not.toHaveBeenCalled();
  });
  it.each(['revision', 'provider', 'preview', 'readFailure'])('付费回答到达后%s变化保留原始回答并阻止应用', async change => {
    const state = setup(), prepared = await state.prepare();
    state.fetcher.mockImplementationOnce(async () => { if (change === 'revision') state.changeRevision(); else if (change === 'provider') state.changeProvider(); else if (change === 'preview') state.replacePreview(); else state.denyRead(); return state.answer.clone(); });
    const result = await state.execute(prepared); expect(result.rawText).toContain('风穿过门缝'); expect(result.validationError).toBeTruthy();
    state.allowRead(); await expect(state.commands.execute('getBookExtractionAiResult', state.lookup(prepared))).resolves.toMatchObject({ status: 'ready', result });
    expect(state.fetcher).toHaveBeenCalledTimes(1);
  });
  it('完成回执丢失可核对冻结回答，返回克隆，同hash不能再次联网；完成后取消可清理', async () => {
    const state = setup(), prepared = await state.prepare(); await state.execute(prepared);
    const cached = await state.commands.execute('getBookExtractionAiResult', state.lookup(prepared)) as { status: 'ready'; result: BookExtractionAiResult };
    cached.result.rawText = '渲染层篡改';
    await expect(state.commands.execute('getBookExtractionAiResult', state.lookup(prepared))).resolves.toMatchObject({ status: 'ready', result: { rawText: expect.stringContaining('风穿过门缝') } });
    await expect(state.prepare()).rejects.toThrow(/核对|重复|已执行/);
    await state.commands.execute('cancelBookExtractionAi', { confirmationToken: prepared.confirmationToken });
    await expect(state.commands.execute('getBookExtractionAiResult', state.lookup(prepared))).resolves.toEqual({ status: 'missing' });
    await expect(state.prepare()).rejects.toThrow(/重复|已执行/); expect(state.fetcher).toHaveBeenCalledTimes(1);
  });
  it('hash绑定作品及预览，不能跨边界读取缓存', async () => {
    const state = setup(), prepared = await state.prepare(); await state.execute(prepared);
    await expect(state.commands.execute('getBookExtractionAiResult', { ...state.lookup(prepared), previewToken: crypto.randomUUID() })).resolves.toEqual({ status: 'missing' });
    await expect(state.commands.execute('getBookExtractionAiResult', { ...state.lookup(prepared), workId: crypto.randomUUID() })).rejects.toThrow(/当前作品/);
    await expect(state.commands.execute('getBookExtractionAiResult', { ...state.lookup(prepared), requestHash: 'f'.repeat(64) })).resolves.toEqual({ status: 'missing' });
  });
  it('执行中查询为running，取消无需文件队列，失败核对为missing且不自动重发', async () => {
    const state = setup(), prepared = await state.prepare(); state.fetcher.mockImplementationOnce(async () => new Promise(() => undefined));
    const pending = expect(state.execute(prepared)).rejects.toThrow(/取消/);
    await vi.waitFor(() => expect(state.fetcher).toHaveBeenCalledTimes(1));
    await expect(state.commands.execute('getBookExtractionAiResult', state.lookup(prepared))).resolves.toEqual({ status: 'running' });
    await expect(state.prepare()).rejects.toThrow(/核对|进行|重复/);
    await state.commands.execute('cancelBookExtractionAi', { confirmationToken: prepared.confirmationToken }); await pending; await state.commands.drain();
    await expect(state.commands.execute('getBookExtractionAiResult', state.lookup(prepared))).resolves.toEqual({ status: 'missing' });
    await expect(state.prepare()).rejects.toThrow(/重复|已执行/); expect(state.fetcher).toHaveBeenCalledTimes(1);
  });
  it('后验期间收到完整回答已经可核对，取消后仍保留并禁止应用', async () => {
    const state = setup(), prepared = await state.prepare(), original = state.store.execute.getMockImplementation()!;
    let hold = false, release!: () => void;
    state.fetcher.mockImplementationOnce(async () => { hold = true; return state.answer.clone(); });
    state.store.execute.mockImplementation(async (command, payload) => { if (hold) { hold = false; await new Promise<void>(done => { release = done; }); } return original(command, payload); });
    const pending = state.execute(prepared); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await expect(state.commands.execute('getBookExtractionAiResult', state.lookup(prepared))).resolves.toMatchObject({ status: 'running' });
    await state.commands.execute('cancelBookExtractionAi', { confirmationToken: prepared.confirmationToken }); release();
    const result = await pending; expect(result.validationError).toBeTruthy();
    await expect(state.commands.execute('getBookExtractionAiResult', state.lookup(prepared))).resolves.toMatchObject({ status: 'ready', result });
  });
});
