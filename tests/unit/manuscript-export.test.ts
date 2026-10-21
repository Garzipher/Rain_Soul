import { describe, expect, it } from 'vitest';
import { exportDocxManuscript, exportTxtManuscript } from '../../src/main/manuscript-export';
import { readDocxPackage } from '../../src/main/manuscript-docx';
import { parseWordXml } from '../../src/main/manuscript-xml';
import type { ExportManuscript } from '../../src/shared/manuscript';
import { auditedKnowledgeSource } from './knowledge-source-helper';

function example(): ExportManuscript {
  const paragraph = (id: string, text: string) => ({ type: 'paragraph' as const, attrs: { id }, content: [{ type: 'text' as const, text }] });
  return { title: '雨落之后', revision: 7, volumes: [{ title: '第一卷 雨', chapters: [{ id: 'chapter-1', title: '第一章 雨夜', document: { type: 'doc', content: [
    { type: 'paragraph', attrs: { id: 'paragraph-1' }, content: [
      { type: 'text', text: '雨🌧️' }, { type: 'bookmark', attrs: { id: 'bookmark-1', kind: 'knowledge', targetId: 'knowledge-1' } },
      { type: 'hardBreak' }, { type: 'text', text: '之后' }, { type: 'bookmark', attrs: { id: 'bookmark-2', kind: 'foreshadow', targetId: 'foreshadow-1' } },
    ] },
  ] } }, { id: 'chapter-2', title: '第二章 空章', document: { type: 'doc', content: [] } }] }], unvolumedChapters: [
    { id: 'chapter-3', title: '第三章 归来', document: { type: 'doc', content: [paragraph('paragraph-3', '回家'),
      { type: 'paragraph', attrs: { id: 'paragraph-4' }, content: [{ type: 'bookmark', attrs: { id: 'bookmark-3', kind: 'knowledge', targetId: 'knowledge-1' } }, { type: 'bookmark', attrs: { id: 'bookmark-4', kind: 'knowledge', targetId: 'knowledge-deleted' } }] },
    ] } },
  ], knowledge: [
    { id: 'knowledge-1', body: '雨像琴弦。', source: '作者：听雨《雨季》', deletedAt: null },
    { id: 'knowledge-deleted', body: '旧素材', source: '旧稿', deletedAt: '2026-10-09' },
    { id: 'knowledge-unused', body: '不应导出', source: '', deletedAt: null },
  ], foreshadows: [{ id: 'foreshadow-1', name: '旧钥匙', status: '已触发', description: '藏在门后', outlineId: null, deletedAt: null }], evidence: [
    { id: 'evidence-1', foreshadowId: 'foreshadow-1', kind: '埋设', chapterId: 'chapter-1', paragraphId: 'paragraph-1', excerpt: '雨🌧️', sourceRevision: 3,
      originalSource: { chapterId: 'chapter-1', chapterTitle: '第一章 雨夜', paragraphId: 'paragraph-1', excerpt: '雨🌧️', revision: 3 }, supersedesId: null, supersededBy: null, deletedAt: null, valid: true, invalidReason: null },
    { id: 'evidence-2', foreshadowId: 'foreshadow-1', kind: '触发', chapterId: 'chapter-deleted', paragraphId: 'paragraph-old', excerpt: '原摘录', sourceRevision: 4,
      originalSource: { chapterId: 'chapter-deleted', chapterTitle: '已删章节', paragraphId: 'paragraph-old', excerpt: '原摘录', revision: 4 }, supersedesId: null, supersededBy: null, deletedAt: null, valid: false, invalidReason: '章节已删除' },
  ] };
}

describe('固定版本手稿导出', () => {
  it('TXT和DOCX引用清单只导出可读出处，原始冻结来源保留审计', async () => {
    const work = example(), audit = auditedKnowledgeSource('作者：听雨《雨季》'); work.knowledge[0].source = audit.source;
    const files = await readDocxPackage(await exportDocxManuscript(work), { title: '书' });
    const docx = parseWordXml(files.get('word/document.xml')!.toString('utf8'), files.get('word/styles.xml')!.toString('utf8'));
    for (const text of [exportTxtManuscript(work).toString('utf8'), docx.blocks.map(block => block.text).join('\n')]) {
      expect(text).toContain('出处：作者：听雨《雨季》'); expect(text).not.toContain('上下文独有秘词'); expect(text).not.toContain('AI 审核来源');
    }
    expect(work.knowledge[0].source).toBe(audit.source);
  });
  it('TXT按输入卷章顺序保留Unicode/空章/换行，重复知识复用编号并只列一次', () => {
    const work = example(), before = structuredClone(work);
    const text = exportTxtManuscript(work).toString('utf8');
    expect(text.indexOf('第一卷 雨')).toBeLessThan(text.indexOf('第一章 雨夜'));
    expect(text.indexOf('第三章 归来')).toBeLessThan(text.indexOf('第一卷 雨'));
    expect(text.indexOf('第一章 雨夜')).toBeLessThan(text.indexOf('第二章 空章'));
    expect(text).toContain('雨🌧️[1]\r\n之后[伏笔：旧钥匙]');
    expect(text).toContain('[1][2]');
    expect(text.match(/\[1\] 雨像琴弦。/g)).toHaveLength(1);
    expect(text).toContain('[2] 已删除条目');
    expect(text).toContain('旧素材');
    expect(text).toContain('出处：作者：听雨《雨季》');
    expect(text).not.toContain('不应导出');
    expect(text).toContain('状态：已触发');
    expect(text).toContain('段落：paragraph-1');
    expect(text).toContain('已失效：章节已删除');
    expect(text).toContain('已删章节');
    expect(work).toEqual(before);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });
  it.each(['当前版本', '历史冻结版本'])('%s混合卷章TXT/DOCX与正文树一致，首次引用按序章分配', async label => {
    const work = example(); work.revision = label === '当前版本' ? 10 : 3;
    const opening = work.unvolumedChapters[0]; opening.title = '序章';
    opening.document.content[1].content!.reverse();
    const before = structuredClone(work);
    const txt = exportTxtManuscript(work).toString('utf8');
    const files = await readDocxPackage(await exportDocxManuscript(work), { title: '书' });
    const parsed = parseWordXml(files.get('word/document.xml')!.toString('utf8'), files.get('word/styles.xml')!.toString('utf8'));
    for (const text of [txt, parsed.blocks.map(block => block.text).join('\n')]) {
      expect(text.indexOf('序章')).toBeLessThan(text.indexOf('第一卷 雨'));
      expect(text.indexOf('第一卷 雨')).toBeLessThan(text.indexOf('第一章 雨夜'));
      expect(text.indexOf('第一章 雨夜')).toBeLessThan(text.indexOf('第二章 空章'));
      expect(text).toContain('[1][2]');
      expect(text).toContain('雨🌧️[2]');
      expect(text).toContain('[1] 已删除条目');
      expect(text.match(/\[2\] 雨像琴弦。/g)).toHaveLength(1);
    }
    expect(work).toEqual(before);
  });
  it('DOCX真实包可解析，正文/卷章标题固定字体字号颜色和1.5行距', async () => {
    const bytes = await exportDocxManuscript(example());
    const files = await readDocxPackage(bytes, { title: '书' });
    const document = files.get('word/document.xml')!.toString('utf8'), styles = files.get('word/styles.xml')!.toString('utf8');
    const parsed = parseWordXml(document, styles);
    expect(parsed.blocks.map(x => x.text).join('\n')).toContain('雨🌧️[1]\n之后[伏笔：旧钥匙]');
    expect(document).toContain('w:ascii="Microsoft YaHei"');
    expect(document).toContain('w:sz w:val="24"');
    expect(document).toContain('w:sz w:val="32"');
    expect(document).toContain('w:line="360"');
    expect(document).toContain('w:color w:val="242424"');
    expect(document).toContain('w:color w:val="1C1C1C"');
    expect(document).toContain('<w:b/>');
  });
  it('仅使用调用者冻结的历史知识，不读取当前知识或改变源对象', () => {
    const historic = example(); historic.knowledge[0].body = '历史当时的内容';
    expect(exportTxtManuscript(historic).toString('utf8')).toContain('历史当时的内容');
    expect(exportTxtManuscript(historic).toString('utf8')).not.toContain('雨像琴弦。');
  });
  it('正文净稿移除行内管理书签并隐藏知识/伏笔清单，正文和卷章标题保持不变', async () => {
    const work = example();
    const txt = exportTxtManuscript(work, 'clean').toString('utf8').replace(/\r\n/g, '\n');
    const files = await readDocxPackage(await exportDocxManuscript(work, 'clean'), { title: '书' });
    const docx = parseWordXml(files.get('word/document.xml')!.toString('utf8'), files.get('word/styles.xml')!.toString('utf8'));
    for (const text of [txt, docx.blocks.map(block => block.text).join('\n')]) {
      expect(text).toContain('雨🌧️\n之后');
      expect(text).toContain('第一卷 雨');
      expect(text).toContain('第一章 雨夜');
      expect(text).not.toContain('[1]');
      expect(text).not.toContain('[伏笔：');
      expect(text).not.toContain('引用清单');
      expect(text).not.toContain('伏笔清单');
      expect(text).not.toContain('雨像琴弦。');
      expect(text).not.toContain('来源版本');
    }
  });
  it('未指定导出模式仍兼容含创作资料的原有格式', () => {
    const text = exportTxtManuscript(example()).toString('utf8');
    expect(text).toContain('[1]');
    expect(text).toContain('[伏笔：旧钥匙]');
    expect(text).toContain('引用清单');
    expect(text).toContain('伏笔清单');
  });
  it('知识/伏笔悬空关联、重复ID、非法XML字符与无效版本拒绝，不生成误导文件', async () => {
    const missing = example(); missing.knowledge = [];
    expect(() => exportTxtManuscript(missing)).toThrow(/引用/);
    await expect(exportDocxManuscript(missing)).rejects.toThrow(/引用/);
    const bad = example(); bad.title = '坏\u0000标题'; expect(() => exportTxtManuscript(bad)).toThrow(/字符/);
    const duplicate = example(); duplicate.knowledge.push(duplicate.knowledge[0]); expect(() => exportTxtManuscript(duplicate)).toThrow(/重复/);
    const version = example(); version.revision = -1; expect(() => exportTxtManuscript(version)).toThrow(/版本/);
  });
  it('没有书签的作品不输出引用清单，章节级证据和已删除伏笔仍可追溯', () => {
    const plain = example();
    for (const chapter of [...plain.volumes.flatMap(volume => volume.chapters), ...plain.unvolumedChapters]) {
      for (const paragraph of chapter.document.content) paragraph.content = paragraph.content?.filter(node => node.type !== 'bookmark');
    }
    plain.evidence[0].paragraphId = null;
    expect(exportTxtManuscript(plain).toString('utf8')).not.toContain('引用清单');
    expect(exportTxtManuscript(plain).toString('utf8')).toContain('段落：章节级');
    plain.foreshadows[0].deletedAt = '2026-10-09';
    expect(exportTxtManuscript(plain).toString('utf8')).not.toContain('伏笔清单');
    const removed = example(); removed.foreshadows[0].deletedAt = '2026-10-09';
    expect(exportTxtManuscript(removed).toString('utf8')).toContain('已删除伏笔：旧钥匙');
  });
  it('段落、书签、章节重复和悬空伏笔拒绝；孤立代理字符也不可落盘', () => {
    const missing = example(); missing.foreshadows = [];
    expect(() => exportTxtManuscript(missing)).toThrow(/伏笔引用/);
    const chapter = example(); chapter.unvolumedChapters.push(chapter.unvolumedChapters[0]);
    expect(() => exportTxtManuscript(chapter)).toThrow(/重复/);
    const paragraph = example(); paragraph.unvolumedChapters[0].document.content.push(paragraph.volumes[0].chapters[0].document.content[0]);
    expect(() => exportTxtManuscript(paragraph)).toThrow(/重复/);
    const bookmark = example(); bookmark.volumes[0].chapters[0].document.content[0].content!.push({ type: 'bookmark', attrs: { id: 'bookmark-1', kind: 'knowledge', targetId: 'knowledge-1' } });
    expect(() => exportTxtManuscript(bookmark)).toThrow(/书签.*重复/);
    const bad = example(); bad.title = '\ud800';
    expect(() => exportTxtManuscript(bad)).toThrow(/字符/);
  });
});
