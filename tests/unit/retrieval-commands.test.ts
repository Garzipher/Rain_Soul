import { createHash, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { RetrievalCommands } from '../../src/main/retrieval-commands';
import type { RetrievalModelStatus } from '../../src/shared/retrieval-model';
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
function setup(qualified = false) {
  const workId = randomUUID(), entryId = randomUUID(), categoryId = randomUUID();
  let revision = 1;
  const knowledge = { id: entryId, body: '雨声落在屋檐下', source: '例文', categoryId, tagIds: [], deletedAt: null };
  const store = { execute: vi.fn(async (command: string) => command === 'readKnowledgeScope' ? {
    knowledge: [knowledge], categories: [{ id: categoryId, parentId: null, deletedAt: null }], tags: [],
    entryOwners: { [entryId]: { workId, sourceRevision: revision, workTitle: '作品', sourceEntryId: entryId } },
  } : command === 'listWorks' ? [{ id: workId, revision, title: '作品' }] : [{ id: entryId, workId }]) };
  const status: RetrievalModelStatus = { state: 'ready', modelId: 'fixed', fingerprint: 'fingerprint', installed: true, qualified, bytes: 123 };
  const models = { getStatus: vi.fn(async () => status), getActiveDirectory: vi.fn(async () => 'trusted'), setEnabled: vi.fn(async () => {}), install: vi.fn(async () => {}) };
  const client = { search: vi.fn(async () => [{ workId, entryId, bodyHash: hash(knowledge.body), excerpt: knowledge.body, source: knowledge.source, matchedBy: ['semantic' as const], reliable: true }]), index: vi.fn(async () => {}), close: vi.fn(), invalidateWork: vi.fn(), isIndexing: () => false, cancel: vi.fn() };
  const commands = new RetrievalCommands(store, models, client, async () => null);
  const query = { workId, queryId: randomUUID(), query: '雨', mode: 'hybrid' as const, tagIds: [], page: 1, pageSize: 20 };
  return { commands, models, client, store, query, knowledge, change: () => { revision++; } };
}
it('未资格模型只返回关键词，知识正文不进入模型，也不能提供渲染层路径', async () => {
  const { commands, client, query, models } = setup();
  const reply = await commands.execute('queryKnowledge', query);
  expect(reply).toMatchObject({ status: 'fallback', total: 1, modelFingerprint: null, hits: [expect.objectContaining({ matchedBy: ['keyword'] })] });
  expect(client.search).not.toHaveBeenCalled(); expect(client.index).not.toHaveBeenCalled();
  await expect(commands.execute('importRetrievalModel', { directory: 'arbitrary' })).rejects.toThrow();
  expect(models.install).not.toHaveBeenCalled();
});
it('接收结果后再次核对作品修订和正文哈希，过期回执不交给界面', async () => {
  const { commands, client, query, change } = setup(true);
  client.search.mockImplementationOnce(async () => { change(); return []; });
  await expect(commands.execute('queryKnowledge', query)).rejects.toThrow(/变化/);
  expect(client.invalidateWork).toHaveBeenCalledWith(query.workId);
});
it('模型失败明确回退、分页保持来源，并拒绝取消后迟到结果', async () => {
  const { commands, client, query } = setup(true);
  client.search.mockRejectedValueOnce(new Error('Worker崩溃'));
  expect(await commands.execute('queryKnowledge', query)).toMatchObject({ status: 'fallback', total: 1 });
  client.search.mockImplementationOnce(async () => { await commands.execute('cancelKnowledgeQuery', { queryId: query.queryId }); return []; });
  await expect(commands.execute('queryKnowledge', query)).rejects.toThrow(/取消/);
  expect(client.cancel).toHaveBeenCalledWith(query.queryId);
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
