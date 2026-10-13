import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createBrotliDecompress, createInflate } from 'node:zlib';
import type { PublicWebDependencies } from './public-web-transport';
import { isPublicWebIp, publicWebAddress } from './public-web-address';
import { renderLimits } from './restricted-render-policy';
export interface RenderResource { bytes: Buffer; contentType: string; headers: Record<string,string> }
export interface BrokerOptions { initialUrl: string; deadline: number; signal: AbortSignal; dependencies?: PublicWebDependencies }
export class RenderResourceBroker {
  private readonly controller = new AbortController();
  private readonly now: () => number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private origin: string | null = null;
  private requests = 0;
  private active = 0;
  private compressed = 0;
  private decoded = 0;
  private readonly queue: (() => void)[] = [];
  private readonly running = new Set<Promise<unknown>>();
  private readonly cancel = () => this.stop(new Error('网页渲染获取已取消。'));
  constructor(private readonly options: BrokerOptions) {
    this.now = options.dependencies?.now ?? Date.now;
    this.timer = setTimeout(() => this.stop(new Error('网页渲染超过总期限，已停止。')), Math.max(0, Math.min(renderLimits.totalTimeoutMs, options.deadline - this.now())));
    this.timer.unref(); options.signal.addEventListener('abort', this.cancel, { once: true });
    if (options.signal.aborted) this.cancel();
  }
  private stop(reason: Error) { if (!this.controller.signal.aborted) this.controller.abort(reason); }
  private fatal(message: string): Error { const error = new Error(message); this.stop(error); return error; }
  private check() {
    this.controller.signal.throwIfAborted();
    if (this.now() >= this.options.deadline) { this.stop(new Error('网页渲染超过总期限，已停止。')); this.controller.signal.throwIfAborted(); }
  }
  private async interrupt<T>(operation: Promise<T>, signal = this.controller.signal): Promise<T> {
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(signal.reason ?? new Error('网页获取已取消。')); if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); });
    try { return await Promise.race([operation, cancelled]); } finally { signal.removeEventListener('abort', abort); }
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.running.add(operation); void operation.then(() => this.running.delete(operation), () => this.running.delete(operation)); return operation;
  }
  async initialize(): Promise<RenderResource & { finalUrl: string }> {
    if (this.origin) throw new Error('初始网页已获取。');
    const timer = setTimeout(() => this.stop(new Error('初始网页获取30秒超时。')), renderLimits.initialTimeoutMs);
    try {
      const result = await this.track(this.acquire(this.options.initialUrl, 'mainFrame'));
      this.origin = new URL(result.finalUrl).origin; return result;
    } catch (reason) { this.stop(reason instanceof Error ? reason : new Error('初始获取失败。')); throw reason; }
    finally { clearTimeout(timer); }
  }
  async fetch(url: string, type: string, signal?: AbortSignal, method = 'GET'): Promise<RenderResource> {
    this.check(); if (!this.origin) throw new Error('初始网页尚未完成。');
    let address: ReturnType<typeof publicWebAddress>;
    try {
      if (method !== 'GET' || !['script', 'stylesheet', 'xhr', 'fetch'].includes(type)) throw new Error('受限渲染拒绝请求类型或方法。');
      address = publicWebAddress(url); if (new URL(address.url).origin !== this.origin) throw new Error('受限渲染只允许同源资源。');
    } catch (reason) { this.stop(reason instanceof Error ? reason : new Error('资源安全检查失败。')); throw reason; }
    const cancel = () => this.stop(new Error('资源获取已取消。'));
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    try { return await this.track(this.acquire(address.url, type)); }
    catch (reason) {
      // 正文接口失败使整次捕获失效；样式失败由宿主警告处理。
      if (type !== 'stylesheet') this.stop(reason instanceof Error ? reason : new Error('资源获取失败。'));
      throw reason;
    } finally { signal?.removeEventListener('abort', cancel); }
  }
  private async acquire(url: string, type: string): Promise<RenderResource & { finalUrl: string }> {
    this.check();
    if (++this.requests > renderLimits.maxRequests) throw this.fatal('网页请求总数超过80次。');
    if (this.active >= renderLimits.maxConcurrentRequests) await this.interrupt(new Promise<void>(resolve => this.queue.push(resolve)));
    this.check(); this.active++;
    try { return await this.requestChain(url, type); }
    finally { this.active--; this.queue.shift()?.(); }
  }
  private async requestChain(url: string, type: string): Promise<RenderResource & { finalUrl: string }> {
    const visited = new Set<string>();
    for (let redirects = 0; ; redirects++) {
      this.check(); let address: ReturnType<typeof publicWebAddress>;
      try { address = publicWebAddress(url); } catch (reason) { this.stop(reason instanceof Error ? reason : new Error('资源地址不安全。')); throw reason; }
      if (this.origin && new URL(address.url).origin !== this.origin) throw this.fatal('资源重定向必须同源。');
      if (visited.has(address.url)) throw new Error('网页重定向循环。'); visited.add(address.url);
      if (redirects > 0 && ++this.requests > renderLimits.maxRequests) throw this.fatal('网页请求总数超过80次。');
      const resolveHost = this.options.dependencies?.resolveHost ?? (async (host: string) => (await lookup(host, { all: true })).map(item => item.address));
      const addresses = await this.interrupt(resolveHost(address.hostname)); this.check();
      if (!addresses.length || !addresses.every(isPublicWebIp)) throw this.fatal('网页目标必须是全部公开地址。');
      const response = await this.open(address.url, addresses);
      try {
        const bytes = await this.read(response); this.check();
        const status = response.statusCode ?? 0;
        if ([301,302,303,307,308].includes(status)) {
          if (redirects >= renderLimits.maxRedirects) throw this.fatal('网页超过三次重定向。');
          const location = this.header(response, 'location'); if (!location) throw new Error('网页重定向缺少地址。');
          url = new URL(location, address.url).href; continue;
        }
        if (status !== 200) throw new Error('网页资源未返回可用内容。');
        const contentType = this.header(response, 'content-type'), mime = contentType.split(';')[0].trim().toLowerCase();
        const accepted = type === 'mainFrame' ? ['text/html','application/xhtml+xml'] : type === 'script' ? ['text/javascript','application/javascript','application/ecmascript','text/ecmascript'] : type === 'stylesheet' ? ['text/css'] : ['application/json','text/json','text/plain','text/html','application/xhtml+xml'];
        if (!accepted.includes(mime)) throw new Error('网页资源MIME不受支持。');
        const headers: Record<string,string> = { 'content-type': contentType, 'content-length': String(bytes.length) };
        for (const name of ['content-security-policy','content-security-policy-report-only','x-content-type-options']) {
          const value = this.header(response,name); if (value && name !== 'content-security-policy-report-only') headers[name] = value;
        }
        return { bytes, contentType, headers, finalUrl: address.url };
      } finally { response.destroy(); }
    }
  }
  private header(response: IncomingMessage, name: string) {
    const value = response.headers[name]; if (Array.isArray(value)) throw new Error('网页响应头格式无效。'); return value ?? '';
  }
  private open(url: string, addresses: string[]): Promise<IncomingMessage> {
    const signal = this.controller.signal;
    return new Promise((resolve,reject) => {
      let outgoing: ClientRequest | undefined;
      const abort = () => { outgoing?.destroy(); reject(signal.reason); };
      if (signal.aborted) { abort(); return; } signal.addEventListener('abort',abort,{once:true});
      try {
        outgoing = (this.options.dependencies?.openRequest ?? request)(url,{ method:'GET',agent:false,signal,rejectUnauthorized:true,
          headers:{Accept:'text/html,application/json,text/javascript,text/css,text/plain', 'Accept-Encoding':'gzip,br,deflate'},
          lookup:(_host,options,callback)=> { if(options.all) callback(null,addresses.map(address=>({address,family:isIP(address)}))); else callback(null,addresses[0],isIP(addresses[0])); }
        },response=>{
          response.once('close',()=>signal.removeEventListener('abort',abort));
          if(signal.aborted) {response.destroy();reject(signal.reason);} else resolve(response);
        });
        outgoing.once('error',()=>{ signal.removeEventListener('abort',abort); reject(signal.aborted ? signal.reason : new Error('网页资源连接失败。')); }); outgoing.end();
      } catch { signal.removeEventListener('abort',abort); reject(new Error('网页资源连接失败。')); }
    });
  }
  private async read(response: IncomingMessage): Promise<Buffer> {
    const encoding=this.header(response,'content-encoding').trim().toLowerCase();
    const decoder=encoding==='gzip'?createGunzip():encoding==='br'?createBrotliDecompress():encoding==='deflate'?createInflate():undefined;
    if(encoding && encoding!=='identity' && !decoder) throw new Error('网页压缩格式不受支持。');
    let compressed=0,decoded=0; const chunks:Buffer[]=[];
    const counter=new Transform({transform:(chunk:Buffer,_encoding,next)=>{
      compressed+=chunk.length; this.compressed+=chunk.length;
      next(compressed>renderLimits.maxResponseCompressedBytes ? this.fatal('单资源压缩大小超限。') : this.compressed>renderLimits.maxTotalCompressedBytes ? this.fatal('资源累计压缩大小超限。') : null,chunk);
    }});
    const collector=new Transform({transform:(chunk:Buffer,_encoding,next)=>{
      decoded+=chunk.length; this.decoded+=chunk.length;
      const error=decoded>renderLimits.maxResponseDecodedBytes ? this.fatal('单资源展开大小超限。') : this.decoded>renderLimits.maxTotalDecodedBytes ? this.fatal('资源累计展开大小超限。') : null;
      if(error) {next(error);return;} chunks.push(Buffer.from(chunk)); next();
    }});
    try { await pipeline(decoder?[response,counter,decoder,collector]:[response,counter,collector],{signal:this.controller.signal}); }
    catch (reason) { if (this.controller.signal.aborted) throw this.controller.signal.reason; throw reason; }
    return Buffer.concat(chunks);
  }
  async close(): Promise<void> {
    this.stop(new Error('网页渲染资源代理已关闭。')); clearTimeout(this.timer); this.options.signal.removeEventListener('abort',this.cancel);
    await Promise.allSettled([...this.running]); this.queue.length=0;
  }
}
