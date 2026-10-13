import { decodeHtmlText } from './web-html-encoding';
import { renderLimits } from './restricted-render-policy';

type Declaration = { start: number; end: number; value: string };
const charset = /\bcharset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;"'<>]*))/gi;
function canonical(value: string): string {
  const label = value.toLowerCase();
  if (label === 'utf-8' || label === 'utf8') return 'utf-8';
  if (['gb18030', 'gbk', 'gb2312'].includes(label)) return 'gb18030';
  throw new Error('网页编码不支持，请粘贴正文或导入本地文件。');
}
function* charsets(value: string, offset = 0): Generator<Declaration> {
  for (const match of value.matchAll(charset)) {
    const label = match[1] ?? match[2] ?? match[3], start = offset + match.index + match[0].indexOf(label);
    yield { start, end: start + label.length, value: label };
  }
}
/** 单次有界扫描真实标签；注释与脚本/样式中的字符串不能充当编码声明。 */
function declarations(html: string): Declaration[] {
  const result: Declaration[] = [];
  const append = (item: Declaration) => {
    if (result.length >= renderLimits.maxDomNodes) throw new Error('网页编码声明数量超限。');
    result.push(item);
  };
  let index = 0;
  while ((index = html.indexOf('<', index)) !== -1) {
    if (html.startsWith('<!--', index)) { const end = html.indexOf('-->', index + 4); index = end < 0 ? html.length : end + 3; continue; }
    let end = index + 1, quote = '';
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === html.length) break;
    const tag = html.slice(index, end + 1), name = /^<([a-z][\w:-]*)\b/i.exec(tag)?.[1]?.toLowerCase();
    if (name === 'meta') for (const item of charsets(tag, index)) append(item);
    if (tag.startsWith('<?xml')) {
      const match = /\bencoding\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(tag);
      if (match) { const label = match[1] ?? match[2], start = index + match.index + match[0].indexOf(label); append({ start, end: start + label.length, value: label }); }
    }
    index = end + 1;
    if (name === 'plaintext') index = html.length;
    if (name && ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'].includes(name)) {
      const closing = new RegExp(`</${name}\\s*>`, 'gi'); closing.lastIndex = index;
      const match = closing.exec(html); index = match ? closing.lastIndex : html.length;
    }
  }
  return result;
}

/** 先核对声明再严格解码；HTTP、BOM、文档声明冲突时不猜测。 */
export function normalizeRestrictedHtml(bytes: Buffer, contentType: string, maxBytes: number): { bytes: Buffer; contentType: string } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > renderLimits.maxResponseDecodedBytes) throw new Error('网页编码转换限额无效。');
  if (bytes.length > maxBytes) throw new Error('网页编码转换输入容量超限。');
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (!['text/html', 'application/xhtml+xml'].includes(mime)) throw new Error('网页不是支持的 HTML 文本。');
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0)) throw new Error('网页编码BOM不支持。');
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const values = new Set<string>(); let count = 0;
  const accept = (item: Declaration) => {
    if (++count > renderLimits.maxDomNodes) throw new Error('网页编码声明数量超限。');
    values.add(canonical(item.value));
  };
  for (const item of charsets(contentType)) accept(item);
  for (const item of declarations(bytes.toString('latin1'))) accept(item);
  if (bom) values.add('utf-8');
  if (values.size > 1) throw new Error('网页编码声明冲突，请粘贴正文。');
  const html = decodeHtmlText(bytes, values.values().next().value ?? 'utf-8'), changes = declarations(html);
  const chunks: string[] = []; let offset = 0;
  for (const change of changes) { chunks.push(html.slice(offset, change.start), 'utf-8'); offset = change.end; }
  chunks.push(html.slice(offset));
  const normalized = chunks.join('');
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes) throw new Error('网页编码转换展开容量超限。');
  return { bytes: Buffer.from(normalized, 'utf8'), contentType: `${mime}; charset=utf-8` };
}
