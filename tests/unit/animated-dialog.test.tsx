import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimatePresence } from 'motion/react';
import { AnimatedDialog } from '../../src/renderer/motion/animated-dialog';

afterEach(() => { vi.useRealTimers(); });
describe('弹窗退出生命周期', () => {
  it('关闭业务立即执行，退出节点暂时保留', () => {
    vi.useFakeTimers(); const close = vi.fn();
    const view = render(<AnimatePresence><AnimatedDialog open label="测试弹窗" onRequestClose={close}><button>取消</button></AnimatedDialog></AnimatePresence>);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
    view.rerender(<AnimatePresence>{null}</AnimatePresence>);
    expect(document.querySelector('dialog')).not.toBeNull();
    act(() => { vi.runAllTimers(); });
  });
  it('快速重新打开时旧退出回调不能关闭新弹窗', () => {
    vi.useFakeTimers(); const close = vi.fn();
    const draw = (open: boolean) => <AnimatedDialog open={open} label="重开弹窗" onRequestClose={close}><button>关闭</button></AnimatedDialog>;
    const view = render(draw(true)); view.rerender(draw(false)); view.rerender(draw(true));
    act(() => { vi.runAllTimers(); });
    expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  });
});
