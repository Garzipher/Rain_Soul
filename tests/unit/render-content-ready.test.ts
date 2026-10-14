import { afterEach, expect, it, vi } from 'vitest';
import { waitForRenderableContent } from '../../src/main/render-content-ready';
import { parseArticleDocument } from '../../src/main/web-article-core';

afterEach(() => vi.useRealTimers());
function fixture(textAt: (elapsed: number) => string) {
  vi.useFakeTimers(); vi.setSystemTime(10000);
  const controller = new AbortController();
  const capture = vi.fn(async () => Buffer.from(`<html><body><article>${textAt(Date.now() - 10000)}</article></body></html>`));
  const parse = vi.fn(async (bytes: Buffer) => parseArticleDocument(bytes, 'text/html', 20000));
  const checkHealthy = vi.fn(), waitForQuiet = vi.fn(async () => undefined);
  const options = { deadline: 50000, signal: controller.signal, capture, parse, checkHealthy, waitForQuiet };
  return { controller, capture, parse, checkHealthy, waitForQuiet, options };
}
it('空正文时继续等待，延迟注入后按实际可提取内容稳定而非固定休眠', async () => {
  const f = fixture(elapsed => elapsed < 1500 ? '' : '<p>盛夏雨夜，屋檐下响起急促的脚步。</p>');
  let finished = false;
  const result = waitForRenderableContent(f.options).then(value => { finished = true; return value; });
  await vi.advanceTimersByTimeAsync(2000); expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(250);
  expect((await result).toString()).toContain('屋檐下');
  expect(f.waitForQuiet).toHaveBeenCalled(); expect(f.checkHealthy.mock.calls.length).toBeGreaterThan(f.capture.mock.calls.length);
});
it('分阶段追加正文会重置稳定时间，返回最新快照', async () => {
  const f = fixture(elapsed => elapsed < 500 ? '<p>雨落下。</p>' : '<p>雨落下。</p><p>她回头看见故人。</p>');
  let finished = false;
  const result = waitForRenderableContent(f.options).then(value => { finished = true; return value; });
  await vi.advanceTimersByTimeAsync(1000); expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(250); expect((await result).toString()).toContain('故人');
});
it('无关DOM变化不影响提取正文稳定判定', async () => {
  const f = fixture(elapsed => `<p>雨落下，故人归来。</p><script>const counter=${elapsed}</script>`);
  const result = waitForRenderableContent(f.options);
  await vi.advanceTimersByTimeAsync(750); expect((await result).toString()).toContain('counter=750');
});
it('达到稳定时重新复核网络与最新正文，迟到请求更新不能返回旧快照', async () => {
  let updated = false; const f = fixture(() => updated ? '<p>晚到请求补齐的正文。</p>' : '<p>第一段正文。</p>');
  f.waitForQuiet.mockImplementation(async () => { if (f.waitForQuiet.mock.calls.length === 5) updated = true; });
  let finished = false; const result = waitForRenderableContent(f.options).then(value => { finished = true; return value; });
  await vi.advanceTimersByTimeAsync(750); expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(750); expect((await result).toString()).toContain('晚到请求');
});
it.each(['空正文', '持续变化'])('%s最多等待共享的五秒预算', async kind => {
  const f = fixture(elapsed => kind === '空正文' ? '' : `<p>雨夜片段${elapsed}</p>`);
  const result = waitForRenderableContent(f.options).catch(error => error);
  await vi.advanceTimersByTimeAsync(5000); expect((await result).message).toMatch(/正文.*稳定/);
  expect(f.capture.mock.calls.length).toBeLessThanOrEqual(20);
});
it('剩余总期限更短时不得重新加五秒', async () => {
  const f = fixture(() => ''); f.options.deadline = 10300;
  const result = waitForRenderableContent(f.options).catch(error => error);
  await vi.advanceTimersByTimeAsync(300); expect((await result).message).toMatch(/正文.*稳定/);
  expect(f.waitForQuiet).toHaveBeenCalledWith(10300, expect.any(AbortSignal));
});
it.each(['预先取消', '等待中取消', '快照挂起', '解析挂起', '网络安静挂起'])('%s立即中止且没有迟到成功', async kind => {
  const f = fixture(() => '<p>雨夜。</p>');
  if (kind === '预先取消') f.controller.abort(new Error('作者取消'));
  if (kind === '快照挂起') f.capture.mockImplementation(() => new Promise(() => {}));
  if (kind === '解析挂起') f.parse.mockImplementation(() => new Promise(() => {}));
  if (kind === '网络安静挂起') f.waitForQuiet.mockImplementation(() => new Promise(() => {}));
  const result = waitForRenderableContent(f.options).catch(error => error);
  await vi.advanceTimersByTimeAsync(0); f.controller.abort(new Error('作者取消'));
  expect((await result).message).toMatch(/取消/);
  const calls = f.capture.mock.calls.length; await vi.advanceTimersByTimeAsync(6000); expect(f.capture).toHaveBeenCalledTimes(calls);
});
it.each(['快照', '解析', '网络安静'])('%s挂起也受五秒宿主看门狗控制', async kind => {
  const f = fixture(() => '<p>雨夜。</p>');
  if (kind === '快照') f.capture.mockImplementation(() => new Promise(() => {}));
  if (kind === '解析') f.parse.mockImplementation(() => new Promise(() => {}));
  if (kind === '网络安静') f.waitForQuiet.mockImplementation(() => new Promise(() => {}));
  const result = waitForRenderableContent(f.options).catch(error => error);
  await vi.advanceTimersByTimeAsync(5000); expect((await result).message).toMatch(/正文.*稳定/);
});
it('安全检查失败不能当作没有正文继续重试', async () => {
  const f = fixture(() => '<p>雨夜。</p>'); f.checkHealthy.mockImplementation(() => { throw new Error('安全拒绝'); });
  await expect(waitForRenderableContent(f.options)).rejects.toThrow('安全拒绝'); expect(f.capture).not.toHaveBeenCalled();
});
it.each(['网页需要登录，不支持获取受限内容。', '网页正文超过容量限制，请缩小素材范围。', '网页解析中断，请粘贴正文。'])('解析错误保留并拒绝：%s', async message => {
  const f = fixture(() => '<p>雨夜。</p>'); f.parse.mockRejectedValue(new Error(message));
  await expect(waitForRenderableContent(f.options)).rejects.toThrow(message); expect(f.capture).toHaveBeenCalledOnce();
});
it('总期限已过不启动快照，成功结束后移除看门狗', async () => {
  const f = fixture(() => '<p>雨夜。</p>'); f.options.deadline = 10000;
  await expect(waitForRenderableContent(f.options)).rejects.toThrow(/正文.*稳定/); expect(f.capture).not.toHaveBeenCalled();
  f.options.deadline = 50000; const result = waitForRenderableContent(f.options);
  await vi.advanceTimersByTimeAsync(750); await result; expect(vi.getTimerCount()).toBe(0);
});
