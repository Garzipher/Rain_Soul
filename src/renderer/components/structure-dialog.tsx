import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface StructureDialogState { heading: string; description?: string; field?: string; initialValue?: string; submitLabel: string; submitTone?: 'primary' | 'danger'; onSubmit: (value: string) => Promise<boolean> }

export function StructureDialog({ state, busy, onClose, children, submitDisabled = false, role = 'dialog' }: { state: StructureDialogState; busy: boolean; onClose: () => void; children?: ReactNode; submitDisabled?: boolean; role?: 'dialog' | 'alertdialog' }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initial = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(state.initialValue ?? '');
  const submitTone = state.submitTone ?? (state.field ? 'primary' : 'danger');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    if (typeof element?.showModal === 'function') element.showModal(); else element?.setAttribute('open', '');
    if (state.field) { initial.current?.focus(); initial.current?.select(); } else cancel.current?.focus();
    return () => { element?.close?.(); if (previous?.isConnected) previous.focus(); };
  }, [state.field]);
  function key(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)') ?? []);
    const first = items[0]; const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <dialog ref={dialog} role={role} className="create-dialog" aria-labelledby="structure-heading" onKeyDown={key} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy && !submitDisabled && (!state.field || value.trim())) void state.onSubmit(value.trim()).then((success) => { if (success) onClose(); }); }}>
      <h2 id="structure-heading">{state.heading}</h2>
      {state.description && <p className="dialog-description">{state.description}</p>}
      {state.field && <><label htmlFor="structure-name">{state.field}</label><input id="structure-name" ref={initial} value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} autoComplete="off" required /></>}
      {children}
      <div className="dialog-actions"><button ref={cancel} type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button className={submitTone === 'primary' ? 'primary' : 'delete-button'} type="submit" disabled={busy || submitDisabled || (!!state.field && !value.trim())}>{busy ? '正在处理…' : state.submitLabel}</button></div>
    </form>
  </dialog>;
}
