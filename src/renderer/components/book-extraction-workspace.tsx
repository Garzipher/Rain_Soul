import { useEffect, useRef, useState } from 'react';
import type { WorkDetail } from '../../shared/contracts';
import type { BookExtractionApi, BookExtractionConfirmation, BookExtractionPreview } from '../../shared/book-extraction';
import { extractionCategoryPath } from '../../shared/ai-extraction';
import { StructureDialog } from './structure-dialog';
import './book-extraction-workspace.css';

interface Review { body: string; categoryId: string; tagIds: string[]; checked: boolean }
export function BookExtractionWorkspace({ work, api, onClose, onCommitted, onDirtyChange }: {
  work: WorkDetail; api: BookExtractionApi; onClose: () => void; onCommitted: (work: WorkDetail) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [preview, setPreview] = useState<BookExtractionPreview | null>(null), [reviews, setReviews] = useState<Record<string, Review>>({});
  const [encoding, setEncoding] = useState<'utf-8' | 'gb18030'>('utf-8'), [sourceTitle, setSourceTitle] = useState(''), [sourceAuthor, setSourceAuthor] = useState('');
  const [permission, setPermission] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [page, setPage] = useState(0), [leaving, setLeaving] = useState(false);
  const locked = useRef(false), attempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const categories = work.assets?.categories.filter(item => !item.deletedAt) ?? [], tags = work.assets?.tags.filter(item => !item.deletedAt) ?? [];
  const chosen = preview?.segments.filter(segment => reviews[segment.id]?.checked) ?? [];
  useEffect(() => { onDirtyChange?.(preview !== null); }, [onDirtyChange, preview]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  function update(id: string, patch: Partial<Review>) {
    setReviews(current => ({ ...current, [id]: { ...current[id], ...patch, checked: patch.checked ?? false } }));
  }
  async function choose() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await api.chooseBookExtraction(work.id, encoding); if (!result) return;
      const categoryId = categories.find(item => item.systemKey === 'uncategorized')?.id ?? categories[0]?.id ?? '';
      setPreview(result); setReviews(Object.fromEntries(result.segments.map(segment => [segment.id, { body: segment.text, categoryId, tagIds: [], checked: false }])));
      setSourceTitle(result.filename.replace(/\.[^.]+$/, '')); setSourceAuthor(''); setPermission(false); setPage(0); setMessage(''); attempt.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : '无法读取文件，请重试。'); }
    finally { locked.current = false; setBusy(false); }
  }
  async function commit() {
    if (locked.current || !preview || preview.workId !== work.id || !permission || !chosen.length || chosen.length > 100 || !sourceTitle.trim()) return;
    const content = { token: preview.token, workId: work.id, expectedRevision: work.revision, sourceTitle, sourceAuthor, permissionConfirmed: true as const,
      items: chosen.map(segment => ({ segmentId: segment.id, body: reviews[segment.id].body, categoryId: reviews[segment.id].categoryId, tagIds: reviews[segment.id].tagIds })) };
    const fingerprint = JSON.stringify(content);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, operationId: crypto.randomUUID() };
    const request: BookExtractionConfirmation = { ...content, operationId: attempt.current.operationId };
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await api.confirmBookExtraction(request);
      onCommitted(result); setPreview(null); setReviews({}); setMessage(`已将 ${chosen.length} 条审核内容加入「${work.title}」知识库。`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '入库失败，审核内容已保留。'); }
    finally { locked.current = false; setBusy(false); }
  }
  async function close() {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setError('');
    try { if (preview) await api.cancelBookExtraction(preview.token); setPreview(null); onClose(); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : '无法取消，请重试。'); return false; }
    finally { locked.current = false; setBusy(false); }
  }
  return <section className="book-extraction" aria-label="拆书工作区" aria-busy={busy}>
    <header className="book-extraction-header"><div><h1>拆书工具</h1><p>摘选描写与写作手法，整理为「{work.title}」的写作储备。</p></div><button disabled={busy} onClick={() => { if (preview) setLeaving(true); else void close(); }}>返回知识库</button></header>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="book-extraction-toolbar"><label>TXT 编码<select value={encoding} disabled={busy || !!preview} onChange={event => setEncoding(event.target.value as typeof encoding)}><option value="utf-8">UTF-8</option><option value="gb18030">GB18030</option></select></label><button className="primary" disabled={busy || !!preview} onClick={() => void choose()}>选择 TXT / DOCX</button></div>
    {!preview && <p className="book-extraction-empty">选择有权使用的本地作品，逐段审核内容、分类和标签后入库。DOCX 图片与表格不作为摘选内容。</p>}
    {preview && <><div className="book-extraction-source"><p>{preview.filename} · {preview.segments.length} 段 · 默认不选中任何内容</p>
      <label>来源作品名<input aria-label="来源作品名" value={sourceTitle} maxLength={200} disabled={busy} onChange={event => setSourceTitle(event.target.value)} /></label>
      <label>来源作者<input aria-label="来源作者" value={sourceAuthor} maxLength={200} disabled={busy} onChange={event => setSourceAuthor(event.target.value)} placeholder="未知可留空" /></label>
      <label><input type="checkbox" aria-label="确认有权使用摘选内容" checked={permission} disabled={busy} onChange={event => setPermission(event.target.checked)} />我确认有权使用这些摘选内容；仅整理已审核的写作参考。</label>
      {preview.warnings.map((warning, index) => <p role="status" key={index}>{warning.message}</p>)}
    </div><div className="book-extraction-segments">{preview.segments.slice(page * 20, (page + 1) * 20).map((segment, index) => {
      const item = reviews[segment.id], number = page * 20 + index + 1;
      return <fieldset key={segment.id} disabled={busy}><legend>{segment.chapterTitle} · 第 {segment.paragraphIndex} 段</legend>
        <details><summary>查看原文</summary><p>{segment.text}</p></details>
        <label>摘选内容<textarea aria-label={`摘选内容 ${number}`} value={item.body} maxLength={20000} onChange={event => update(segment.id, { body: event.target.value })} /></label>
        <label>主分类<select aria-label={`摘选分类 ${number}`} value={item.categoryId} onChange={event => update(segment.id, { categoryId: event.target.value })}>{categories.map(category => <option key={category.id} value={category.id}>{extractionCategoryPath(categories, category.id)}</option>)}</select></label>
        <div className="book-extraction-tags" role="group" aria-label={`摘选标签 ${number}`}>{tags.map(tag => <label key={tag.id}><input type="checkbox" checked={item.tagIds.includes(tag.id)} onChange={event => update(segment.id, { tagIds: event.target.checked ? [...item.tagIds, tag.id] : item.tagIds.filter(id => id !== tag.id) })} />{tag.name}</label>)}</div>
        <label><input type="checkbox" aria-label={`审核通过段落 ${number}`} disabled={!item.body.trim() || !categories.some(category => category.id === item.categoryId)} checked={item.checked} onChange={event => update(segment.id, { checked: event.target.checked })} />审核通过，加入知识库</label>
      </fieldset>;
    })}</div><footer className="book-extraction-footer"><button disabled={busy || page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page + 1} / {Math.ceil(preview.segments.length / 20)} 页</span><button disabled={busy || (page + 1) * 20 >= preview.segments.length} onClick={() => setPage(page + 1)}>下一页</button><button className="primary" disabled={busy || !permission || !sourceTitle.trim() || !chosen.length || chosen.length > 100} onClick={() => void commit()}>确认入库（{chosen.length}）</button></footer>{chosen.length > 100 && <p role="alert">每次最多审核 100 段，请减少选择。</p>}</>}
    {leaving && <StructureDialog busy={busy} onClose={() => setLeaving(false)} state={{ heading: '放弃本次摘选？', description: '尚未入库的审核内容将被放弃，原有知识库保持不变。', submitLabel: '放弃摘选并返回', onSubmit: close }} />}
  </section>;
}
