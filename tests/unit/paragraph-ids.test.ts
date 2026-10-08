// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import { describe, expect, it } from 'vitest';
import { stableParagraphIds } from '../../src/renderer/lib/paragraph-ids';
import { emptyDocument, validateDocument } from '../../src/shared/document';

describe('稳定段落标识', () => {
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
