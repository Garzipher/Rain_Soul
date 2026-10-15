import { useAnimatedDialog } from '../motion/animated-dialog';
import { useRef, useState, type KeyboardEvent } from 'react';

export interface CreateDialogProps { busy: boolean; error: string | null; onClose: () => void; onCreate: (title: string) => void }

/** 原生模态框提供焦点约束，兼容测试环境并归还触发器焦点。 */
export function CreateDialog({ busy, error, onClose, onCreate }: CreateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  useAnimatedDialog(dialogRef);
  function handleKey(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? []);
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <dialog ref={dialogRef} aria-labelledby="create-title" className="create-dialog" onKeyDown={handleKey} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (title.trim() && !busy) onCreate(title.trim()); }}>
      <h2 id="create-title">新建作品</h2>
      <label htmlFor="work-title">作品名称</label>
      <input id="work-title" ref={inputRef} value={title} onChange={(event) => setTitle(event.target.value)} required autoComplete="off" disabled={busy} />
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={!title.trim() || busy}>{busy ? '正在创建…' : '创建作品'}</button></div>
    </form>
  </dialog>;
}
