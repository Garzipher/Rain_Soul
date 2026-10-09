import { describe, expect, it } from 'vitest';
import { StoreService } from '../../src/main/store-service';

describe('主进程资产命令边界', () => {
  it('全局汇总和查询不改变写权限，复制只能写当前作品且不接受正文伪造', async () => {
    const workId = crypto.randomUUID(); const sourceWorkId = crypto.randomUUID(); const calls: string[] = [];
    const service = new StoreService(async (command) => { calls.push(command); return command === 'openWork' ? { id: workId } : []; });
    await expect(service.execute('readKnowledgeScope', { scopeId: null })).resolves.toEqual([]);
    await service.execute('openWork', { id: workId });
    await expect(service.execute('searchKnowledgeScope', { scopeId: sourceWorkId, query: { text: '雨', mode: 'knowledge' } })).resolves.toEqual([]);
    const request = { workId, expectedRevision: 1, operationId: crypto.randomUUID(), sourceWorkId, sourceEntryId: crypto.randomUUID(), sourceExpectedRevision: 2, categoryId: crypto.randomUUID(), tagIds: [] };
    await expect(service.execute('copyKnowledge', { ...request, workId: sourceWorkId })).rejects.toThrow('当前作品');
    await expect(service.execute('copyKnowledge', { ...request, body: '伪造正文' })).rejects.toThrow();
    await expect(service.execute('copyKnowledge', request)).resolves.toEqual([]);
    await expect(service.execute('manageAssets', { workId, expectedRevision: 1, operationId: crypto.randomUUID(), action: { type: 'createTag', name: '雨' } })).resolves.toEqual([]);
    expect(calls).toEqual(['readKnowledgeScope', 'openWork', 'searchKnowledgeScope', 'copyKnowledge', 'manageAssets']);
  });
  it('资产写入和搜索只允许当前作品，查询不能偷偷切换当前写权限', async () => {
    const first = crypto.randomUUID(); const second = crypto.randomUUID(); const calls: string[] = [];
    const service = new StoreService(async (command, payload) => {
      calls.push(command);
      return command === 'openWork' ? { id: (payload as { id: string }).id } : [];
    });
    const mutation = (workId: string) => ({ workId, expectedRevision: 1, operationId: crypto.randomUUID(), action: { type: 'createTag', name: '雨' } });
    await expect(service.execute('manageAssets', mutation(first))).rejects.toThrow('当前作品');
    await expect(service.execute('searchWork', { workId: first, query: { text: '雨', mode: 'all' } })).rejects.toThrow('当前作品');
    await service.execute('openWork', { id: first });
    await expect(service.execute('searchWork', { workId: first, query: { text: '雨', mode: 'all' } })).resolves.toEqual([]);
    await expect(service.execute('manageAssets', mutation(first))).resolves.toEqual([]);
    await service.execute('openWork', { id: second });
    await expect(service.execute('manageAssets', mutation(first))).rejects.toThrow('当前作品');
    await expect(service.execute('searchWork', { workId: first, query: { text: '雨', mode: 'all' } })).rejects.toThrow('当前作品');
    expect(calls).toEqual(['openWork', 'searchWork', 'manageAssets', 'openWork']);
  });
  it('非法资产动作、SQL字段、路径和超限查询在进入Worker前被拒绝', async () => {
    const calls: string[] = [];
    const service = new StoreService(async command => { calls.push(command); return []; });
    const workId = crypto.randomUUID(); const request = { workId, expectedRevision: 1, operationId: crypto.randomUUID() };
    for (const action of [{ type: 'exec', sql: 'DELETE FROM work_meta' }, { type: 'createTag', name: '雨', sql: 'danger' }, { type: 'deleteKnowledge', id: '../project.sqlite' }]) {
      await expect(service.execute('manageAssets', { ...request, action })).rejects.toThrow();
    }
    for (const query of [{ text: '雨', mode: 'all', limit: 201 }, { text: '雨', mode: 'all', tagIds: ['../'] }, { text: '雨', mode: 'all', path: 'C:\\' }]) {
      await expect(service.execute('searchWork', { workId, query })).rejects.toThrow();
    }
    expect(calls).toEqual([]);
  });
});
