import { useEffect, useRef, type KeyboardEvent } from 'react';
import { usePresence } from 'motion/react';
import { useMotionPreference } from '../motion/motion-provider';
import { motionTokens } from '../motion/tokens';

export interface MenuItem { label: string; action: () => void; disabled?: boolean; danger?: boolean }
export interface MenuState { x: number; y: number; trigger: HTMLElement; items: MenuItem[] }

function restoreTriggerFocus(trigger: HTMLElement) {
  // 菜单动作可能已经打开模态框，退出动画与旧监听清理不能抢走其焦点。
  if (trigger.isConnected && !document.activeElement?.closest('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')) trigger.focus();
}

/** 鼠标和键盘共用菜单；选择动作前关闭菜单并归还触发器焦点。 */
export function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [present, remove] = usePresence();
  const { reduced } = useMotionPreference();
  useEffect(() => {
    if (present) return;
    restoreTriggerFocus(state.trigger);
    if (reduced) { remove?.(); return; }
    const timer = window.setTimeout(() => remove?.(), motionTokens.menuExit + 32);
    return () => clearTimeout(timer);
  }, [present, reduced, remove, state.trigger]);
  useEffect(() => {
    if (!present) return;
    const element = menu.current;
    if (element) {
      element.style.left = `${Math.max(8, Math.min(state.x, window.innerWidth - element.offsetWidth - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(state.y, window.innerHeight - element.offsetHeight - 8))}px`;
      element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    function outside(event: PointerEvent) { if (!element?.contains(event.target as Node)) onClose(); }
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', onClose); restoreTriggerFocus(state.trigger); };
  }, [state, onClose, present]);
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); return; }
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const target = { ArrowDown: (index + 1) % items.length, ArrowUp: (index - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
    if (target !== undefined) { event.preventDefault(); items[target]?.focus(); }
  }
  return <div ref={menu} className="context-menu" data-motion={present ? 'enter' : 'exit'} inert={!present} aria-hidden={!present} role="menu" aria-label="结构操作" style={{ left: state.x, top: state.y }} onKeyDown={key}>
    {state.items.map((item, index) => <button role="menuitem" key={`${index}:${item.label}`} disabled={item.disabled} className={item.danger ? 'danger' : ''} onClick={() => { onClose(); if (state.trigger.isConnected) state.trigger.focus(); item.action(); }}>{item.label}</button>)}
  </div>;
}
