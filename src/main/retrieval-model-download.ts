import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { fixedManifest } from '../shared/retrieval-model';
import { isPublicWebIp, publicWebAddress } from './public-web-address';

interface Dependencies { resolveHost?: (hostname: string) => Promise<string[]>; openRequest?: typeof request; timeoutMs?: number }
class DownloadError extends Error {}
const urls = new Map(fixedManifest.files.map(file => [`https://huggingface.co/${fixedManifest.repository}/resolve/${fixedManifest.revision}/${file.path}`, file.bytes]));
const trustedHosts = new Set(['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co', 'cdn-lfs-eu-1.huggingface.co', 'cas-bridge.xethub.hf.co']);
async function interruptible<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const canceled = new Promise<never>((_, reject) => { abort = () => reject(signal.reason); if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([promise, canceled]); } finally { signal.removeEventListener('abort', abort); }
}
function response(url: string, addresses: string[], signal: AbortSignal, open: typeof request): Promise<IncomingMessage> {
  return new Promise((accept, reject) => {
    let outgoing: ClientRequest | undefined;
    const abort = () => { outgoing?.destroy(); reject(signal.reason); };
    if (signal.aborted) { abort(); return; } signal.addEventListener('abort', abort, { once: true });
    try {
      outgoing = open(url, { method: 'GET', agent: false, signal, rejectUnauthorized: true,
        headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' },
        lookup: (_hostname, options, callback) => { if (options.all) callback(null, addresses.map(address => ({ address, family: isIP(address) }))); else callback(null, addresses[0], isIP(addresses[0])); },
      }, incoming => { if (signal.aborted) { incoming.destroy(); reject(signal.reason); } else accept(incoming); incoming.once('close', () => signal.removeEventListener('abort', abort)); });
      outgoing.once('error', error => { signal.removeEventListener('abort', abort); reject(error); }); outgoing.end();
    } catch (error) { signal.removeEventListener('abort', abort); reject(error); }
  });
}
/** 固定公开模型GET，不接受渲染层URL/头/脚本；逐跳HF官方域名白名单与固定公开IP。 */
export function createTrustedModelDownloader(dependencies: Dependencies = {}) {
  return async function* download(initialUrl: string, external?: AbortSignal): AsyncIterable<Uint8Array> {
    const limit = urls.get(initialUrl); if (limit === undefined) throw new DownloadError('模型只能从应用固定修订清单下载。');
    const controller = new AbortController(), signal = controller.signal;
    const abort = () => controller.abort(new DownloadError('模型下载已取消，原模型保持。'));
    external?.addEventListener('abort', abort, { once: true }); if (external?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new DownloadError('模型下载超时，请手动重试。')), dependencies.timeoutMs ?? 120000);
    const resolveHost = dependencies.resolveHost ?? (async (hostname: string) => (await lookup(hostname, { all: true })).map(item => item.address));
    let url = initialUrl;
    try {
      for (let redirects = 0; ; redirects++) {
        signal.throwIfAborted(); const address = publicWebAddress(url);
        if (!trustedHosts.has(address.hostname)) throw new DownloadError('模型重定向必须来自受信官方下载域名。');
        const addresses = await interruptible(resolveHost(address.hostname), signal); signal.throwIfAborted();
        if (!addresses.length || !addresses.every(isPublicWebIp)) throw new DownloadError('模型下载目标必须使用公开地址。');
        const incoming = await interruptible(response(address.url, addresses, signal, dependencies.openRequest ?? request), signal);
        const cancelResponse = () => incoming.destroy(); signal.addEventListener('abort', cancelResponse, { once: true });
        try {
          signal.throwIfAborted();
          if ([301, 302, 303, 307, 308].includes(incoming.statusCode ?? 0)) {
            const location = incoming.headers.location;
            if (redirects >= 3 || typeof location !== 'string') throw new DownloadError('模型下载重定向超过上限或无效。');
            url = new URL(location, address.url).href; continue;
          }
          if (incoming.statusCode !== 200) throw new Error('响应状态无效');
          const encoding = incoming.headers['content-encoding'];
          if (encoding && encoding !== 'identity') throw new DownloadError('模型下载不接受压缩响应。');
          const advertised = incoming.headers['content-length'];
          if (advertised && (!/^\d+$/.test(String(advertised)) || Number(advertised) > limit)) throw new DownloadError('模型下载大小超过固定清单。');
          let received = 0; const iterator = incoming[Symbol.asyncIterator]();
          while (true) {
            const item = await interruptible(iterator.next(), signal); signal.throwIfAborted(); if (item.done) return;
            const chunk = item.value as Buffer; received += chunk.byteLength;
            if (received > limit) throw new DownloadError('模型下载大小超过固定清单。'); yield chunk;
          }
        } finally { signal.removeEventListener('abort', cancelResponse); incoming.destroy(); }
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof DownloadError) throw error;
      throw new DownloadError('固定模型下载失败，请检查网络后手动重试。');
    } finally { clearTimeout(timer); external?.removeEventListener('abort', abort); }
  };
}
