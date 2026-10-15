import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

/** CSS 网格保留退出节点；先迁移焦点，再让收起内容退出键盘顺序。 */
export function AnimatedCollapse({ open, triggerRef, children, className = '' }: { open: boolean; triggerRef?: RefObject<HTMLElement | null>; children: ReactNode; className?: string }) {
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open && content.current?.contains(document.activeElement)) triggerRef?.current?.focus();
  }, [open, triggerRef]);
  return <div className={`motion-collapse ${open ? 'is-open' : ''} ${className}`} aria-hidden={!open} inert={!open}>
    <div ref={content} className="motion-collapse-content">{children}</div>
  </div>;
}
