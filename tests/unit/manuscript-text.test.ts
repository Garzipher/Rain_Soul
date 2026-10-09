import { describe, expect, it } from 'vitest';
import { parseTxtManuscript } from '../../src/main/manuscript-text';

describe('TXT 手稿预览', () => {
  it('识别中文卷章并保留章前正文、空章和 Unicode', () => {
    const draft = parseTxtManuscript(Buffer.from('题记：雨\n\n第一卷 初雨\n第一章 相逢\n雨落之后🌧️\n第二章 转身\n第二卷 晴天\n第3章 归来\n结束'), { title: '雨落之后' });
    expect(draft.title).toBe('雨落之后');
    expect(draft.chapters).toEqual([
      { title: '正文', volumeTitle: null, paragraphs: ['题记：雨', ''] },
      { title: '第一章 相逢', volumeTitle: '第一卷 初雨', paragraphs: ['雨落之后🌧️'] },
      { title: '第二章 转身', volumeTitle: '第一卷 初雨', paragraphs: [] },
      { title: '第3章 归来', volumeTitle: '第二卷 晴天', paragraphs: ['结束'] },
    ]);
  });
  it('不把普通短行当标题，无法识别则整份作为一章', () => {
    const draft = parseTxtManuscript(Buffer.from('雨\n落\n之后'), { title: '手稿' });
    expect(draft.chapters).toEqual([{ title: '正文', volumeTitle: null, paragraphs: ['雨', '落', '之后'] }]);
  });
  it.each(['第十二章 雨夜', '第12回 雨夜', '12. 雨夜', 'Chapter 12 Rain'])('识别常见标题 %s', title => {
    expect(parseTxtManuscript(Buffer.from(`${title}\n正文`), { title: '书' }).chapters[0]).toEqual({ title, volumeTitle: null, paragraphs: ['正文'] });
  });
  it('自动识别 UTF8/UTF16 BOM，并提示编码可在预览切换', () => {
    expect(parseTxtManuscript(Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from('雨')]), { title: '书' }).chapters[0].paragraphs).toEqual(['雨']);
    expect(parseTxtManuscript(Buffer.concat([Buffer.from([255, 254]), Buffer.from('雨', 'utf16le')]), { title: '书' }).encoding).toBe('utf-16le');
    expect(parseTxtManuscript(Buffer.from([254, 255, 0x96, 0xe8]), { title: '书' }).chapters[0].paragraphs).toEqual(['雨']);
  });
  it('拒绝静默替换非法 UTF8，作者显式改 GB18030 可读中文', () => {
    const gb = Buffer.from([0xd3, 0xea]);
    expect(() => parseTxtManuscript(gb, { title: '书' })).toThrow(/编码/);
    expect(parseTxtManuscript(gb, { title: '书', encoding: 'gb18030' }).chapters[0].paragraphs).toEqual(['雨']);
  });
  it('拒绝空手稿、NUL、超限与非法选项，不创建作品或截断', () => {
    expect(() => parseTxtManuscript(Buffer.from(' \r\n'), { title: '书' })).toThrow(/为空/);
    expect(() => parseTxtManuscript(Buffer.from('雨\0'), { title: '书' })).toThrow(/控制/);
    expect(() => parseTxtManuscript(Buffer.from('雨落之后'), { title: '书', maxInputBytes: 3 })).toThrow(/大小/);
  });
});
