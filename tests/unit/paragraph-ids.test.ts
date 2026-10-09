// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import { describe, expect, it } from 'vitest';
import { stableParagraphIds } from '../../src/renderer/lib/paragraph-ids';
import { countDocumentWords, emptyDocument, validateDocument } from '../../src/shared/document';
import { inlineBookmark, insertBookmarkAtSelection } from '../../src/renderer/components/inline-bookmark';

describe('稳定段落标识', () => {
  it.each(['knowledge', 'foreshadow'] as const)('多段正反选区的%s书签归属文档首段，文字和字数保留', kind => {
    for (const selection of [{ from: 2, to: 9 }, { from: 9, to: 2 }]) {
      const doc = emptyDocument();
      doc.content[0].content = [{ type: 'text', text: '春雨落城' }];
      doc.content.push({ type: 'paragraph', attrs: { id: crypto.randomUUID() }, content: [{ type: 'text', text: '归途有灯' }] });
      const editor = new Editor({ extensions: [Document, Paragraph, Text, HardBreak, inlineBookmark, stableParagraphIds], content: doc });
      try {
        editor.commands.setTextSelection(selection);
        const targetId = crypto.randomUUID();
        expect(insertBookmarkAtSelection(editor, kind, targetId)).toBe(true);
        const saved = validateDocument(editor.getJSON());
        expect(saved.content[0].content?.find(node => node.type === 'bookmark')).toMatchObject({ attrs: { kind, targetId } });
        expect(saved.content[1]).toEqual(doc.content[1]);
        expect(saved.content.map(paragraph => paragraph.attrs.id)).toEqual(doc.content.map(paragraph => paragraph.attrs.id));
        expect(saved.content[0].content?.filter(node => node.type === 'text').map(node => node.text).join('')).toBe('春雨落城');
        expect(countDocumentWords(saved)).toBe(8);
      } finally { editor.destroy(); }
    }
  });
  it('选择正文时在选择末尾插入书签，不覆盖原文；锁定后拒绝插入', () => {
    const doc = emptyDocument(); doc.content[0].content = [{ type: 'text', text: '春雨落城' }];
    const editor = new Editor({ extensions: [Document, Paragraph, Text, HardBreak, inlineBookmark, stableParagraphIds], content: doc });
    editor.commands.setTextSelection({ from: 2, to: 4 });
    const targetId = crypto.randomUUID();
    expect(insertBookmarkAtSelection(editor, 'knowledge', targetId)).toBe(true);
    expect(validateDocument(editor.getJSON()).content[0].content).toMatchObject([
      { type: 'text', text: '春雨落' }, { type: 'bookmark', attrs: { targetId } }, { type: 'text', text: '城' },
    ]);
    editor.setEditable(false);
    expect(insertBookmarkAtSelection(editor, 'knowledge', targetId)).toBe(false);
    editor.destroy();
  });
  it('复制书签获得新 ID，但知识关联目标保持一致', () => {
    const doc = emptyDocument();
    const bookmark = { type: 'bookmark' as const, attrs: { id: crypto.randomUUID(), kind: 'knowledge' as const, targetId: crypto.randomUUID() } };
    doc.content[0].content = [bookmark];
    const editor = new Editor({ extensions: [Document, Paragraph, Text, HardBreak, inlineBookmark, stableParagraphIds], content: doc });
    editor.commands.insertContentAt(2, bookmark);
    const copied = validateDocument(editor.getJSON()).content[0].content!;
    expect(copied).toHaveLength(2);
    expect(copied[0]).toEqual(bookmark);
    expect(copied[1]).toMatchObject({ type: 'bookmark', attrs: { targetId: bookmark.attrs.targetId } });
    expect(copied[1]).not.toEqual(bookmark);
    editor.destroy();
  });
  it('拆段保留左段标识，右段获得新标识，合并后不复用右段', () => {
    const doc = emptyDocument();
    doc.content[0].content = [{ type: 'text', text: '春雨' }];
    const editor = new Editor({ extensions: [Document, Paragraph, Text, HardBreak, stableParagraphIds], content: doc });
    editor.commands.setTextSelection(2);
    editor.commands.splitBlock();
    const split = validateDocument(editor.getJSON());
    expect(split.content[0].attrs.id).toBe(doc.content[0].attrs.id);
    expect(split.content[1].attrs.id).not.toBe(split.content[0].attrs.id);
    editor.commands.joinBackward();
    expect(validateDocument(editor.getJSON()).content).toHaveLength(1);
    expect(validateDocument(editor.getJSON()).content[0].attrs.id).toBe(doc.content[0].attrs.id);
    editor.destroy();
  });
  it('复制带原ID的段落时生成独立标识', () => {
    const doc = emptyDocument();
    doc.content[0].content = [{ type: 'text', text: '春雨' }];
    const editor = new Editor({ extensions: [Document, Paragraph, Text, HardBreak, stableParagraphIds], content: doc });
    editor.commands.insertContentAt(editor.state.doc.content.size, doc.content[0]);
    const copied = validateDocument(editor.getJSON());
    expect(copied.content).toHaveLength(2);
    expect(copied.content[0].attrs.id).not.toBe(copied.content[1].attrs.id);
    editor.destroy();
  });
});
