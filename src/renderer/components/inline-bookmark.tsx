import { useEffect, useRef } from 'react';
import { Node, type Editor } from '@tiptap/core';
import type { AssetState } from '../../shared/assets';
import type { BookmarkNode, Chapter } from '../../shared/contracts';
import { readableKnowledgeSource } from '../../shared/knowledge-source';
import { getEvidenceStatus, summarizeForeshadowEvidence } from '../../shared/evidence-status';
import './inline-bookmark.css';

/** 行内只保存关联 ID；内容、状态和出处始终读取当前作品资产。 */
export const inlineBookmark = Node.create({
  name: 'bookmark', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() { return { id: { default: null }, kind: { default: null }, targetId: { default: null } }; },
  parseHTML() { return []; },
  renderHTML({ node }) {
    return ['button', { type: 'button', contenteditable: 'false', class: 'inline-bookmark',
      'data-bookmark-id': node.attrs.id, 'data-bookmark-kind': node.attrs.kind, 'data-bookmark-target': node.attrs.targetId }, '书签'];
  },
});
export function insertBookmarkAtSelection(editor: Editor, kind: BookmarkNode['attrs']['kind'], targetId: string): boolean {
  if (!editor.isEditable || !targetId) return false;
  const { $from, $to, from, to } = editor.state.selection;
  // 选区已按文档顺序归一；跨段插入首段，单段仍在末尾，不替换所选正文。
  const position = $from.sameParent($to) ? to : from;
  return editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(position)
    .insertContent({ type: 'bookmark', attrs: { id: crypto.randomUUID(), kind, targetId } }).run();
}
export function bookmarkInfo(bookmark: BookmarkNode['attrs'], assets?: AssetState, chapters?: Chapter[]) {
  if (bookmark.kind === 'knowledge') {
    const entry = assets?.knowledge.find(item => item.id === bookmark.targetId);
    return { label: entry && !entry.deletedAt ? `知识书签：${entry.body.slice(0, 20)}` : '知识书签：已删除条目',
      title: entry && !entry.deletedAt ? '知识引用' : '已删除条目', body: entry?.body ?? '原条目已不存在，关联 ID 仍保留。', source: readableKnowledgeSource(entry?.source ?? '') || '未注明出处', status: entry?.deletedAt ? '已删除条目，保留历史内容供追溯。' : '', needsReview: false };
  }
  const item = assets?.foreshadows.find(value => value.id === bookmark.targetId);
  const work = { chapters: chapters ?? [], assets };
  const summary = item && !item.deletedAt && chapters ? summarizeForeshadowEvidence(work, item) : null;
  const needsReview = !!summary && (summary.invalid.length > 0 || summary.missing.length > 0);
  const reasons = summary ? [...new Set(summary.invalid.map(evidence => getEvidenceStatus(work, evidence).reason).filter(Boolean)), ...(summary.missing.length ? [`缺少有效${summary.missing.join('、')}证据`] : [])] : [];
  return { label: item && !item.deletedAt ? `伏笔书签：${item.name}${needsReview ? ' · 证据需复核' : ''}` : '伏笔书签：已删除伏笔', title: item && !item.deletedAt ? item.name : '已删除伏笔', body: item?.description ?? '原伏笔已不存在，关联 ID 仍保留。', source: '', status: item && !item.deletedAt ? `${item.status}${needsReview ? ` · 证据需复核：${reasons.join('；')}` : ''}` : '已删除伏笔', needsReview };
}
export function BookmarkDetails({ bookmark, assets, chapters, onClose, onLocateAsset, locked }: { bookmark: BookmarkNode['attrs']; assets?: AssetState; chapters?: Chapter[]; onClose: () => void; onLocateAsset?: (kind: BookmarkNode['attrs']['kind'], id: string) => void; locked?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null);
  const info = bookmarkInfo(bookmark, assets, chapters);
  const target = bookmark.kind === 'knowledge' ? assets?.knowledge.find(item => item.id === bookmark.targetId) : assets?.foreshadows.find(item => item.id === bookmark.targetId);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, element = dialog.current;
    if (typeof element?.showModal === 'function') element.showModal(); else element?.setAttribute('open', '');
    close.current?.focus();
    return () => { element?.close?.(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="create-dialog bookmark-details" aria-labelledby="bookmark-title" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } if (event.key === 'Tab') { event.preventDefault(); const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []); const index = buttons.indexOf(window.document.activeElement as HTMLButtonElement); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus(); } }}>
    <h2 id="bookmark-title">{info.title}</h2><p className="bookmark-fulltext">{info.body}</p>{info.source && <p>出处：{info.source}</p>}{info.status && <p>{info.status}</p>}<p className="bookmark-target">关联 ID：{bookmark.targetId}</p>
    <div className="dialog-actions">{onLocateAsset && <button className="secondary" disabled={locked || !target || !!target.deletedAt} onClick={() => { if (target && !target.deletedAt && !locked) { onClose(); onLocateAsset(bookmark.kind, bookmark.targetId); } }}>{bookmark.kind === 'knowledge' ? '定位知识条目' : '定位伏笔架构'}</button>}<button ref={close} className="secondary" onClick={onClose}>关闭书签详情</button></div>
  </dialog>;
}
