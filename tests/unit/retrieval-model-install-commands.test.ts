import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { RetrievalCommands } from '../../src/main/retrieval-commands';
import type { RetrievalModelStatus } from '../../src/shared/retrieval-model';
function fixture(choose = async (): Promise<string | null> => 'trusted-directory') {
  const status: RetrievalModelStatus = { state: 'ready', installed: true, qualified: true, modelId: 'fixed', fingerprint: 'fixed', bytes: 1 };
  const models = { getStatus: vi.fn(async () => status), getActiveDirectory: vi.fn(async (): Promise<string | null> => 'trusted'), setEnabled: vi.fn(async () => {}), install: vi.fn(async (_request: unknown, _signal?: AbortSignal) => {}) };
  const client = { close: vi.fn(), search: vi.fn(async () => []), index: vi.fn(async () => {}), invalidateWork: vi.fn(), isIndexing: () => false, cancel: vi.fn() };
  const workId = randomUUID(), entryId = randomUUID();
  const store = { execute: vi.fn(async (command: string) => command === 'readKnowledgeScope' ? { knowledge: [{ id: entryId, body: '雨声', deletedAt: null, categoryId: null, tagIds: [] }], categories: [], entryOwners: { [entryId]: { workId, sourceEntryId: entryId, sourceRevision: 1 } } } : [{ id: workId }]) };
  const commands = new RetrievalCommands(store, models, client, choose);
  return { commands, models, client, status, workId };
}
it('下载仅接受操作身份；本地路径来自主进程选择，成功刷新模型代', async () => {
  const { commands, models, client } = fixture(), operationId = randomUUID();
  expect(commands.accepts('downloadRetrievalModel')).toBe(true); expect(commands.accepts('cancelRetrievalModelInstall')).toBe(true);
  expect(await commands.execute('downloadRetrievalModel', { operationId })).toMatchObject({ state: 'ready' });
  expect(models.install).toHaveBeenCalledWith({ source: 'download', operationId }, expect.any(AbortSignal));
  await commands.execute('importRetrievalModel', { operationId });
  expect(models.install).toHaveBeenLastCalledWith({ source: 'local', operationId, directory: 'trusted-directory' }, expect.any(AbortSignal));
  await commands.execute('importRetrievalModel', {}); expect(client.close).toHaveBeenCalledTimes(3);
  await expect(commands.execute('downloadRetrievalModel', { operationId, url: 'https://evil.example' })).rejects.toThrow();
  await expect(commands.execute('cancelRetrievalModelInstall', { operationId: '../outside' })).rejects.toThrow();
  await expect(commands.execute('unknown', {})).rejects.toThrow(/未知/);
});
it('取消停滞安装不阻塞状态查询，拒绝并发和错误身份；失败后可重新安装', async () => {
  const { commands, models } = fixture(), operationId = randomUUID(); let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  models.install.mockImplementationOnce(async (_request, signal) => { started(); await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('已取消')), { once: true })); });
  const pending = commands.execute('downloadRetrievalModel', { operationId }); await ready;
  expect(await commands.execute('getRetrievalModelStatus', {})).toMatchObject({ installed: true });
  await expect(commands.execute('downloadRetrievalModel', { operationId: randomUUID() })).rejects.toThrow(/进行/);
  await commands.execute('cancelRetrievalModelInstall', { operationId: randomUUID() });
  expect(models.install.mock.calls[0][1]?.aborted).toBe(false);
  await commands.execute('cancelRetrievalModelInstall', { operationId }); await expect(pending).rejects.toThrow(/取消/);
  await commands.execute('downloadRetrievalModel', { operationId: randomUUID() }); expect(models.install).toHaveBeenCalledTimes(2);
});
it('选择目录期间取消，迟到的目录不能安装；关闭选择不会改变模型', async () => {
  let select!: (directory: string | null) => void;
  const { commands, models, client } = fixture(() => new Promise(resolve => { select = resolve; })), operationId = randomUUID();
  const pending = commands.execute('importRetrievalModel', { operationId });
  await commands.execute('cancelRetrievalModelInstall', { operationId }); select('late-directory');
  await expect(pending).rejects.toThrow(/取消/); expect(models.install).not.toHaveBeenCalled(); expect(client.close).not.toHaveBeenCalled();
  const closed = fixture(async () => null); await closed.commands.execute('importRetrievalModel', {}); expect(closed.models.install).not.toHaveBeenCalled();
});
it('未资格不能启用和重建；本地目录校验失败不启动索引；可用模型可重建', async () => {
  const { commands, models, status, client, workId } = fixture(); status.qualified = false;
  await expect(commands.execute('setRetrievalModelEnabled', { enabled: true })).rejects.toThrow(/资格/);
  await expect(commands.execute('rebuildKnowledgeIndex', { workId })).rejects.toThrow(/未就绪/);
  status.qualified = true; models.getActiveDirectory.mockResolvedValueOnce(null);
  await expect(commands.execute('rebuildKnowledgeIndex', { workId })).rejects.toThrow(/校验/); expect(client.index).not.toHaveBeenCalled();
  await commands.execute('rebuildKnowledgeIndex', { workId }); expect(client.invalidateWork).toHaveBeenCalledWith(workId); expect(client.index).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ workId })]), 'trusted');
});
