// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConversationDialog } from '../../src/renderer/components/conversation-dialog';

afterEach(cleanup);
it('模态只在可用控件间循环焦点，并恢复调用入口焦点', () => {
  const cancel = vi.fn();
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const view = render(<ConversationDialog title="确认测试" onCancel={cancel}><button>第一项</button><button disabled>不可用</button><button>最后项</button></ConversationDialog>);
  const dialog = screen.getByRole('dialog'), first = screen.getByRole('button', { name: '第一项' }), last = screen.getByRole('button', { name: '最后项' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Tab' }); expect(first).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'ArrowLeft' }); expect(cancel).not.toHaveBeenCalled();
  fireEvent.keyDown(dialog, { key: 'Escape' }); expect(cancel).toHaveBeenCalledOnce();
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true })); expect(cancel).toHaveBeenCalledTimes(2);
  view.unmount(); expect(trigger).toHaveFocus(); trigger.remove();
});
it('原生showModal可用时调用，脱离文档的旧入口不再抢焦点', () => {
  const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  const old = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
  try {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const view = render(<ConversationDialog title="原生模态" onCancel={vi.fn()}><button>唯一项</button></ConversationDialog>);
    expect(showModal).toHaveBeenCalledOnce(); trigger.remove(); view.unmount();
  } finally {
    if (old) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', old); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  }
});
