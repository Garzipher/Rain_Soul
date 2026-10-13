/** 静态与受限渲染复用严格解码；调用者各自决定编码声明优先规则。 */
export function decodeHtmlText(bytes: Uint8Array, encoding: string): string {
  try {
    const result = new TextDecoder(encoding.startsWith('gb') ? 'gb18030' : 'utf-8', { fatal: true }).decode(bytes);
    for (const char of result) {
      const code = char.codePointAt(0)!;
      if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) throw new Error();
    }
    return result;
  } catch { throw new Error('网页编码无效或出现乱码，请粘贴正文。'); }
}
