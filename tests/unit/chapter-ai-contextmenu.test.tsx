// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { randomUUID } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChapterEditor } from '../../src/renderer/components/chapter-editor';

afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); });
it.each([false, true])('DOM选区未同步到编辑器时右键仍冻结正确单句，反选：%s', async reverse => {
  const onAiRequest = vi.fn(), id = randomUUID();
  render(<ChapterEditor document={{ type: 'doc', content: [{ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text: '雨落。雨落。' }] }] }}
    locked={false} onChange={vi.fn()} onError={vi.fn()} onCompositionChange={vi.fn()} onAiRequest={onAiRequest} />);
  const editor = await screen.findByLabelText('章节正文');
  await waitFor(() => expect(editor).toHaveAttribute('contenteditable', 'true'));
  const text = editor.querySelector('p')!.firstChild!;
  // 不派发selectionchange，模拟浏览器已选择但文档观察器尚未读取的窗口。
  window.getSelection()!.setBaseAndExtent(text, reverse ? 6 : 3, text, reverse ? 3 : 6);
  fireEvent.contextMenu(editor, { clientX: 40, clientY: 40 });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'AI 单句润色' }));
  expect(onAiRequest).toHaveBeenCalledWith(expect.objectContaining({ paragraphIds: [id], text: '雨落。', sentenceFrom: 3, operation: 'sentencePolish' }));
});
it('编辑区外的DOM选区不能触发正文AI菜单', async () => {
  const onAiRequest = vi.fn();
  render(<><span>区外内容</span><ChapterEditor document={{ type: 'doc', content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: '雨落。' }] }] }}
    locked={false} onChange={vi.fn()} onError={vi.fn()} onCompositionChange={vi.fn()} onAiRequest={onAiRequest} /></>);
  const editor = await screen.findByLabelText('章节正文'), text = screen.getByText('区外内容').firstChild!;
  window.getSelection()!.setBaseAndExtent(text, 0, text, 4);
  fireEvent.contextMenu(editor);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(onAiRequest).not.toHaveBeenCalled();
});
