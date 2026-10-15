// @vitest-environment jsdom
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnimatedCollapse } from '../../src/renderer/motion/animated-collapse';

describe('折叠区域焦点', () => {
  it('收起前归还焦点并隔离隐藏区域', () => {
    const trigger = createRef<HTMLButtonElement>();
    const draw = (open: boolean) => <><button ref={trigger}>展开</button><AnimatedCollapse open={open} triggerRef={trigger}><button>内部操作</button></AnimatedCollapse></>;
    const view = render(draw(true)); screen.getByText('内部操作').focus(); view.rerender(draw(false));
    expect(document.activeElement).toBe(trigger.current);
    expect(screen.getByText('内部操作').closest('[inert]')).not.toBeNull();
  });
});
