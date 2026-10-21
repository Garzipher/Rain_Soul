import { createHash, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { RetrievalCommands } from '../../src/main/retrieval-commands';
import type { RetrievalModelStatus } from '../../src/shared/retrieval-model';
import type { IndexEntry } from '../../src/workers/retrieval/engine';
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
function setup(qualified = false) {
  const workId = randomUUID(), entryId = randomUUID(), categoryId = randomUUID();
  let revision = 1;
  const knowledge = { id: entryId, body: '雨声落在屋檐下', source: '例文', categoryId, tagIds: [], deletedAt: null };
  const store = { execute: vi.fn(async (command: string) => command === 'readKnowledgeScope' ? {
    knowledge: [knowledge], categories: [{ id: categoryId, parentId: null, deletedAt: null }], tags: [],
    entryOwners: { [entryId]: { workId, sourceRevision: revision, workTitle: '作品', sourceEntryId: entryId } },
  } : command === 'listWorks' ? [{ id: workId, revision, title: '作品' }] : [{ id: entryId, workId }]) };
  const status: RetrievalModelStatus = { state: 'ready', modelId: 'fixed', fingerprint: 'fingerprint', installed: true, qualified, bytes: 123, source: 'bundled', enabled: true };
  const models = { getStatus: vi.fn(async () => ({ ...status })), getActiveDirectory: vi.fn(async () => 'trusted'), setEnabled: vi.fn(async () => {}), install: vi.fn(async () => {}), selectSource: vi.fn(async (source: 'bundled' | 'user') => { status.source = source; }) };
  const client = { search: vi.fn(async () => [{ workId, entryId, bodyHash: hash(knowledge.body), excerpt: knowledge.body, source: knowledge.source, matchedBy: ['semantic' as const], reliable: true }]), index: vi.fn(async (_entries: IndexEntry[], _directory: string, _workIds?: string[]) => {}), close: vi.fn(), invalidateWork: vi.fn(), isIndexing: () => false, cancel: vi.fn() };
  const commands = new RetrievalCommands(store, models, client, async () => null);
  const query = { workId, queryId: randomUUID(), query: '雨', mode: 'hybrid' as const, tagIds: [], page: 1, pageSize: 20 };
  return { commands, models, client, store, query, knowledge, status, change: () => { revision++; } };
}
it('未资格模型只返回关键词，知识正文不进入模型，也不能提供渲染层路径', async () => {
  const { commands, client, query, models } = setup();
  const reply = await commands.execute('queryKnowledge', query);
  expect(reply).toMatchObject({ status: 'fallback', total: 1, modelFingerprint: null, hits: [expect.objectContaining({ matchedBy: ['keyword'] })] });
  expect(client.search).not.toHaveBeenCalled(); expect(client.index).not.toHaveBeenCalled();
  await expect(commands.execute('importRetrievalModel', { directory: 'arbitrary' })).rejects.toThrow();
  expect(models.install).not.toHaveBeenCalled();
});
it('换源命令仅接受内置或手动枚举，先关闭旧 worker 再保存来源', async () => {
  const { commands, models, client } = setup(true);
  expect(commands.accepts('selectRetrievalModelSource')).toBe(true);
  for (const payload of [{ source: 'bundled', directory: '任意路径' }, { source: 'remote' }, {}]) await expect(commands.execute('selectRetrievalModelSource', payload)).rejects.toThrow();
  models.selectSource.mockImplementationOnce(async source => { expect(client.close).toHaveBeenCalledOnce(); expect(source).toBe('user'); });
  await commands.execute('selectRetrievalModelSource', { source: 'user' });
  expect(models.selectSource).toHaveBeenCalledOnce();
});
it('目录校验期间换源，旧查询不启动推理或索引', async () => {
  const { commands, models, client, query } = setup(true);
  models.getActiveDirectory.mockImplementationOnce(async () => { await commands.execute('selectRetrievalModelSource', { source: 'user' }); return '旧目录'; });
  expect(await commands.execute('queryKnowledge', query)).toMatchObject({ status: 'fallback', modelFingerprint: null });
  expect(client.search).not.toHaveBeenCalled(); expect(client.index).not.toHaveBeenCalled();
});
it('相同指纹但来源后验变化，迟到语义结果回退关键词', async () => {
  const { commands, client, query, status } = setup(true);
  const original = client.search.getMockImplementation()!;
  client.search.mockImplementationOnce(async () => { const hits = await original(); status.source = 'user'; return hits; });
  expect(await commands.execute('queryKnowledge', query)).toMatchObject({ status: 'fallback', modelFingerprint: null, hits: [expect.objectContaining({ matchedBy: ['keyword'] })] });
});
it('换源往返后旧索引失败不能删除新代索引记录', async () => {
  const { commands, client, query } = setup(true); let rejectOld!: (error: Error) => void;
  client.index.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }));
  await commands.execute('queryKnowledge', query);
  await commands.execute('selectRetrievalModelSource', { source: 'user' });
  await commands.execute('selectRetrievalModelSource', { source: 'bundled' });
  await commands.execute('queryKnowledge', { ...query, queryId: randomUUID() });
  rejectOld(new Error('旧索引取消')); await Promise.resolve();
  await commands.execute('queryKnowledge', { ...query, queryId: randomUUID() });
  expect(client.index).toHaveBeenCalledTimes(2);
});
it('主动重建快照期间换源，旧重建不向 worker 提交', async () => {
  const { commands, client, store, query } = setup(true), original = store.execute.getMockImplementation()!;
  store.execute.mockImplementationOnce(async command => { await commands.execute('selectRetrievalModelSource', { source: 'user' }); return original(command); });
  await expect(commands.execute('rebuildKnowledgeIndex', { workId: query.workId })).rejects.toThrow(/变化/);
  expect(client.index).not.toHaveBeenCalled();
});
it('来源保存尚未完成时，新查询保持关键词且拒绝并发模型变更', async () => {
  const { commands, models, client, query } = setup(true); let complete!: () => void;
  models.selectSource.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  const selecting = commands.execute('selectRetrievalModelSource', { source: 'user' });
  expect(await commands.execute('queryKnowledge', query)).toMatchObject({ status: 'fallback', modelFingerprint: null });
  expect(client.search).not.toHaveBeenCalled(); expect(client.index).not.toHaveBeenCalled();
  await expect(commands.execute('setRetrievalModelEnabled', { enabled: false })).rejects.toThrow(/进行/);
  complete(); await selecting;
});
it('接收结果后再次核对作品修订和正文哈希，过期回执不交给界面', async () => {
  const { commands, client, query, change } = setup(true);
  client.search.mockImplementationOnce(async () => { change(); return []; });
  await expect(commands.execute('queryKnowledge', query)).rejects.toThrow(/变化/);
  expect(client.invalidateWork).not.toHaveBeenCalled();
});
it('正文revision变化不重算知识向量，条目hash变化只调度增量新代',async()=>{
  const {commands,client,query,change,knowledge}=setup(true);
  await commands.execute('queryKnowledge',query);change();
  await commands.execute('queryKnowledge',{...query,queryId:randomUUID()});expect(client.index).toHaveBeenCalledTimes(1);
  knowledge.body='风吹过窗台';await commands.execute('queryKnowledge',{...query,queryId:randomUUID()});
  expect(client.index).toHaveBeenCalledTimes(2);expect(client.invalidateWork).not.toHaveBeenCalled();
});
it('作品学习注释进入独立嵌入文本，编辑注释会重建索引但不改原文哈希', async () => {
  const { commands, client, query, knowledge } = setup(true);
  const annotated = knowledge as typeof knowledge & { learningNotes: { technique: string; usage: string; exercise: string }[] };
  annotated.learningNotes = [{ technique: '借景写情', usage: '离别', exercise: '写一段风声' }];
  await commands.execute('queryKnowledge', query);
  expect(client.index).toHaveBeenLastCalledWith([expect.objectContaining({ body: knowledge.body, bodyHash: hash(knowledge.body), searchText: expect.stringContaining('借景写情') })], 'trusted', [query.workId]);
  const before = client.index.mock.calls[0]![0][0]!;
  annotated.learningNotes[0].usage = '重逢';
  await commands.execute('queryKnowledge', { ...query, queryId: randomUUID() });
  expect(client.index).toHaveBeenCalledTimes(2);
  const after = client.index.mock.calls[1]![0][0]!;
  expect(after.searchHash).not.toBe(before.searchHash);
});
it('作者主动重建不先删除旧完整索引，重启首次查询交给Worker复用持久hash块',async()=>{
  const {commands,client,query}=setup(true);
  await commands.execute('rebuildKnowledgeIndex',{workId:query.workId});
  expect(client.invalidateWork).not.toHaveBeenCalled();expect(client.index).toHaveBeenCalledTimes(1);
});
it('模型失败明确回退、分页保持来源，并拒绝取消后迟到结果', async () => {
  const { commands, client, query } = setup(true);
  client.search.mockRejectedValueOnce(new Error('Worker崩溃'));
  expect(await commands.execute('queryKnowledge', query)).toMatchObject({ status: 'fallback', total: 1 });
  client.search.mockImplementationOnce(async () => { await commands.execute('cancelKnowledgeQuery', { queryId: query.queryId }); return []; });
  await expect(commands.execute('queryKnowledge', query)).rejects.toThrow(/取消/);
  expect(client.cancel).toHaveBeenCalledWith(query.queryId);
});
it('查询超过模型窗口时保留关键词结果并明确提示缩小范围', async () => {
  const { commands, client, query } = setup(true);
  client.search.mockRejectedValueOnce(Object.assign(new Error('查询超过400 token'), { code: 'RETRIEVAL_QUERY_TOO_LONG' }));
  expect(await commands.execute('queryKnowledge', query)).toMatchObject({ status: 'fallback', message: expect.stringMatching(/400 token.*缩小范围/) });
});
it('来源后验读取期间停用模型，最终回执只能显示关键词', async () => {
  const { commands, models, client, store, query } = setup(true);
  const original = store.execute.getMockImplementation()!; let reads = 0;
  store.execute.mockImplementation(async command => {
    const value = await original(command);
    if (command === 'readKnowledgeScope' && ++reads === 2) await commands.execute('setRetrievalModelEnabled', { enabled: false });
    return value;
  });
  expect(await commands.execute('queryKnowledge', query)).toMatchObject({ status: 'fallback', modelFingerprint: null, hits: [expect.objectContaining({ matchedBy: ['keyword'] })] });
  expect(client.close).toHaveBeenCalled(); expect(models.setEnabled).toHaveBeenCalledWith(false);
});
