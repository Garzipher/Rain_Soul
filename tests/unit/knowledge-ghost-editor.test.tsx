// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createKnowledgeGhost, refreshKnowledgeGhost } from '../../src/renderer/lib/knowledge-ghost-extension';
import type { KnowledgeEntry } from '../../src/shared/assets';
import { auditedKnowledgeSource } from './knowledge-source-helper';

let editors: Editor[] = [];
beforeEach(() => {
  // jsdom 没有布局API；仅补浏览器几何，不伪造编辑事务和键盘行为。
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
});
afterEach(() => { editors.forEach(editor => editor.destroy()); editors = []; document.body.replaceChildren(); vi.useRealTimers(); delete (Range.prototype as unknown as Record<string, unknown>).getClientRects; delete (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect; });
const entry = (): KnowledgeEntry => ({ id: 'knowledge-1', body: '雨夜里，灯光像一枚孤独的星。', source: '原创练习', categoryId: 'category-1', tagIds: [], origin: null, revision: 1, deletedAt: null });
function setup(text = '雨夜') {
  vi.useFakeTimers();
  const element = document.createElement('div'); document.body.append(element);
  const context = { entries: [entry()], paused: false }, changed = vi.fn();
  const editor = new Editor({ element, extensions: [Document, Paragraph, Text, UndoRedo, createKnowledgeGhost(() => context)],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, onUpdate: changed });
  editors.push(editor); editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.view.dom.focus();
  editor.view.dom.dispatchEvent(new FocusEvent('focus'));
  const ghost = () => element.querySelector<HTMLElement>('[data-knowledge-ghost]');
  const key = (key: string, extra = {}) => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
  return { editor, context, changed, ghost, key };
}
it('停顿后灰字有出处，候选不改变JSON、字数或持久化回调', () => {
  const test = setup(), before = test.editor.getJSON();
  vi.advanceTimersByTime(399); expect(test.ghost()).toBeNull();
  vi.advanceTimersByTime(1); expect(test.ghost()).toHaveTextContent('里，灯光像一枚孤独的星。');
  expect(test.ghost()).toHaveAttribute('aria-label', expect.stringContaining('原创练习'));
  expect(test.editor.getJSON()).toEqual(before); expect(test.editor.getText()).toBe('雨夜'); expect(test.changed).not.toHaveBeenCalled();
});
it('出处只显示可读来源，不展开AI审计正文与原上下文', () => {
  const test = setup(); test.context.entries[0].source = auditedKnowledgeSource('写作练习').source;
  refreshKnowledgeGhost(test.editor); vi.advanceTimersByTime(400);
  expect(test.ghost()).toHaveAttribute('title', '出处：写作练习 · Tab 接受 / Esc 取消');
  expect(test.ghost()?.getAttribute('aria-label')).not.toContain('上下文独有秘词');
});
it('Tab接受一次事务，撤销恢复原文；未接受Esc不改正文且当前位置不再提示', () => {
  const test = setup(); vi.advanceTimersByTime(400); test.key('Tab');
  expect(test.editor.getText()).toBe(entry().body); expect(test.changed).toHaveBeenCalledTimes(1);
  test.editor.commands.undo(); expect(test.editor.getText()).toBe('雨夜');
  vi.advanceTimersByTime(400); expect(test.ghost()).not.toBeNull(); test.key('Escape');
  vi.advanceTimersByTime(800); expect(test.ghost()).toBeNull(); expect(test.editor.getText()).toBe('雨夜');
});
it('输入前缀后立即Tab的补全有独立撤销组，撤销保留刚输入的前缀', () => {
  const test = setup('雨'); test.editor.commands.insertContent('夜');
  vi.advanceTimersByTime(400); expect(test.ghost()).not.toBeNull(); test.key('Tab');
  expect(test.editor.getText()).toBe(entry().body); test.editor.commands.undo();
  expect(test.editor.getText()).toBe('雨夜');
});
it('没有匹配时不反复产生空装饰事务，知识刷新仍能重新匹配', () => {
  const test = setup('雪夜'), transactions = vi.fn(); test.editor.on('transaction', transactions);
  vi.advanceTimersByTime(400); const count = transactions.mock.calls.length;
  vi.advanceTimersByTime(1600); expect(transactions).toHaveBeenCalledTimes(count);
  test.context.entries[0].body = '雪夜里，故人归来。'; refreshKnowledgeGhost(test.editor);
  vi.advanceTimersByTime(400); expect(test.ghost()).not.toBeNull();
});
it('移动光标、选区、失焦以及打开AI暂停时立即清除候选', () => {
  const test = setup(); vi.advanceTimersByTime(400); expect(test.ghost()).not.toBeNull();
  test.editor.commands.setTextSelection(1); expect(test.ghost()).toBeNull(); vi.advanceTimersByTime(400); expect(test.ghost()).toBeNull();
  test.editor.commands.setTextSelection(3); vi.advanceTimersByTime(400); expect(test.ghost()).not.toBeNull();
  test.editor.commands.setTextSelection({ from: 1, to: 3 }); vi.advanceTimersByTime(400); expect(test.ghost()).toBeNull();
  test.editor.commands.setTextSelection(3); vi.advanceTimersByTime(400); test.context.paused = true; refreshKnowledgeGhost(test.editor); expect(test.ghost()).toBeNull();
  vi.advanceTimersByTime(400); expect(test.ghost()).toBeNull(); test.context.paused = false; refreshKnowledgeGhost(test.editor); vi.advanceTimersByTime(400);
  test.editor.view.dom.dispatchEvent(new FocusEvent('blur')); expect(test.ghost()).toBeNull(); vi.advanceTimersByTime(400); expect(test.ghost()).toBeNull();
});
it('IME输入期间不抢Tab，结束后重新等待；删除或改版本知识时不能采纳旧候选', () => {
  const test = setup(); vi.advanceTimersByTime(400); test.editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  expect(test.ghost()).toBeNull(); test.key('Tab', { isComposing: true }); expect(test.editor.getText()).toBe('雨夜');
  vi.advanceTimersByTime(800); expect(test.ghost()).toBeNull(); test.editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  vi.advanceTimersByTime(400); expect(test.ghost()).not.toBeNull(); test.context.entries[0].revision++; test.key('Tab'); expect(test.editor.getText()).toBe('雨夜');
  refreshKnowledgeGhost(test.editor); vi.advanceTimersByTime(400); test.context.entries[0].deletedAt = '2026-10-14'; test.key('Tab'); expect(test.editor.getText()).toBe('雨夜');
});
it('候选为纯文本，锁定和右键清除且不抢浏览器默认按键', () => {
  const test = setup(); test.context.entries[0].body = '雨夜<script>alert(1)</script>。'; refreshKnowledgeGhost(test.editor); vi.advanceTimersByTime(400);
  expect(test.ghost()?.querySelector('script')).toBeNull(); expect(test.ghost()).toHaveTextContent('<script>');
  test.editor.view.dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); expect(test.ghost()).toBeNull(); vi.advanceTimersByTime(800); expect(test.ghost()).toBeNull();
  test.editor.commands.setTextSelection(2); test.editor.commands.setTextSelection(3); vi.advanceTimersByTime(400); test.editor.setEditable(false); refreshKnowledgeGhost(test.editor);
  expect(test.ghost()).toBeNull(); expect(test.key('Tab')).toBe(true); expect(test.editor.getText()).toBe('雨夜');
});
