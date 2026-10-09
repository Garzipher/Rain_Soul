import { describe, expect, it } from 'vitest';
import { countDocumentWords, emptyDocument, validateDocument } from '../../src/shared/document';

describe('受限正文与统计', () => {
  it('书签保持稳定关联且不计字数，拒绝重复 ID 和非法目标', () => {
    const doc = emptyDocument();
    const bookmark = { type: 'bookmark', attrs: { id: crypto.randomUUID(), kind: 'knowledge', targetId: crypto.randomUUID() } };
    const value = { ...doc, content: [{ ...doc.content[0], content: [{ type: 'text', text: '雨A1' }, bookmark] }] };
    expect(countDocumentWords(validateDocument(value))).toBe(3);
    expect(validateDocument(value).content[0].content?.[1]).toEqual(bookmark);
    expect(() => validateDocument({ ...doc, content: [{ ...doc.content[0], content: [bookmark, bookmark] }] })).toThrow(/书签/);
    expect(() => validateDocument({ ...doc, content: [{ ...doc.content[0], content: [{ ...bookmark, attrs: { ...bookmark.attrs, targetId: '../外部目标' } }] }] })).toThrow();
  });
  it('统计汉字与 ASCII 字母数字，排除空白和标点', () => {
    const doc = emptyDocument();
    doc.content[0].content = [{ type: 'text', text: '雨A1， B2\n𠮷！１２é' }, { type: 'hardBreak' }];
    expect(countDocumentWords(doc)).toBe(6);
  });
  it('空正文有独立稳定段落且计数为零', () => {
    const first = emptyDocument();
    expect(countDocumentWords(first)).toBe(0);
    expect(first.content[0].attrs.id).not.toBe(emptyDocument().content[0].attrs.id);
    expect(validateDocument(first)).toEqual(first);
  });
  it('拒绝外来结构与重复段落 ID', () => {
    const doc = emptyDocument();
    expect(() => validateDocument({ ...doc, content: [doc.content[0], doc.content[0]] })).toThrow();
    expect(() => validateDocument({ ...doc, content: [{ type: 'image', attrs: { src: 'https://example.com' } }] })).toThrow();
    expect(() => validateDocument({ ...doc, content: [] })).toThrow();
  });
  it('不能借嵌入 HTML 或未知属性绕过结构校验', () => {
    const doc = emptyDocument();
    doc.content[0].content = [{ type: 'text', text: '<script>正文</script>' }];
    expect(validateDocument(doc).content[0].content?.[0]).toEqual({ type: 'text', text: '<script>正文</script>' });
    expect(() => validateDocument({ ...doc, executable: true })).toThrow();
    expect(() => validateDocument({ ...doc, content: [{ ...doc.content[0], attrs: { id: '../非法路径' } }] })).toThrow();
  });
});
