import { useEffect } from 'react';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import type { WritingDocument } from '../../shared/contracts';
import { validateDocument } from '../../shared/document';
import { stableParagraphIds } from '../lib/paragraph-ids';

export interface ChapterEditorProps { document: WritingDocument; locked: boolean; onChange: (document: WritingDocument) => void; onError: (error: string) => void; onCompositionChange: (value: boolean) => void }

/** 固定样式正文只保存段落、文本和换行；不导入外部 HTML 样式。 */
export function ChapterEditor({ document, locked, onChange, onError, onCompositionChange }: ChapterEditorProps) {
  const editor = useEditor({
    extensions: [Document, Paragraph, Text, HardBreak, stableParagraphIds, UndoRedo],
    content: document,
    editable: !locked,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': '章节正文', 'aria-multiline': 'true', class: 'writing-body', spellcheck: 'false' },
      handleDOMEvents: {
        compositionstart: () => { onCompositionChange(true); return false; },
        compositionend: () => { onCompositionChange(false); return false; },
      },
      handlePaste: (view, event) => {
        const plain = event.clipboardData?.getData('text/plain');
        if (plain === undefined) return false;
        event.preventDefault();
        const text = plain.replace(/\r\n?/g, '\n');
        const parsed = text.split('\n').map((line) => view.state.schema.nodes.paragraph.create(null, line ? view.state.schema.text(line) : undefined));
        const slice = view.state.schema.nodes.doc.create(null, parsed).slice(0);
        view.dispatch(view.state.tr.replaceSelection(slice));
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      try { onChange(validateDocument(current.getJSON())); }
      catch (error) { onError(error instanceof Error ? error.message : '正文结构无法保存，请保留内容并联系开发者'); }
    },
  });
  useEffect(() => { editor?.setEditable(!locked, false); }, [editor, locked]);
  return <EditorContent editor={editor} />;
}
