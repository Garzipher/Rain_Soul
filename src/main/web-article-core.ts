import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

export interface ArticleText { title: string; paragraphs: string[] }
const invalidText = (text: string) => text.includes('\uFFFD') || Array.from(text).some(char => {
  const code = char.codePointAt(0)!;
  return code < 32 && code !== 9 && code !== 10 && code !== 13;
});

function decodeHtml(bytes: Uint8Array, contentType: string): string {
  if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(contentType.trim())) throw new Error('网页不是支持的 HTML 文本。');
  const header = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  const declaration = /<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(Buffer.from(bytes.subarray(0, 4096)).toString('latin1'))?.[1];
  const encoding = (header ?? declaration ?? 'utf-8').toLowerCase();
  if (!['utf-8', 'utf8', 'gb18030', 'gbk', 'gb2312'].includes(encoding)) throw new Error('网页编码不支持，请粘贴正文或导入本地文件。');
  try {
    const result = new TextDecoder(encoding.startsWith('gb') ? 'gb18030' : 'utf-8', { fatal: true }).decode(bytes);
    if (invalidText(result)) throw new Error();
    return result;
  } catch { throw new Error('网页编码无效或出现乱码，请粘贴正文。'); }
}

/** 仅在隔离Worker中调用；linkedom不会执行脚本或加载网页资源。 */
export function parseArticleDocument(bytes: Uint8Array, contentType: string, maxNodes: number): ArticleText {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 50000) throw new Error('网页解析节点限额无效。');
  const html = decodeHtml(bytes, contentType);
  if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(html)) throw new Error('网页含不支持的实体声明。');
  // 标签预检控制建树成本，真实节点计数在树建立后再次校验。
  if ((html.match(/<[^!/?][^>]*>/g)?.length ?? 0) > maxNodes) throw new Error('网页节点过多，请粘贴需要的正文。');
  const { document } = parseHTML(html);
  const pending = [document as unknown as Node]; let count = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++count > maxNodes) throw new Error('网页节点过多，请粘贴需要的正文。');
    pending.push(...Array.from(node.childNodes));
  }
  if (document.querySelector('input[type="password"]')) throw new Error('网页需要登录，不支持获取受限内容。');
  document.querySelectorAll('script,style,nav,header,footer,aside,iframe,object,embed,form,noscript').forEach(node => node.remove());
  const originalTitle = document.title?.trim() ?? '';
  // 优先由成熟正文提取器识别；短小但明确的article也允许手工阅读。
  const article = new Readability(document as unknown as Document, { charThreshold: 100, maxElemsToParse: maxNodes }).parse();
  const content = article?.content;
  const extracted = content ? parseHTML(`<html><body>${content}</body></html>`).document : document;
  const root = content ? extracted.body : extracted.querySelector('article,main');
  if (!root) throw new Error('无法识别网页正文，请粘贴正文或导入本地文件。');
  root.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  const candidates = Array.from(root.querySelectorAll('p,li,pre,blockquote'));
  const paragraphs = candidates.filter(node => !node.querySelector('p,li,pre,blockquote'))
    .map(node => (node.textContent ?? '').replace(/\r\n?/g, '\n')).filter(text => text.trim());
  if (!paragraphs.length && root.textContent?.trim()) paragraphs.push(root.textContent);
  if (!paragraphs.length) throw new Error('网页没有可摘选的正文，请粘贴正文。');
  if (paragraphs.length > 2000 || Array.from(paragraphs.join('')).length > 200000) throw new Error('网页正文超过容量限制，请缩小素材范围。');
  const title = (article?.title || originalTitle || '网页素材').trim();
  if (invalidText(title) || paragraphs.some(invalidText)) throw new Error('网页正文包含无效字符，请粘贴正文。');
  if (Array.from(title).length > 200) throw new Error('网页标题超过200字符，请使用粘贴正文入口。');
  return { title, paragraphs };
}
