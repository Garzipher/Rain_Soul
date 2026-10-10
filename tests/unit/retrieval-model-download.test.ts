import type { IncomingMessage, RequestOptions } from 'node:http';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createTrustedModelDownloader } from '../../src/main/retrieval-model-download';
import { fixedManifest } from '../../src/shared/retrieval-model';

const url = `https://huggingface.co/${fixedManifest.repository}/resolve/${fixedManifest.revision}/config.json`;
function setup(replies: { status: number; location?: string; body?: string; encoding?: string; length?: string; stalled?: boolean }[]) {
  const open = vi.fn((_url: string, options: RequestOptions, callback: (incoming: IncomingMessage) => void) => {
    const outgoing = Object.assign(new EventEmitter(), { end() {
      const reply = replies.shift()!;
      const incoming = Object.assign((reply.stalled ? new Readable({ read() {} }) : Readable.from([Buffer.from(reply.body ?? '')])), { statusCode: reply.status, headers: { ...(reply.location ? { location: reply.location } : {}), ...(reply.encoding ? { 'content-encoding': reply.encoding } : {}), ...(reply.length ? { 'content-length': reply.length } : {}) } });
      queueMicrotask(() => callback(incoming as IncomingMessage));
    }, destroy: vi.fn() });
    return outgoing;
  });
  const resolveHost = vi.fn(async () => ['8.8.8.8']);
  return { open, resolveHost, download: createTrustedModelDownloader({ openRequest: open as never, resolveHost }) };
}
async function collect(stream: AsyncIterable<Uint8Array>) { const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString(); }
it('仅从固定清单HTTPS地址下载，公开IP固定，不携带凭据或作者正文', async () => {
  const { download, open } = setup([{ status: 200, body: '公开模型' }]);
  expect(await collect(download(url))).toBe('公开模型');
  expect(open).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'GET', agent: false, rejectUnauthorized: true, headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' } }), expect.any(Function));
  const options = open.mock.calls[0][1];
  const callback = vi.fn(); const pinned = options.lookup as (hostname: string, options: object, done: typeof callback) => void;
  pinned('ignored', {}, callback); expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  pinned('ignored', { all: true }, callback); expect(callback).toHaveBeenLastCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  await expect(collect(download('https://huggingface.co/arbitrary/model/resolve/main/code.js'))).rejects.toThrow(/固定/);
});
it('可信HF签名CDN重定向逐跳重新验公网，拒绝其他域名、私网和压缩', async () => {
  const trusted = setup([{ status: 302, location: 'https://cas-bridge.xethub.hf.co/model?Signature=public' }, { status: 200, body: '权重' }]);
  expect(await collect(trusted.download(url))).toBe('权重'); expect(trusted.resolveHost).toHaveBeenCalledTimes(2);
  const unsafe = setup([{ status: 302, location: 'https://evil.example.com/model' }]);
  await expect(collect(unsafe.download(url))).rejects.toThrow(/受信/); expect(unsafe.open).toHaveBeenCalledTimes(1);
  const privateHost = setup([]); privateHost.resolveHost.mockResolvedValue(['127.0.0.1']);
  await expect(collect(privateHost.download(url))).rejects.toThrow(/公开/); expect(privateHost.open).not.toHaveBeenCalled();
  const compressed = setup([{ status: 200, encoding: 'gzip', body: '不可解析' }]);
  await expect(collect(compressed.download(url))).rejects.toThrow(/压缩/);
});
it('取消停滞DNS立即结束且晚解析不请求；网络错误不回显远端或自动重试', async () => {
  const test = setup([]), controller = new AbortController();
  test.resolveHost.mockImplementation(() => new Promise(() => {}));
  const pending = collect(test.download(url, controller.signal)); controller.abort();
  await expect(pending).rejects.toThrow(/取消/); expect(test.open).not.toHaveBeenCalled();
  const denied = setup([{ status: 403, body: '远端敏感响应' }]);
  await expect(collect(denied.download(url))).rejects.toThrow('固定模型下载失败，请检查网络后手动重试。'); expect(denied.open).toHaveBeenCalledTimes(1);
});
it('限制广告长度、流字节和重定向次数，超时与取消结束停滞响应', async () => {
  for (const length of ['bad', '1000000']) {
    const test = setup([{ status: 200, length }]); await expect(collect(test.download(url))).rejects.toThrow(/大小/);
  }
  const oversized = setup([{ status: 200, body: 'x'.repeat(fixedManifest.files[0].bytes + 1) }]);
  await expect(collect(oversized.download(url))).rejects.toThrow(/大小/);
  const loop = setup(Array.from({ length: 4 }, () => ({ status: 302, location: url })));
  await expect(collect(loop.download(url))).rejects.toThrow(/重定向/); expect(loop.open).toHaveBeenCalledTimes(4);
  const stalled = setup([{ status: 200, stalled: true }]), controller = new AbortController();
  const pending = collect(stalled.download(url, controller.signal));
  while (!stalled.open.mock.calls.length) await new Promise(resolve => setTimeout(resolve, 1));
  controller.abort(); await expect(pending).rejects.toThrow(/取消/);
  const timeout = setup([{ status: 200, stalled: true }]);
  const timed = createTrustedModelDownloader({ openRequest: timeout.open as never, resolveHost: timeout.resolveHost, timeoutMs: 10 });
  await expect(collect(timed(url))).rejects.toThrow(/超时/);
});
it('DNS混入私网、空DNS、HTTP重定向和凭据均不继续发请求', async () => {
  for (const addresses of [[], ['8.8.8.8', '192.168.1.1']]) {
    const test = setup([]); test.resolveHost.mockResolvedValue(addresses);
    await expect(collect(test.download(url))).rejects.toThrow(/公开/); expect(test.open).not.toHaveBeenCalled();
  }
  for (const location of ['http://huggingface.co/file', 'https://user:password@huggingface.co/file']) {
    const test = setup([{ status: 302, location }]); await expect(collect(test.download(url))).rejects.toThrow(/下载失败/); expect(test.open).toHaveBeenCalledTimes(1);
  }
});
it('请求阶段错误脱敏且仅一次，取消后的迟到响应被销毁', async () => {
  const failure = vi.fn(() => { const outgoing = Object.assign(new EventEmitter(), { end() { queueMicrotask(() => outgoing.emit('error', new Error('敏感连接信息'))); }, destroy() {} }); return outgoing; });
  const failed = createTrustedModelDownloader({ resolveHost: async () => ['8.8.8.8'], openRequest: failure as never });
  await expect(collect(failed(url))).rejects.toThrow('固定模型下载失败，请检查网络后手动重试。'); expect(failure).toHaveBeenCalledTimes(1);
  let respond!: (incoming: IncomingMessage) => void; const destroy = vi.fn();
  const open = vi.fn((_url: string, _options: RequestOptions, callback: typeof respond) => { respond = callback; return Object.assign(new EventEmitter(), { end() {}, destroy }); });
  const download = createTrustedModelDownloader({ resolveHost: async () => ['8.8.8.8'], openRequest: open as never });
  const controller = new AbortController(), pending = collect(download(url, controller.signal));
  while (!respond) await new Promise(resolve => setTimeout(resolve, 1));
  controller.abort(); await expect(pending).rejects.toThrow(/取消/); expect(destroy).toHaveBeenCalled();
  const incoming = Object.assign(new Readable({ read() {} }), { statusCode: 200, headers: {} });
  respond(incoming as IncomingMessage); expect(incoming.destroyed).toBe(true);
});
