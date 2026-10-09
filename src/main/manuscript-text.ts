import type { ManuscriptBlock, ManuscriptChapter, ManuscriptDraft, ManuscriptOptions } from '../shared/manuscript';

function titleKind(block: ManuscriptBlock): 'volume' | 'chapter' | null {
  const value = block.text.trim();
  if (value.length > 160) return null;
  if (/^第[零〇一二三四五六七八九十百千万两\d]+卷(?:\s|[：:、.．]|$)/u.test(value) || /^volume\s+\d+(?:\s|[.:]|$)/i.test(value)) return 'volume';
  if (/^第[零〇一二三四五六七八九十百千万两\d]+[章回节](?:\s|[：:、.．]|$)/u.test(value)
    || /^\d+[.．、]\s*\S/u.test(value) || /^chapter\s+\d+(?:\s|[.:]|$)/i.test(value)) return 'chapter';
  // 可识别的文档标题用于拆章；无标题样式的短行保持正文。
  if (block.headingLevel !== undefined && block.headingLevel >= 0 && block.headingLevel <= 2 && value) return 'chapter';
  return null;
}

export function splitManuscript(blocks: ManuscriptBlock[]): ManuscriptChapter[] {
  const chapters: ManuscriptChapter[] = [];
  let volumeTitle: string | null = null;
  let current: ManuscriptChapter | undefined;
  for (const block of blocks) {
    const kind = titleKind(block);
    if (kind === 'volume') { volumeTitle = block.text.trim(); current = undefined; continue; }
    if (kind === 'chapter') {
      current = { title: block.text.trim(), volumeTitle, paragraphs: [] };
      chapters.push(current);
    } else {
      if (!current) { current = { title: '正文', volumeTitle, paragraphs: [] }; chapters.push(current); }
      current.paragraphs.push(block.text);
    }
  }
  if (!chapters.length) chapters.push({ title: '正文', volumeTitle, paragraphs: [] });
  return chapters;
}

export function parseTxtManuscript(bytes: Uint8Array, options: ManuscriptOptions): ManuscriptDraft {
  const limit = options.maxInputBytes ?? 128 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || bytes.byteLength > limit) throw new Error('手稿大小超过解析限额，请选择较小文件；未截断内容。');
  let encoding: string = options.encoding ?? 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('手稿编码无法正确解码，请在预览选择 UTF-8 或 GB18030 后重试。'); }
  if ([...text].some(char => { const code = char.codePointAt(0)!; return code < 32 && ![9, 10, 13].includes(code); })) throw new Error('手稿含不支持的控制字符，请检查文件和编码。');
  if (!text.trim()) throw new Error('手稿内容为空。');
  return { title: options.title, format: 'txt', encoding, warnings: [], chapters: splitManuscript(text.replace(/\r\n?/g, '\n').split('\n').map(line => ({ text: line }))) };
}
