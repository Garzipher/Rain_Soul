import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionProvider, useMotionPreference } from '../../src/renderer/motion/motion-provider';

afterEach(() => vi.unstubAllGlobals());
describe('统一动态效果偏好', () => {
  it('监听运行时变化并在卸载时清理订阅', () => {
    let listener: (() => void) | undefined;
    const media = { matches: false, addEventListener: vi.fn((_name, callback) => { listener = callback; }), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => media);
    function Value() { return <span>{String(useMotionPreference().reduced)}</span>; }
    const view = render(<MotionProvider><Value /></MotionProvider>);
    expect(screen.getByText('false')).toBeDefined();
    act(() => { media.matches = true; listener?.(); });
    expect(screen.getByText('true')).toBeDefined();
    view.unmount(); expect(media.removeEventListener).toHaveBeenCalled();
  });
  it('禁用控件不触发业务成功反馈', () => {
    const action = vi.fn();
    render(<button disabled onClick={action}>保存知识</button>);
    fireEvent.click(screen.getByText('保存知识'));
    expect(action).not.toHaveBeenCalled();
  });
});
