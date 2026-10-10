import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import type { AiProvider } from '../shared/ai';

export interface AiTransportDependencies {
  credentials: { read(providerId: string, expectedProvider?: AiProvider): Promise<string | null> };
  fetch?: typeof fetch; resolveHost?: (hostname: string) => Promise<string[]>;
}
export interface AiTransportRequest { provider: AiProvider; url: string; hostname: string; body: string }
function containsCredential(content: string, key: string): boolean {
  if (content.includes(key)) return true;
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return false; }
  // 结构化回答解码后才展示；迭代检查字段和值，避免深层JSON造成递归溢出。
  const pending: unknown[] = [parsed];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string' && value.includes(key)) return true;
    if (value && typeof value === 'object') for (const [field, child] of Object.entries(value)) pending.push(field, child);
  }
  return false;
}
function isPublicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 100 && b >= 64 && b <= 127 ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6) {
    // URL 会压缩 2001:0000:: 为 2001::，按前两个数值段检查 /32，不能依赖原始拼写。
    const [first, second] = address.split(':').map(part => Number.parseInt(part || '0', 16));
    return first >= 0x2000 && first <= 0x3fff && !(first === 0x2001 && (second === 0 || second === 0xdb8));
  }
  return false;
}
export function aiCompletionEndpoint(baseUrl: string) {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('云端服务地址无效。'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !hostname ||
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') ||
    !isIP(hostname) && !hostname.includes('.') || isIP(hostname) && !isPublicIp(hostname)) throw new Error('云端服务地址必须为 HTTPS 公开地址，不能包含凭据、查询参数或本机/私网地址。');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return { url: url.href, hostname };
}
/** 默认发送固定到已检查的公开 IP，TLS 仍验证原服务域名，阻止 DNS 重绑定。 */
export function responseFromPublicHttp(status: number, body: Buffer): Response {
  return new Response([204, 205, 304].includes(status) ? null : Uint8Array.from(body), { status });
}
async function publicHttpsFetch(url: string, options: RequestInit, addresses: string[]): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = httpsRequest(url, { method: 'POST', agent: false, headers: options.headers as Record<string, string>, signal: options.signal ?? undefined,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, addresses.map(address => ({ address, family: isIP(address) })));
        else callback(null, addresses[0], isIP(addresses[0]));
      },
    }, response => {
      let length = 0; const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > 2_000_000) { response.destroy(new Error('响应过大')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(responseFromPublicHttp(response.statusCode ?? 502, Buffer.concat(chunks))); }
        catch (reason) { reject(reason); }
      });
    });
    outgoing.on('error', reject); outgoing.end(options.body as string);
  });
}

/** 仅发送已冻结的公开端点请求；失败不重发，完整响应才返回。 */
export async function sendAiCompletion(request: AiTransportRequest, dependencies: AiTransportDependencies, signal: AbortSignal, beforeSend?: () => Promise<void>): Promise<string> {
  let addresses: string[];
  try { addresses = isIP(request.hostname) ? [request.hostname] : await (dependencies.resolveHost ?? (async hostname => (await lookup(hostname, { all: true })).map(item => item.address)))(request.hostname); }
  catch { throw new Error('无法确认云端服务公开地址，请检查配置后手动重试。'); }
  signal.throwIfAborted();
  if (!addresses.length || !addresses.every(isPublicIp)) throw new Error('云端服务必须使用公开地址，拒绝本机或私网目标。');
  let key: string | null;
  try { key = await dependencies.credentials.read(request.provider.id, request.provider); } catch { throw new Error('无法读取云端服务凭据，请重新配置。'); }
  if (!key || /[\r\n]/.test(key)) throw new Error('尚未配置有效的云端服务凭据。');
  signal.throwIfAborted();
  await beforeSend?.(); signal.throwIfAborted();
  let response: Response;
  try {
    const init: RequestInit = { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: request.body, signal };
    response = await (dependencies.fetch ? dependencies.fetch(request.url, init) : publicHttpsFetch(request.url, init, addresses));
  }
  catch { throw new Error('云端服务连接失败，请检查网络后手动重试。'); }
  signal.throwIfAborted();
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '云端服务认证失败，请检查凭据。' : response.status === 402 || response.status === 429 ? '云端服务额度不足或请求受限，请稍后手动重试。' : '云端服务请求失败，请稍后手动重试。');
  let payload: unknown;
  try { const text = await response.text(); if (text.length > 2_000_000) throw new Error(); payload = JSON.parse(text); } catch { throw new Error('云端服务响应格式无效或过大。'); }
  signal.throwIfAborted();
  const choice = (payload as { choices?: { finish_reason?: unknown; message?: { content?: unknown; refusal?: unknown } }[] } | null)?.choices?.[0];
  const refusal = choice?.message?.refusal;
  if (refusal != null && (typeof refusal !== 'string' || refusal.trim())) throw new Error('云端服务拒绝生成本次内容，未生成可用候选；请调整要求后重新预览确认。');
  const finishReason = choice?.finish_reason;
  if (finishReason === 'length') throw new Error('云端响应因输出上限而截断，未生成完整候选；请缩小目标范围后重新预览确认。');
  if (finishReason === 'content_filter') throw new Error('云端响应被内容过滤，未生成完整候选；请调整要求后重新预览确认。');
  if (finishReason === 'tool_calls' || finishReason === 'function_call') throw new Error('云端服务返回了不支持的工具调用，未生成完整正文候选；请检查模型配置后重新预览确认。');
  // 部分兼容服务不提供结束原因；明确提供时只接受正常完成，不回显厂商原始字段。
  if (finishReason !== undefined && finishReason !== 'stop') throw new Error('无法确认云端响应已完整结束，未生成可用候选；请检查服务兼容性后重新预览确认。');
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('云端服务未返回有效响应内容。');
  if (containsCredential(content, key)) throw new Error('云端服务响应包含敏感凭据，已阻止展示。');
  return content;
}
