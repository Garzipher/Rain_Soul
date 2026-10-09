import { useEffect, useRef, type ReactNode } from 'react';
import './workspace-tool-dialog.css';

/** 工具按需打开；关闭只隐藏内容，AI 候选保留在本次作品会话中。 */
export function WorkspaceToolDialog({ title, open, busy, onClose, children }: { title: string; open: boolean; busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!open) { element?.close?.(); element?.removeAttribute('open'); return; }
    const previous = document.activeElement as HTMLElement | null;
    if (typeof element?.showModal === 'function') element.showModal(); else element?.setAttribute('open', '');
    close.current?.focus();
    return () => { element?.close?.(); if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return <dialog ref={dialog} className="workspace-tool-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onKeyDown={event => {
    if ((event.target as Element).closest('dialog') !== dialog.current) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary') ?? []);
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  }}>
    <div className="workspace-tool-header"><span>{title}</span><button ref={close} type="button" className="secondary" disabled={busy} aria-label={`关闭${title}`} onClick={onClose}>关闭</button></div>
    {children}
  </dialog>;
}
