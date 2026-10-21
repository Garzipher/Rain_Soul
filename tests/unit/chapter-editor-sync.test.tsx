// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { ChapterEditor } from '../../src/renderer/components/chapter-editor';
import type { WritingDocument } from '../../src/shared/contracts';

afterEach(cleanup);
const paragraphId = '00000000-0000-4000-8000-000000000001';
function manuscript(text: string): WritingDocument {
  return { type: 'doc', content: [{ type: 'paragraph', attrs: { id: paragraphId }, content: [{ type: 'text', text }] }] };
}
function editorInstance() { return (screen.getByRole('textbox', { name: '章节正文' }) as HTMLElement & { editor: Editor }).editor; }

it('同章采用外部正文立即更新可见编辑器，继续输入不会恢复旧文', async () => {
  const onChange = vi.fn(), onError = vi.fn();
  const props = { document: manuscript('雨已经停了，候船室里先亮起了一点光。'), locked: false, onChange, onError, onCompositionChange: vi.fn() };
  const view = render(<ChapterEditor {...props} />);
  const editor = editorInstance();
  const adopted = manuscript('雨停了，候船室先亮起一点光。');
  view.rerender(<ChapterEditor {...props} document={adopted} />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: '章节正文' })).toHaveTextContent('雨停了，候船室先亮起一点光。'));
  expect(onChange).not.toHaveBeenCalled();
  act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, '她听见水声。'); });
  expect(onChange).toHaveBeenLastCalledWith(manuscript('雨停了，候船室先亮起一点光。她听见水声。'));
  expect(onError).not.toHaveBeenCalled();
});

it('保存回执的同内容副本不重置编辑器、选区和已有撤销历史', () => {
  const onChange = vi.fn();
  const props = { document: manuscript('雨落。'), locked: false, onChange, onError: vi.fn(), onCompositionChange: vi.fn() };
  const view = render(<ChapterEditor {...props} />);
  const editor = editorInstance();
  act(() => { editor.commands.insertContentAt(4, '灯亮。'); });
  const typed = onChange.mock.calls.at(-1)![0] as WritingDocument;
  const selection = editor.state.selection;
  onChange.mockClear();
  view.rerender(<ChapterEditor {...props} document={structuredClone(typed)} />);
  expect(editorInstance()).toBe(editor);
  expect(editor.state.selection.eq(selection)).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
  act(() => { editor.commands.undo(); });
  expect(editor.getText()).toBe('雨落。');
});

it('外部正文变短后原选区仍落在可输入的段落内', () => {
  const props = { document: manuscript('候船室亮起了一点灯光。'), locked: false, onChange: vi.fn(), onError: vi.fn(), onCompositionChange: vi.fn() };
  const view = render(<ChapterEditor {...props} />);
  const editor = editorInstance();
  act(() => { editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 }); });
  view.rerender(<ChapterEditor {...props} document={manuscript('灯亮。')} />);
  expect(editor.state.selection.$from.parent.inlineContent).toBe(true);
  expect(editor.state.selection.$to.parent.inlineContent).toBe(true);
  expect(props.onError).not.toHaveBeenCalled();
});

it('采用外部正文后只撤销后续输入，不退回采用前的句子', () => {
  const props = { document: manuscript('雨落。'), locked: false, onChange: vi.fn(), onError: vi.fn(), onCompositionChange: vi.fn() };
  const view = render(<ChapterEditor {...props} />);
  const editor = editorInstance();
  act(() => { editor.commands.insertContentAt(4, '旧稿。'); });
  view.rerender(<ChapterEditor {...props} document={manuscript('雨停了。')} />);
  act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, '灯亮。'); });
  act(() => { editor.commands.undo(); });
  expect(editor.getText()).toBe('雨停了。');
});
