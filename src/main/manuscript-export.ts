import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { ExportManuscript } from '../shared/manuscript';
import { readableKnowledgeSource } from '../shared/knowledge-source';

interface OutputBlock { text: string; heading: boolean }

function assertText(value: string): void {
  if (typeof value !== 'string') throw new Error('导出文本类型无效。');
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if ((code < 32 && ![9, 10, 13].includes(code)) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) throw new Error('导出文本含非法 XML 字符。');
  }
}

/** 冻结数据必须保持关联完整；不为悬空书签编造内容。 */
function prepare(work: ExportManuscript): OutputBlock[] {
  if (!Number.isSafeInteger(work.revision) || work.revision < 0) throw new Error('导出版本无效。');
  const validateStrings = (value: unknown): void => {
    if (typeof value === 'string') assertText(value);
    else if (Array.isArray(value)) value.forEach(validateStrings);
    else if (value && typeof value === 'object') Object.values(value).forEach(validateStrings);
  };
  validateStrings(work);
  const unique = <T extends { id: string }>(items: T[]): Map<string, T> => {
    const map = new Map<string, T>();
    for (const item of items) {
      if (!item.id || map.has(item.id)) throw new Error('导出对象 ID 缺失或重复。');
      map.set(item.id, item);
    }
    return map;
  };
  const chapters = [...work.unvolumedChapters, ...work.volumes.flatMap(volume => volume.chapters)];
  const chapterMap = unique(chapters), knowledge = unique(work.knowledge), foreshadows = unique(work.foreshadows);
  unique(work.evidence);
  const paragraphs = new Set<string>(), bookmarks = new Set<string>(), references = new Map<string, number>();
  const usedForeshadows = new Set<string>();
  const blocks: OutputBlock[] = [];
  const add = (text: string, heading = false) => blocks.push({ text: text.replace(/\r\n?/g, '\n'), heading });
  add(work.title, true);
  const addChapter = (chapter: typeof chapters[number]) => {
    add(chapter.title, true);
    if (chapter.document.type !== 'doc' || !Array.isArray(chapter.document.content)) throw new Error('导出正文结构无效。');
    for (const paragraph of chapter.document.content) {
      if (paragraph.type !== 'paragraph' || !paragraph.attrs.id || paragraphs.has(paragraph.attrs.id)) throw new Error('导出段落 ID 缺失或重复。');
      paragraphs.add(paragraph.attrs.id);
      let text = '';
      for (const inline of paragraph.content ?? []) {
        if (inline.type === 'text') text += inline.text;
        else if (inline.type === 'hardBreak') text += '\n';
        else if (inline.type === 'bookmark') {
          const { id, kind, targetId } = inline.attrs;
          if (!id || bookmarks.has(id)) throw new Error('导出书签 ID 缺失或重复。');
          bookmarks.add(id);
          if (kind === 'knowledge') {
            if (!knowledge.has(targetId)) throw new Error('知识引用目标缺失。');
            if (!references.has(targetId)) references.set(targetId, references.size + 1);
            text += `[${references.get(targetId)}]`;
          } else if (kind === 'foreshadow') {
            const target = foreshadows.get(targetId);
            if (!target) throw new Error('伏笔引用目标缺失。');
            usedForeshadows.add(targetId);
            text += `[伏笔：${target.deletedAt ? '已删除伏笔：' : ''}${target.name}]`;
          } else throw new Error('导出书签类型无效。');
        } else throw new Error('导出正文包含不支持的节点。');
      }
      add(text);
    }
  };
  work.unvolumedChapters.forEach(addChapter);
  for (const volume of work.volumes) { add(volume.title, true); volume.chapters.forEach(addChapter); }
  if (references.size) {
    add('引用清单', true);
    for (const [id, number] of references) {
      const entry = knowledge.get(id)!;
      add(`[${number}] ${entry.deletedAt ? '已删除条目（保留历史内容）\n' : ''}${entry.body}\n出处：${readableKnowledgeSource(entry.source) || '未注明'}`);
    }
  }
  const listed = work.foreshadows.filter(item => !item.deletedAt || usedForeshadows.has(item.id));
  if (listed.length) {
    add('伏笔清单', true);
    for (const item of listed) {
      add(`${item.deletedAt ? '已删除伏笔：' : ''}${item.name}\n状态：${item.status}\n${item.description}`);
      for (const evidence of work.evidence.filter(value => value.foreshadowId === item.id && !value.deletedAt)) {
        const title = chapterMap.get(evidence.chapterId)?.title ?? evidence.originalSource.chapterTitle;
        const status = evidence.valid ? '有效' : `已失效：${evidence.invalidReason ?? '来源已变化'}`;
        add(`${evidence.kind} · ${title} · 段落：${evidence.paragraphId ?? '章节级'} · ${status}\n摘录：${evidence.excerpt}\n来源版本：${evidence.sourceRevision}`);
      }
    }
  }
  return blocks;
}

export function exportTxtManuscript(work: ExportManuscript): Buffer {
  const blocks = prepare(work);
  return Buffer.from(`${blocks.map(block => block.text).join('\n\n')}\n`.replace(/\n/g, '\r\n'), 'utf8');
}

export async function exportDocxManuscript(work: ExportManuscript): Promise<Buffer> {
  const blocks = prepare(work);
  const children = blocks.map(block => new Paragraph({
    heading: block.heading ? HeadingLevel.HEADING_1 : undefined,
    spacing: { line: 360, after: block.heading ? 160 : 80 },
    children: block.text.split('\n').map((text, index) => new TextRun({
      text, break: index ? 1 : undefined, font: { ascii: 'Microsoft YaHei', hAnsi: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei' },
      size: block.heading ? 32 : 24, bold: block.heading, color: block.heading ? '1C1C1C' : '242424',
    })),
  }));
  return Packer.toBuffer(new Document({ title: work.title, sections: [{ children }] }));
}
