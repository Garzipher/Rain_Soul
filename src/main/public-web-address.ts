import { isIP } from 'node:net';
export class PublicWebAddressError extends Error {}

/** 网页入口采取保守策略：特殊用途、过渡与非单播地址均不可连接。 */
export function isPublicWebIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127 ||
      a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6 || address.includes('%')) return false;
  const normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1);
  const [first, second] = normalized.split(':').map(part => Number.parseInt(part || '0', 16));
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3ffe &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && !(first === 0x3fff && second < 0x1000);
}

export function publicWebAddress(value: string): { url: string; hostname: string } {
  const invalid = () => new PublicWebAddressError('网页地址必须是无凭据的 HTTPS/443 公开域名地址，长度不能超过2048字符。');
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/u.test(value) ||
    Array.from(value).some(char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127)) throw invalid();
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password || !hostname) throw invalid();
  if (isIP(hostname) || !hostname.includes('.') || hostname.length > 253 ||
    hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)) ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|onion|test|invalid|example|arpa)$/u.test(hostname)) throw invalid();
  url.hostname = hostname;
  url.hash = '';
  if (url.href.length > 2048) throw invalid();
  return { url: url.href, hostname };
}
