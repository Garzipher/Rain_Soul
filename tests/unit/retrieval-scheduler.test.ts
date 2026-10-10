import { expect, it, vi } from 'vitest';
import { RetrievalScheduler } from '../../src/workers/retrieval/scheduler';
import type { CpuEmbeddingModel } from '../../src/workers/retrieval/model';

function setup() {
  let release: (vectors: Float32Array[]) => void = () => {};
  const embed = vi.fn((_texts: string[]) => new Promise<Float32Array[]>(resolve => { release = resolve; }));
  const model: CpuEmbeddingModel = { tokenize: text => Array.from(text).map(() => 1), embed, dispose: vi.fn(async () => {}) };
  const scheduler = new RetrievalScheduler(model);
  return { scheduler, embed, complete: () => release([Float32Array.of(1)]) };
}
it('查询优先于排队文档且保留单条推理边界', async () => {
  const { scheduler, embed, complete } = setup();
  const document = scheduler.background.embed(['文档一', '文档二'], 'document');
  const query = scheduler.query('q1').embed(['查询'], 'query');
  expect(embed).toHaveBeenCalledWith(['文档一'], 'document');
  complete(); await vi.waitFor(() => expect(embed).toHaveBeenLastCalledWith(['查询'], 'query'));
  complete(); await query; await vi.waitFor(() => expect(embed).toHaveBeenLastCalledWith(['文档二'], 'document'));
  complete(); await document;
});
it('取消排队查询立即拒绝，运行查询丢弃回执且文档继续执行', async () => {
  const { scheduler, embed, complete } = setup();
  const document = scheduler.background.embed(['文档'], 'document');
  const queued = scheduler.query('q1').embed(['不应运行'], 'query');
  const queuedCheck = expect(queued).rejects.toThrow(/取消/);
  scheduler.cancel('q1'); await queuedCheck;
  complete(); await document;
  const running = scheduler.query('q2').embed(['正在运行'], 'query');
  await vi.waitFor(() => expect(embed).toHaveBeenLastCalledWith(['正在运行'], 'query'));
  const runningCheck = expect(running).rejects.toThrow(/取消/);
  scheduler.cancel('q2'); await runningCheck; complete();
  expect(embed).not.toHaveBeenCalledWith(['不应运行'], 'query');
});
it('并发上下文身份隔离，取消后不入队，失败释放调度并可关闭', async () => {
  const { scheduler, embed, complete } = setup();
  expect(scheduler.background.tokenize('雨夜')).toHaveLength(2);
  const action = scheduler.withQuery('owned', async () => {
    const first = scheduler.background.embed(['正在查'], 'query');
    const rejection = expect(first).rejects.toThrow(/取消/);
    scheduler.cancel('owned'); await rejection;
    await expect(scheduler.background.embed(['不入队'], 'query')).rejects.toThrow(/取消/);
  });
  await action; complete();
  const next = scheduler.withQuery('next', () => scheduler.background.embed(['下一查询'], 'query'));
  await vi.waitFor(() => expect(embed).toHaveBeenLastCalledWith(['下一查询'], 'query'));
  complete(); await next;
  embed.mockRejectedValueOnce(new Error('推理异常'));
  await expect(scheduler.query('failed').embed(['失败'], 'query')).rejects.toThrow(/异常/);
  scheduler.cancel('未知任务'); await scheduler.background.dispose();
});
