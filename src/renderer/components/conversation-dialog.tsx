import { useEffect, useRef, type ReactNode } from 'react';

export function ConversationDialog({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, node = dialog.current;
    if (typeof node?.showModal === 'function') node.showModal(); else node?.setAttribute('open', '');
    node?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => { node?.close?.(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="conversation-confirm" aria-label={title} onCancel={event => { event.preventDefault(); onCancel(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    if (event.key !== 'Tab') return;
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)') ?? [])];
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  }}>{children}</dialog>;
}
