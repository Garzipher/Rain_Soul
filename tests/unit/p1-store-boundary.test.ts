import { describe, expect, it, vi } from 'vitest';
import { StoreService } from '../../src/main/store-service';

describe('P1 存储入口权限', () => {
  it('当前作品会话通过，其他作品会话读取和写入拒绝', async () => {
    const workId = crypto.randomUUID(), other = crypto.randomUUID(), conversationId = crypto.randomUUID();
    const transport = vi.fn(async (command: string) => command === 'openWork' ? { id: workId } : []);
    const service = new StoreService(transport);
    await service.execute('openWork', { id: workId });
    await expect(service.execute('listConversations', { workId })).resolves.toEqual([]);
    await expect(service.execute('readConversation', { workId: other, conversationId })).rejects.toThrow('当前作品');
    await expect(service.execute('manageConversation', { workId: other, operationId: crypto.randomUUID(), action: { type: 'create', id: conversationId, title: '讨论' } })).rejects.toThrow('当前作品');
  });
  it('拆书提交校验严格字段、作品权限和审核条目', async () => {
    const workId = crypto.randomUUID(), transport = vi.fn(async () => ({ id: workId }));
    const service = new StoreService(transport); await service.execute('openWork', { id: workId });
    const request = { workId, expectedRevision: 1, operationId: crypto.randomUUID(), items: [{ body: '风吹过山谷', source: '有权使用的样稿，第一章第1段', categoryId: crypto.randomUUID(), tagIds: [] }] };
    await expect(service.execute('importBookExtraction', request)).resolves.toEqual({ id: workId });
    await expect(service.execute('importBookExtraction', { ...request, sql: '伪造' })).rejects.toThrow();
    await expect(service.execute('importBookExtraction', { ...request, workId: crypto.randomUUID() })).rejects.toThrow('当前作品');
  });
});
