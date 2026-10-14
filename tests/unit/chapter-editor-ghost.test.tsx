// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChapterEditor } from '../../src/renderer/components/chapter-editor';
import type { AssetState } from '../../src/shared/assets';
import type { WritingDocument } from '../../src/shared/contracts';
import type { Editor } from '@tiptap/core';

const documentValue: WritingDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: '00000000-0000-4000-8000-000000000001' }, content: [{ type: 'text', text: '雨夜' }] }] };
const assets: AssetState = { outlines: [], foreshadows: [], evidence: [], categories: [], tags: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null,
  knowledge: [{ id: '00000000-0000-4000-8000-000000000002', body: '雨夜里，灯光像一枚孤独的星。', source: '原创练习', categoryId: '00000000-0000-4000-8000-000000000003', tagIds: [], origin: null, revision: 1, deletedAt: null }] };
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); delete (Range.prototype as unknown as Record<string, unknown>).getClientRects; delete (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect; });

it('接入作品知识，显示出处且候选不调用保存；暂停AI后不能再提示或接受', async () => {
  const onChange = vi.fn(), view = render(<ChapterEditor document={documentValue} assets={assets} locked={false} onChange={onChange} onError={vi.fn()} onCompositionChange={vi.fn()} />);
  const editor = screen.getByRole('textbox', { name: '章节正文' });
  act(() => { (editor as HTMLElement & { editor: Editor }).editor.commands.setTextSelection(3); fireEvent.focus(editor); });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  const ghost = screen.getByText('里，灯光像一枚孤独的星。').closest('[data-knowledge-ghost]');
  expect(ghost).toHaveAttribute('title', expect.stringContaining('原创练习'));
  expect(onChange).not.toHaveBeenCalled();
  view.rerender(<ChapterEditor document={documentValue} assets={assets} locked={false} ghostPaused onChange={onChange} onError={vi.fn()} onCompositionChange={vi.fn()} />);
  expect(screen.queryByText('里，灯光像一枚孤独的星。')).toBeNull();
  fireEvent.keyDown(editor, { key: 'Tab' });
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(screen.queryByText('里，灯光像一枚孤独的星。')).toBeNull();
  const updated = structuredClone(assets); updated.knowledge[0].body = '雨夜里，风吹过旧站台。'; updated.knowledge[0].revision++;
  view.rerender(<ChapterEditor document={documentValue} assets={updated} locked={false} onChange={onChange} onError={vi.fn()} onCompositionChange={vi.fn()} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(screen.queryByText('里，灯光像一枚孤独的星。')).toBeNull();
  expect(screen.getByText('里，风吹过旧站台。')).toBeInTheDocument();
  fireEvent.keyDown(editor, { key: 'Tab' });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ content: [expect.objectContaining({ content: [{ type: 'text', text: '雨夜里，风吹过旧站台。' }] })] }));
});
