import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { RetrievalClient } from '../../src/main/retrieval-client';
function setup(queryTimeout = 1000) {
  class FakeWorker extends EventEmitter {
    terminate = vi.fn(async () => 0);
    postMessage = vi.fn((message: { id: string; command: string }) => {
      if (message.command !== 'search') queueMicrotask(() => this.emit('message', { id: message.id, ok: true }));
    });
  }
  const worker = new FakeWorker();
  const client = new RetrievalClient('cache', { createWorker: () => worker, loadTimeout: 1000, queryTimeout, memoryLimit: 1000, rss: () => 0 });
  return { client, worker };
}
it('查询超时终止Worker，晚回执不恢复任务，重启不复用旧请求', async () => {
  const { client, worker } = setup(20);
  await expect(client.search({} as never, 'fixed', 'query')).rejects.toThrow(/超时/);
  expect(worker.terminate).toHaveBeenCalled(); expect(client.isIndexing()).toBe(false); client.close();
});
it('取消只丢弃指定查询；Worker错误拒绝所有等待者并可关闭', async () => {
  const { client, worker } = setup();
  const pending = client.search({} as never, 'fixed', 'query');
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'search' })));
  client.cancel('query'); await expect(pending).rejects.toThrow(/取消/);
  const next = client.search({} as never, 'fixed', 'next');
  await vi.waitFor(() => expect(worker.postMessage.mock.calls.filter(([message]) => message.command === 'search')).toHaveLength(2));
  worker.emit('error', new Error('模型异常')); await expect(next).rejects.toThrow(/异常/); client.close();
});
it('模型加载期间取消后不能启动查询，空Worker回执触发受控失败', async () => {
  class DeferredWorker extends EventEmitter {
    terminate = vi.fn(async () => 0);
    postMessage = vi.fn();
  }
  const worker = new DeferredWorker(), client = new RetrievalClient('cache', { createWorker: () => worker, loadTimeout: 1000 });
  const pending = client.search({} as never, 'fixed', 'query');
  const rejected = expect(pending).rejects.toThrow(/取消/);
  client.cancel('query');
  const load = worker.postMessage.mock.calls[0][0]; worker.emit('message', { id: load.id, ok: true });
  await rejected; expect(worker.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'search' }));
  const next = client.search({} as never, 'fixed', 'next');
  const failed = expect(next).rejects.toThrow(/回执/);
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'search' })));
  worker.emit('message', null); await failed; expect(worker.terminate).toHaveBeenCalled(); client.close();
});
it('受控查询长度错误穿过Worker边界，保留错误码供关键词回退解释', async () => {
  const { client, worker } = setup();
  const pending = client.search({} as never, 'fixed', 'query');
  const rejected = expect(pending).rejects.toMatchObject({ code: 'RETRIEVAL_QUERY_TOO_LONG', message: '查询超过400 token' });
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'search' })));
  const request = worker.postMessage.mock.calls.find(([message]) => message.command === 'search')![0];
  worker.emit('message', { id: request.id, ok: false, message: '查询超过400 token', code: 'RETRIEVAL_QUERY_TOO_LONG' });
  await rejected; expect(worker.terminate).not.toHaveBeenCalled(); client.close();
});
it('后台索引状态、缓存失效与目录切换保持独立请求身份', async () => {
  const { client, worker } = setup();
  await client.index([], 'first'); expect(client.isIndexing()).toBe(false);
  client.invalidateWork('work'); expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'invalidate', payload: 'work' }));
  const pending = client.search({} as never, 'first', 'query');
  const rejected = expect(pending).rejects.toThrow(/已关闭/);
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'search' })));
  await expect(client.search({} as never, 'first', 'query')).rejects.toThrow(/重复/);
  await client.index([], 'second'); await rejected;
  expect(worker.terminate).toHaveBeenCalled(); client.close(); client.invalidateWork('work');
});
it('模型加载超时和进程内存超额会终止Worker而不留下等待者', async () => {
  class SilentWorker extends EventEmitter { terminate = vi.fn(async () => 0); postMessage = vi.fn(); }
  const silent = new SilentWorker(), loading = new RetrievalClient('cache', { createWorker: () => silent, loadTimeout: 10 });
  await expect(loading.index([], 'first')).rejects.toThrow(/超时/); expect(silent.terminate).toHaveBeenCalled(); loading.close();
  let rss = 0;
  const { worker } = setup(), client = new RetrievalClient('cache', { createWorker: () => worker, rss: () => rss, memoryLimit: 10 });
  const query = client.search({} as never, 'first', 'query'), rejected = expect(query).rejects.toThrow(/内存/);
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'search' })));
  rss = 11; await rejected; expect(worker.terminate).toHaveBeenCalled(); client.close();
});
it('发送异常与退出拒绝等待者，旧Worker错误不干扰新进程', async () => {
  const { client, worker } = setup();
  worker.postMessage.mockImplementationOnce(() => { throw '不可发送'; });
  await expect(client.index([], 'first')).rejects.toThrow(/发送失败/);
  const next = client.search({} as never, 'second', 'query'), failed = expect(next).rejects.toThrow(/停止/);
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'search' })));
  worker.emit('exit', 1); await failed; client.close();
});
