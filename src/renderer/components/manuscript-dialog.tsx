import { useAnimatedDialog } from '../motion/animated-dialog';
import { SelectField } from './select-field';
import { useRef, useState } from 'react';
import type { ManuscriptDraft } from '../../shared/manuscript';
import { canMoveManuscriptChapter, normalizeManuscriptOrder } from '../lib/manuscript-order';
import './manuscript-dialog.css';

export function ManuscriptDialog({ draft, busy, error, onConfirm, onClose }: { draft: ManuscriptDraft; busy: boolean; error?: string | null; onConfirm: (draft: ManuscriptDraft) => Promise<boolean>; onClose: () => void }) {
  const [edited, setEdited] = useState(() => { const copy = structuredClone(draft); return { ...copy, chapters: normalizeManuscriptOrder(copy.chapters) }; });
  const [splitPoints, setSplitPoints] = useState<Record<number, number>>({});
  const keys = useRef(new WeakMap<string[], number>()), nextKey = useRef(0);
  function chapterKey(paragraphs: string[]) {
    if (!keys.current.has(paragraphs)) keys.current.set(paragraphs, nextKey.current++);
    return keys.current.get(paragraphs)!;
  }
  const dialog = useRef<HTMLDialogElement>(null);
  useAnimatedDialog(dialog);
  const valid = edited.title.trim() && edited.chapters.every(chapter => chapter.title.trim());
  function changeChapter(index: number, field: 'title' | 'volumeTitle', value: string) {
    if (busy) return;
    setEdited(previous => ({ ...previous, chapters: previous.chapters.map((chapter, i) => i === index ? { ...chapter, [field]: field === 'volumeTitle' && !value.trim() ? null : value } : chapter) }));
  }
  function normalizeOrder() {
    if (busy) return;
    setEdited(previous => ({ ...previous, chapters: normalizeManuscriptOrder(previous.chapters) }));
    setSplitPoints({});
  }
  function restructure(index: number, action: 'up' | 'down' | 'split' | 'merge') {
    if (busy) return;
    setEdited(previous => {
      const chapters = [...previous.chapters], chapter = chapters[index];
      if (!chapter) return previous;
      if (action === 'split') {
        const point = splitPoints[index] ?? 1;
        if (!Number.isInteger(point) || point < 1 || point >= chapter.paragraphs.length) return previous;
        chapters.splice(index, 1, { ...chapter, paragraphs: chapter.paragraphs.slice(0, point) }, { ...chapter, title: `${chapter.title.slice(0, 192)}（续）`, paragraphs: chapter.paragraphs.slice(point) });
      } else if (action === 'merge') {
        const next = chapters[index + 1];
        if (!next) return previous;
        chapters.splice(index, 2, { ...chapter, paragraphs: [...chapter.paragraphs, ...next.paragraphs] });
      } else {
        const destination = index + (action === 'up' ? -1 : 1);
        if (!canMoveManuscriptChapter(chapters, index, action === 'up' ? -1 : 1)) return previous;
        [chapters[index], chapters[destination]] = [chapters[destination], chapters[index]];
      }
      return { ...previous, chapters: normalizeManuscriptOrder(chapters) };
    });
    setSplitPoints({});
  }
  return <dialog ref={dialog} className="create-dialog manuscript-dialog" aria-labelledby="manuscript-heading" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled),select:not(:disabled),button:not(:disabled),summary') ?? []).filter(item => item.tabIndex >= 0 && !item.closest('[hidden], [inert], [aria-hidden="true"]'));
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <form onSubmit={event => { event.preventDefault(); if (!busy && valid) { const normalized = { ...edited, chapters: normalizeManuscriptOrder(edited.chapters) }; setEdited(normalized); void onConfirm(normalized).then(success => { if (success) onClose(); }); } }}>
      <h2 id="manuscript-heading">导入预览</h2><p className="dialog-description">确认后创建一部新作品，共 {edited.chapters.length} 章。可修改标题、调整章节顺序，按段落拆分或合并相邻章节；原文件保留。</p>
      <p className="import-structure-hint">无分卷章节在前，同名分卷聚合；分卷按首次出现排序，仅可在同一分卷内上下移动。卷名编辑完成后自动重排，以下顺序即导入顺序。</p>
      {error && <p role="alert" className="page-error">{error}</p>}
      {edited.warnings.map(warning => <p className="import-warning" key={warning.code}>{warning.message}<span> · {warning.count} 项</span></p>)}
      <label htmlFor="import-title">导入作品名称</label><input id="import-title" value={edited.title} maxLength={200} disabled={busy} onChange={event => setEdited(previous => ({ ...previous, title: event.target.value }))} />
      <div className="import-chapters">{edited.chapters.map((chapter, index) => <section className="import-chapter" key={chapterKey(chapter.paragraphs)}>
        <label>导入章节 {index + 1} 标题<input value={chapter.title} maxLength={200} disabled={busy} onChange={event => changeChapter(index, 'title', event.target.value)} /></label>
        <label>分卷（可选）<input aria-label={`导入章节 ${index + 1} 分卷`} value={chapter.volumeTitle ?? ''} maxLength={200} disabled={busy} onChange={event => changeChapter(index, 'volumeTitle', event.target.value)} onBlur={normalizeOrder} /></label>
        <div className="import-structure-actions"><button className="secondary" type="button" aria-label={`上移第 ${index + 1} 章`} disabled={busy || !canMoveManuscriptChapter(edited.chapters, index, -1)} onClick={() => restructure(index, 'up')}>上移</button><button className="secondary" type="button" aria-label={`下移第 ${index + 1} 章`} disabled={busy || !canMoveManuscriptChapter(edited.chapters, index, 1)} onClick={() => restructure(index, 'down')}>下移</button><button className="secondary" type="button" aria-label={`第 ${index + 1} 章合并下一章`} disabled={busy || index === edited.chapters.length - 1} onClick={() => restructure(index, 'merge')}>合并下一章</button></div>
        {index < edited.chapters.length - 1 && <p className="import-structure-hint">合并会保留本章标题和分卷，下一章正文完整接在本章后。</p>}
        <div className="import-split"><label>拆章位置<SelectField aria-label={`第 ${index + 1} 章拆章位置`} value={splitPoints[index] ?? 1} disabled={busy || chapter.paragraphs.length < 2} onChange={event => { if (!busy) setSplitPoints(previous => ({ ...previous, [index]: Number(event.target.value) })); }}>{chapter.paragraphs.length < 2 ? <option value="1">不足两段，无法拆分</option> : chapter.paragraphs.slice(0, -1).map((_text, i) => <option value={i + 1} key={i}>第 {i + 1} 段之后 · 下一段：{chapter.paragraphs[i + 1].slice(0, 35) || '空段落'}</option>)}</SelectField></label><button className="secondary" type="button" aria-label={`拆分第 ${index + 1} 章`} disabled={busy || chapter.paragraphs.length < 2} onClick={() => restructure(index, 'split')}>拆为两章</button></div>
        <details><summary>正文预览 · {chapter.paragraphs.length} 段</summary>{chapter.paragraphs.map((text, i) => <p key={i}>{text || '　'}</p>)}</details>
      </section>)}</div>
      <div className="dialog-actions"><button className="secondary" type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !valid}>{busy ? '正在导入…' : '创建新作品'}</button></div>
    </form>
  </dialog>;
}
