import { describe, expect, it } from 'vitest';
import { Document, HeadingLevel, Packer, Paragraph, TextRun, Table, TableCell, TableRow } from 'docx';
import { parseDocxManuscript } from '../../src/main/manuscript-docx';
import { readDocxPackage } from '../../src/main/manuscript-docx';
import { parseWordXml } from '../../src/main/manuscript-xml';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = (body: string) => `<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`;

describe('受限 DOCX 手稿解析', () => {
  it('真实 DOCX 标题拆章，正文 Unicode、换行保留，表格不当正文且有预览提示', async () => {
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph({ text: '第一章 雨夜', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun('雨🌧️'), new TextRun({ break: 1, text: '之后' })] }),
      new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('不应入正文')] })] })] }),
    ] }] }));
    const draft = await parseDocxManuscript(bytes, { title: '雨落之后' });
    expect(draft.chapters).toEqual([{ title: '第一章 雨夜', volumeTitle: null, paragraphs: ['雨🌧️\n之后'] }]);
    expect(draft.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ignored-table', count: 1 })]));
  });
  it('标题样式继承、段落 outlineLvl 优先；缺失与循环样式降级正文', () => {
    const styles = `<w:styles xmlns:w="${w}"><w:style w:styleId="Base"><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style><w:style w:styleId="Child"><w:basedOn w:val="Base"/></w:style><w:style w:styleId="Loop"><w:basedOn w:val="Loop"/></w:style></w:styles>`;
    const result = parseWordXml(xml('<w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:t>样式章</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Loop"/></w:pPr><w:r><w:t>正文</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Missing"/><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>直接章</w:t></w:r></w:p>'), styles);
    expect(result.blocks).toEqual([{ text: '样式章', headingLevel: 1 }, { text: '正文' }, { text: '直接章', headingLevel: 0 }]);
  });
  it('只读顶层正文，图片/文本框/域命令不当正文，保留文本节点和制表符', () => {
    const result = parseWordXml(xml('<w:p><w:r><w:t>A&amp;雨</w:t><w:tab/><w:t>B</w:t><w:drawing><w:t>图片内容</w:t></w:drawing><w:instrText>恶意命令</w:instrText></w:r></w:p><w:p><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>文本框</w:t></w:r></w:p></w:txbxContent></w:pict></w:r></w:p>'));
    expect(result.blocks).toEqual([{ text: 'A&雨 B' }, { text: '' }]);
    expect(result.warnings.map(x => x.code)).toEqual(expect.arrayContaining(['ignored-image', 'ignored-textbox', 'ignored-field']));
  });
  it('拒绝 DTD、错误 XML、过深与过多节点，不运行实体', () => {
    expect(() => parseWordXml(`<!DOCTYPE x [<!ENTITY a SYSTEM "file:///C:/secret">]>${xml('')}`)).toThrow(/DTD/);
    expect(() => parseWordXml('<w:document>')).toThrow();
    expect(() => parseWordXml(xml('<w:p><w:r><w:t>雨</w:t></w:r></w:p>'), undefined, { maxDepth: 3 })).toThrow(/深度/);
    expect(() => parseWordXml(xml('<w:p><w:r><w:t>雨</w:t></w:r></w:p>'), undefined, { maxNodes: 2 })).toThrow(/节点/);
  });
  it('无效、截断或超限 ZIP 不进入预览', async () => {
    await expect(parseDocxManuscript(Buffer.from('不是docx'), { title: '书' })).rejects.toThrow();
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('雨')] }] }));
    await expect(parseDocxManuscript(bytes, { title: '书', maxInputBytes: 3 })).rejects.toThrow(/大小/);
    await expect(parseDocxManuscript(bytes.subarray(0, bytes.length - 20), { title: '书' })).rejects.toThrow();
  });
  it.each([0, -1, NaN, Infinity, 1.5])('非法展开/条目/XML限额 %s 必须拒绝', async limit => {
    await expect(readDocxPackage(Buffer.from('任何内容'), { title: '书', maxExpandedBytes: limit })).rejects.toThrow(/限额/);
    await expect(readDocxPackage(Buffer.from('任何内容'), { title: '书', maxEntries: limit })).rejects.toThrow(/限额/);
    expect(() => parseWordXml(xml('<w:p/>'), undefined, { maxDepth: limit })).toThrow(/限额/);
    expect(() => parseWordXml(xml('<w:p/>'), undefined, { maxNodes: limit })).toThrow(/限额/);
  });
});
