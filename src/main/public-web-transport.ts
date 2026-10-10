import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { isPublicWebIp, publicWebAddress, PublicWebAddressError } from './public-web-address';

export interface PublicWebDependencies {
  resolveHost?: (hostname: string) => Promise<string[]>;
  openRequest?: typeof request;
  now?: () => number;
}
export interface PublicArticle { bytes: Buffer; finalUrl: string; contentType: string; deadline: number }
class WebError extends Error {}
const abortError = (signal: AbortSignal) => signal.reason instanceof WebError ? signal.reason : new WebError('网页获取已取消。');
function check(signal: AbortSignal, deadline: number, now: () => number): void {
  if (signal.aborted) throw abortError(signal);
  if (now() >= deadline) throw new WebError('网页获取超时，请手动重试。');
}
/** 即使DNS或注入依赖不支持中止，调用仍立即结束；晚结果不能启动请求。 */
async function interruptible<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(abortError(signal));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([operation, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}
function openResponse(url: string, addresses: string[], signal: AbortSignal, open: typeof request): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    let outgoing: ClientRequest | undefined;
    const abort = () => { outgoing?.destroy(); reject(abortError(signal)); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    try {
      outgoing = open(url, {
        method: 'GET', agent: false, signal, rejectUnauthorized: true,
        headers: { Accept: 'text/html, application/xhtml+xml', 'Accept-Encoding': 'gzip, br, deflate' },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, addresses.map(address => ({ address, family: isIP(address) })));
          else callback(null, addresses[0], isIP(addresses[0]));
        },
      }, response => {
        response.once('close', () => signal.removeEventListener('abort', abort));
        if (signal.aborted) { response.destroy(); reject(abortError(signal)); } else resolve(response);
      });
      outgoing.on('error', reason => { signal.removeEventListener('abort', abort); reject(reason); });
      outgoing.end();
    } catch (reason) { signal.removeEventListener('abort', abort); reject(reason); }
  });
}
function header(response: IncomingMessage, key: string): string {
  const value = response.headers[key];
  if (Array.isArray(value)) throw new WebError('网页响应头无效。');
  return value ?? '';
}
async function readBody(response: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  const encoding = header(response, 'content-encoding').trim().toLowerCase();
  const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : undefined;
  if (encoding && encoding !== 'identity' && !decoder) throw new WebError('网页使用不支持的压缩格式。');
  let compressed = 0, expanded = 0; const chunks: Buffer[] = [];
  const counter = new Transform({ transform(chunk: Buffer, _encoding, next) {
    compressed += chunk.length;
    next(compressed > 2 * 1024 * 1024 ? new WebError('网页响应大小超过2MiB。') : null, chunk);
  } });
  const collector = new Transform({ transform(chunk: Buffer, _encoding, next) {
    expanded += chunk.length;
    if (expanded > 5 * 1024 * 1024) { next(new WebError('网页解压大小超过5MiB。')); return; }
    chunks.push(Buffer.from(chunk)); next();
  } });
  await pipeline(decoder ? [response, counter, decoder, collector] : [response, counter, collector], { signal });
  return Buffer.concat(chunks);
}

/** 全程一次授权的公开GET；逐跳固定IP、双层限额，不携带任何云凭据。 */
export async function fetchPublicArticle(url: string, signal: AbortSignal, dependencies: PublicWebDependencies = {}): Promise<PublicArticle> {
  const now = dependencies.now ?? Date.now, deadline = now() + 30000, controller = new AbortController();
  const cancel = () => controller.abort(new WebError('网页获取已取消。'));
  signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new WebError('网页获取超时，请手动重试。')), 30000);
  const active = controller.signal, visited = new Set<string>();
  const resolveHost = dependencies.resolveHost ?? (async (hostname: string) => (await lookup(hostname, { all: true })).map(item => item.address));
  try {
    for (let redirects = 0; ; redirects++) {
      check(active, deadline, now);
      const address = publicWebAddress(url);
      if (visited.has(address.url)) throw new WebError('网页重定向循环，已停止获取。');
      visited.add(address.url);
      const addresses = await interruptible(resolveHost(address.hostname), active);
      check(active, deadline, now);
      if (!addresses.length || !addresses.every(isPublicWebIp)) throw new WebError('网页目标必须使用公开地址，拒绝私网或保留地址。');
      const response = await openResponse(address.url, addresses, active, dependencies.openRequest ?? request);
      const abort = () => response.destroy(); active.addEventListener('abort', abort, { once: true });
      try {
        check(active, deadline, now);
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = header(response, 'location');
          if (redirects >= 3 || !location) throw new WebError('网页重定向无效或超过三次。');
          try { url = new URL(location, address.url).href; } catch { throw new WebError('网页重定向地址无效。'); }
          continue;
        }
        if (status !== 200) throw new WebError('网页未返回公开正文，请检查访问权限后手动重试。');
        const contentType = header(response, 'content-type');
        if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(contentType)) throw new WebError('网页仅支持HTML/XHTML正文。');
        const bytes = await interruptible(readBody(response, active), active);
        check(active, deadline, now);
        return { bytes, finalUrl: address.url, contentType, deadline };
      } finally { active.removeEventListener('abort', abort); response.destroy(); }
    }
  } catch (reason) {
    if (active.aborted) throw abortError(active);
    if (reason instanceof WebError) throw reason;
    // 地址校验文案由本地生成；其他DNS/TLS/压缩错误不得回显远端数据。
    if (reason instanceof PublicWebAddressError) throw reason;
    throw new WebError('网页获取失败，请检查网络后手动重试。');
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}
