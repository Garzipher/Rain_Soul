import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { usePresence } from 'motion/react';
import { useMotionPreference } from './motion-provider';
import { motionTokens } from './tokens';

/** 原生 top layer 负责焦点约束，presence 仅延迟视觉卸载，不延迟业务关闭。 */
export function useAnimatedDialog(ref: RefObject<HTMLDialogElement | null>, open = true, restoreFocusTo?: () => HTMLElement | null) {
  const [present, remove] = usePresence();
  const { reduced } = useMotionPreference();
  const previous = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const restore = useRef(restoreFocusTo);
  restore.current = restoreFocusTo;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const current = ++generation.current;
    const visible = open && present;
    const returnFocus = () => {
      const target = restore.current?.() ?? previous.current;
      if (target?.isConnected && !target.closest('[inert], [hidden]')) target.focus();
      else document.querySelector<HTMLElement>('.sidebar-toggle, main button, [role="main"] button')?.focus();
    };
    const close = () => {
      if (generation.current !== current) return;
      node.close?.(); node.removeAttribute('open');
      returnFocus();
      if (!present) remove?.();
    };
    if (visible) {
      if (!node.open) {
        previous.current = document.activeElement as HTMLElement | null;
        if (typeof node.showModal === 'function') node.showModal(); else node.setAttribute('open', '');
      }
      node.inert = false; node.dataset.motion = 'enter';
      node.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex="0"]')?.focus();
      return () => { ++generation.current; };
    }
    node.inert = true; node.dataset.motion = 'exit';
    if (reduced || !node.open) { close(); return; }
    const finish = (event: AnimationEvent) => { if (event.target === node && event.animationName === 'rainsoul-dialog-out') close(); };
    node.addEventListener('animationend', finish);
    // 后台节流、关键帧被覆盖时仍能关闭，不仅依赖 animationend。
    const timer = window.setTimeout(close, motionTokens.dialogExit + 64);
    return () => { ++generation.current; clearTimeout(timer); node.removeEventListener('animationend', finish); };
  }, [open, present, reduced, ref, remove]);
  useLayoutEffect(() => () => {
    const node = ref.current;
    ++generation.current; node?.close?.();
    if (previous.current?.isConnected) previous.current.focus();
  }, [ref]);
}

export function AnimatedDialog({ open, label, onRequestClose, restoreFocusTo, children }: { open: boolean; label: string; onRequestClose: () => void; restoreFocusTo?: () => HTMLElement | null; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useAnimatedDialog(ref, open, restoreFocusTo);
  return <dialog ref={ref} aria-label={label} onCancel={event => { event.preventDefault(); onRequestClose(); }}>{children}</dialog>;
}
