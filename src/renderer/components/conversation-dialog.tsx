import { useAnimatedDialog } from '../motion/animated-dialog';
import { useRef, type ReactNode } from 'react';

export function ConversationDialog({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useAnimatedDialog(dialog);
  return <dialog ref={dialog} className="conversation-confirm" aria-label={title} onCancel={event => { event.preventDefault(); onCancel(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    if (event.key !== 'Tab') return;
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)') ?? [])];
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  }}>{children}</dialog>;
}
