// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StructureDialog } from '../../src/renderer/components/structure-dialog';

describe('授权对话框键盘阅读', () => {
  afterEach(cleanup);
  const state = { heading: '确认云发送', submitLabel: '确认发送', onSubmit: vi.fn(async () => true) };
  it('最后按钮继续Tab可进入完整材料折叠入口，反向Tab回到最后按钮', () => {
    render(<StructureDialog state={state} busy={false} onClose={vi.fn()}>
      <details><summary>完整材料</summary><pre tabIndex={0}>测试原文</pre></details>
    </StructureDialog>);
    const submit = screen.getByRole('button', { name: '确认发送' });
    const summary = screen.getByText('完整材料');
    submit.focus(); fireEvent.keyDown(submit, { key: 'Tab' });
    expect(summary).toHaveFocus();
    fireEvent.keyDown(summary, { key: 'Tab', shiftKey: true });
    expect(submit).toHaveFocus();
  });
  it('展开内容中的滚动区域可成为首个焦点，禁用与隐藏内容不进入焦点循环', () => {
    render(<StructureDialog state={state} busy={false} onClose={vi.fn()}>
      <button disabled>禁用操作</button><div hidden><button>隐藏操作</button></div>
      <pre tabIndex={0} aria-label="发送原文">长原文</pre>
    </StructureDialog>);
    const submit = screen.getByRole('button', { name: '确认发送' });
    submit.focus(); fireEvent.keyDown(submit, { key: 'Tab' });
    expect(screen.getByLabelText('发送原文')).toHaveFocus();
  });
});
