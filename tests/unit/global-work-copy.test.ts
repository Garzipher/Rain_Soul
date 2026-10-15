import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GlobalWorkCopyCommands } from '../../src/main/global-work-copy';
import { globalWorkCopyRequestSchema } from '../../src/shared/global-work-copy';

describe('全局知识冻结的成功边界', () => {
  const request = { workId: randomUUID(), expectedRevision: 1, operationId: randomUUID(), entries: [{ entryId: randomUUID(), revision: 1 }] };
  it('作品已有回执时不再依赖来源存在；台账不可用仍返回已提交作品', async () => {
    const work = { id: request.workId, revision: 2 };
    const store = { execute: vi.fn().mockResolvedValue(work) };
    const global = { request: vi.fn().mockRejectedValue(new Error('全局库暂不可用')) };
    await expect(new GlobalWorkCopyCommands(store, global).execute('freezeGlobalKnowledge', request)).resolves.toEqual(work);
    expect(store.execute).toHaveBeenCalledExactlyOnceWith('getGlobalFreezeReceipt', request);
    expect(global.request.mock.calls[0][0]).toBe('recordUsage');
  });
  it('拒绝同一全局身份重复提交和无效版本', () => {
    expect(globalWorkCopyRequestSchema.safeParse({ ...request, entries: [...request.entries, ...request.entries] }).success).toBe(false);
    expect(globalWorkCopyRequestSchema.safeParse({ ...request, expectedRevision: 0 }).success).toBe(false);
  });
});
