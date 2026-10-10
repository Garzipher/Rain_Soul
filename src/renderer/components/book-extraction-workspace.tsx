import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkDetail, DesktopApi } from '../../shared/contracts';
import type { BookExtractionApi, BookExtractionConfirmation, BookExtractionPreview } from '../../shared/book-extraction';
import { extractionCategoryPath } from '../../shared/ai-extraction';
import { StructureDialog } from './structure-dialog';
import { BookExtractionAiPanel } from './book-extraction-ai-panel';
import type { BookExtractionAiApi, BookExtractionAiSuggestion } from '../../shared/book-extraction-ai';
import type { ExtractionDraft } from '../../shared/extraction-draft';
import './book-extraction-workspace.css';

interface Annotation { technique: string; usage: string; exercise: string }
interface Review { body: string; categoryId: string; tagIds: string[]; checked: boolean; edited?: boolean; committed?: boolean; annotation: Annotation }
export function BookExtractionWorkspace({ work, api, onClose, onCommitted, onDirtyChange }: {
  work: WorkDetail; api: BookExtractionApi & BookExtractionAiApi & Pick<DesktopApi, 'fetchWebExtraction' | 'cancelWebExtraction' | 'previewPastedExtraction'> & { discardExtractionDraft?: (workId: string, token: string) => Promise<void> }; onClose: () => void; onCommitted: (work: WorkDetail) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [preview, setPreview] = useState<BookExtractionPreview | null>(null), [reviews, setReviews] = useState<Record<string, Review>>({});
  const [encoding, setEncoding] = useState<'utf-8' | 'gb18030'>('utf-8'), [sourceTitle, setSourceTitle] = useState(''), [sourceAuthor, setSourceAuthor] = useState('');
  const [permission, setPermission] = useState(false), [fileBusy, setBusy] = useState(false), [aiBusy, setAiBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [replacement, setReplacement] = useState<{ suggestion: BookExtractionAiSuggestion; revalidate: () => Promise<boolean> } | null>(null);
  const [page, setPage] = useState(0), [leaving, setLeaving] = useState(false);
  const [changingSource, setChangingSource] = useState(false);
  const [readerPage, setReaderPage] = useState(0), [sourceKind, setSourceKind] = useState<'file' | 'web' | 'paste'>('file');
  const [restoring, setRestoring] = useState(!!api.readExtractionDraft), [restoreFailed, setRestoreFailed] = useState(false);
  const busy = fileBusy || aiBusy || restoring;
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve()), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ preview, reviews }); latest.current = { preview, reviews };
  const [url, setUrl] = useState(''), [pasteTitle, setPasteTitle] = useState(''), [pasteText, setPasteText] = useState('');
  const webOperation = useRef<string | null>(null), sourceEpoch = useRef(0);
  const locked = useRef(!!api.readExtractionDraft), attempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const categories = work.assets?.categories.filter(item => !item.deletedAt) ?? [], tags = work.assets?.tags.filter(item => !item.deletedAt) ?? [];
  const chosen = preview?.segments.filter(segment => reviews[segment.id]?.checked && !reviews[segment.id]?.committed) ?? [];
  const changeAiBusy = useCallback((value: boolean) => { locked.current = value; setAiBusy(value); }, []);
  useEffect(() => { onDirtyChange?.(preview !== null || busy); }, [onDirtyChange, preview, busy]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  useEffect(() => () => { void persistReviews().catch(() => {}); }, []);
  useEffect(() => () => { sourceEpoch.current++; if (webOperation.current) void api.cancelWebExtraction?.(webOperation.current).catch(() => {}); }, [api]);
  useEffect(() => {
    let active = true;
    if (!api.readExtractionDraft) return;
    void api.readExtractionDraft(work.id).then(result => {
      if (!active || !result) return;
      acceptPreview(result.preview);
      const saved = new Map(result.draft.reviews.map(review => [review.segmentId, review]));
      setReviews(current => Object.fromEntries(Object.entries(current).map(([id, review]) => {
        const item = saved.get(id);
        return [id, item ? { ...review, body: item.body, categoryId: item.categoryId, tagIds: item.tagIds, annotation: item.annotation ?? review.annotation,
          checked: false, edited: true, committed: item.status === 'committed' } : review];
      })));
      if (result.work) onCommitted(result.work);
      setPermission(false); setMessage('已恢复本机拆书草稿；继续入库前请重新审核，AI 操作仍需再次授权。');
    }).catch(failure => { if (active) { setRestoreFailed(true); setError(failure instanceof Error ? failure.message : '草稿恢复失败，原草稿已保留。'); } })
      .finally(() => { if (active) { locked.current = false; setRestoring(false); } });
    return () => { active = false; };
    // 只在作品工作区挂载时恢复，入库导致的revision变化不覆盖作者正在编辑的草稿。
  }, [work.id]);
  function persistReviews(): Promise<unknown> {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const value = latest.current;
    if (!api.saveExtractionReview || !value.preview || restoreFailed) return Promise.resolve();
    const items: ExtractionDraft['reviews'] = Object.entries(value.reviews).filter(([, review]) => !review.committed && (review.edited || review.checked)).map(([segmentId, review]) => ({
      segmentId, body: review.body, categoryId: review.categoryId, tagIds: review.tagIds, status: review.checked ? 'approved' : 'pending', annotation: review.annotation,
    }));
    const result = saveQueue.current.catch(() => {}).then(() => api.saveExtractionReview!({ workId: work.id, token: value.preview!.token, reviews: items }));
    saveQueue.current = result; return result;
  }
  useEffect(() => {
    if (!preview || !api.saveExtractionReview || restoring || restoreFailed || fileBusy) return;
    saveTimer.current = setTimeout(() => { void persistReviews().catch(failure => setError(failure instanceof Error ? failure.message : '审核草稿保存失败，请重试。')); }, 500);
    return () => { if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; } };
  }, [reviews, preview, restoring, restoreFailed, fileBusy]);
  function update(id: string, patch: Partial<Review>) {
    setReviews(current => ({ ...current, [id]: { ...current[id], ...patch, edited: current[id].edited || patch.body !== undefined || patch.annotation !== undefined || patch.categoryId !== undefined || patch.tagIds !== undefined, checked: patch.checked ?? false } }));
  }
  function applySuggestion(suggestion: BookExtractionAiSuggestion): boolean {
    const segment = preview?.segments.find(item => item.id === suggestion.segmentId);
    if (busy || reviews[suggestion.segmentId]?.committed || !segment || !segment.text.includes(suggestion.excerpt) || !categories.some(item => item.id === suggestion.categoryId) || !suggestion.tagIds.every(id => tags.some(tag => tag.id === id))) {
      setError('AI建议来源或分类已变化，请重新分析后审核。'); return false;
    }
    const body = suggestion.excerpt, annotation = { technique: suggestion.technique, usage: suggestion.usage, exercise: suggestion.exercise };
    if (body.length > 20000 || Object.values(annotation).some(value => value.length > 20000)) { setError('AI学习内容超过单条知识容量，请缩小分析范围。'); return false; }
    update(suggestion.segmentId, { body, annotation, categoryId: suggestion.categoryId, tagIds: suggestion.tagIds });
    setPage(Math.floor(preview!.segments.findIndex(item => item.id === suggestion.segmentId) / 20));
    setMessage('AI建议已带入审核，确认内容与分类后再勾选入库。'); return true;
  }
  function acceptPreview(result: BookExtractionPreview) {
    if (result.workId !== work.id) throw new Error('素材不属于当前作品，请重新选择。');
    const categoryId = categories.find(item => item.systemKey === 'uncategorized')?.id ?? categories[0]?.id ?? '';
    setPreview(result); setReviews(Object.fromEntries(result.segments.map(segment => [segment.id, { body: segment.text, categoryId, tagIds: [], checked: false, annotation: { technique: '', usage: '', exercise: '' } }])));
    setSourceTitle(result.source?.title ?? result.filename.replace(/\.[^.]+$/, '')); setSourceAuthor(''); setPermission(false); setPage(0); setReaderPage(0); setMessage(''); attempt.current = null;
  }
  function useSuggestion(suggestion: BookExtractionAiSuggestion, revalidate: () => Promise<boolean>) {
    const review = reviews[suggestion.segmentId];
    if (busy || !review) return;
    if (review.edited || review.checked) setReplacement({ suggestion, revalidate }); else applySuggestion(suggestion);
  }
  async function choose() {
    if (locked.current || restoreFailed) return;
    locked.current = true; onDirtyChange?.(true); setBusy(true); setError('');
    try {
      const result = await api.chooseBookExtraction(work.id, encoding); if (!result) return;
      acceptPreview(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '无法读取文件，请重试。'); }
    finally { locked.current = false; setBusy(false); }
  }
  async function importSource() {
    if (locked.current || restoreFailed || preview || sourceKind === 'file') return;
    const serial = ++sourceEpoch.current;
    locked.current = true; onDirtyChange?.(true); setBusy(true); setError('');
    try {
      let result: BookExtractionPreview;
      if (sourceKind === 'web') {
        if (!api.fetchWebExtraction) throw new Error('当前版本暂不支持网页获取。');
        const operationId = crypto.randomUUID(); webOperation.current = operationId;
        result = await api.fetchWebExtraction({ workId: work.id, operationId, url: url.trim() });
      } else {
        if (!api.previewPastedExtraction) throw new Error('当前版本暂不支持粘贴预览。');
        result = await api.previewPastedExtraction({ workId: work.id, title: pasteTitle, text: pasteText });
      }
      if (serial === sourceEpoch.current) acceptPreview(result);
    } catch (failure) { if (serial === sourceEpoch.current) setError(failure instanceof Error ? failure.message : '无法读取素材，请手动重试。'); }
    finally { if (serial === sourceEpoch.current) { webOperation.current = null; locked.current = false; setBusy(false); } }
  }
  async function cancelFetch() {
    const operationId = webOperation.current;
    if (!operationId || !api.cancelWebExtraction) return;
    sourceEpoch.current++;
    try {
      await api.cancelWebExtraction(operationId);
      setMessage('获取已取消，未创建素材预览。');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '取消失败，请重试。'); }
    finally { webOperation.current = null; locked.current = false; setBusy(false); }
  }
  async function commit() {
    if (locked.current || !preview || preview.workId !== work.id || !permission || !chosen.length || chosen.length > 100 || !sourceTitle.trim()) return;
    const content = { token: preview.token, workId: work.id, expectedRevision: work.revision, sourceTitle, sourceAuthor, permissionConfirmed: true as const,
      items: chosen.map(segment => ({ segmentId: segment.id, body: reviews[segment.id].body, categoryId: reviews[segment.id].categoryId, tagIds: reviews[segment.id].tagIds, annotation: reviews[segment.id].annotation })) };
    const fingerprint = JSON.stringify(content);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, operationId: crypto.randomUUID() };
    const request: BookExtractionConfirmation = { ...content, operationId: attempt.current.operationId };
    locked.current = true; setBusy(true); setError('');
    try {
      await persistReviews();
      const result = await api.confirmBookExtraction(request);
      setReviews(current => Object.fromEntries(Object.entries(current).map(([id, review]) => [id, chosen.some(segment => segment.id === id) ? { ...review, checked: false, committed: true } : review])));
      attempt.current = null; onCommitted(result); setMessage(`已将 ${chosen.length} 条审核内容加入「${work.title}」知识库。其余素材可继续审核。`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '入库失败，审核内容已保留。'); }
    finally { locked.current = false; setBusy(false); }
  }
  async function close() {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setError('');
    try { await persistReviews(); if (preview) await api.cancelBookExtraction(preview.token); setPreview(null); onClose(); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : '无法取消，请重试。'); return false; }
    finally { locked.current = false; setBusy(false); }
  }
  async function replaceSource() {
    if (locked.current || !preview) return false;
    locked.current = true; setBusy(true); setError('');
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    try {
      await saveQueue.current.catch(() => {});
      if (api.discardExtractionDraft) await api.discardExtractionDraft(work.id, preview.token);
      else if (api.readExtractionDraft) throw new Error('当前版本未接入草稿清理，无法更换素材。');
      else await api.cancelBookExtraction(preview.token);
      latest.current = { preview: null, reviews: {} }; setPreview(null); setReviews({}); setSourceTitle(''); setSourceAuthor('');
      setPermission(false); setPage(0); setReaderPage(0); attempt.current = null; setChangingSource(false); setMessage('已清理本次拆文草稿，已入库知识保留。请选择新的素材。');
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : '无法更换素材，请重试。'); return false; }
    finally { locked.current = false; setBusy(false); }
  }
  async function checkReceipt() {
    if (locked.current || !preview || !api.readExtractionDraft) return;
    locked.current = true; setBusy(true); setError('');
    try {
      // 先保存本机编辑；冻结入库待核对时保存会拒绝，但仍必须允许查询原回执。
      await persistReviews().catch(() => {});
      const recovered = await api.readExtractionDraft(work.id);
      if (!recovered || recovered.preview.token !== preview.token) throw new Error('本机草稿与当前素材不匹配，请保留内容并重新进入工作区。');
      const committed = new Map(recovered.draft.reviews.filter(review => review.status === 'committed').map(review => [review.segmentId, review]));
      setReviews(current => Object.fromEntries(Object.entries(current).map(([id, review]) => {
        const saved = committed.get(id);
        return [id, saved ? { ...review, body: saved.body, categoryId: saved.categoryId, tagIds: saved.tagIds, annotation: saved.annotation ?? { technique: '', usage: '', exercise: '' }, checked: false, committed: true } : review];
      })));
      if (recovered.work) onCommitted(recovered.work);
      attempt.current = null; setMessage('已核对本机入库状态，未提交的手工编辑保留；本操作没有发送云端请求。');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '本机回执核对失败，原草稿和操作身份已保留。'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <section className="book-extraction" aria-label="拆书工作区" aria-busy={busy}>
    <header className="book-extraction-header"><div><h1>拆书工具</h1><p>摘选描写与写作手法，整理为「{work.title}」的写作储备。</p></div><div>{preview && <>{api.readExtractionDraft && <button disabled={busy} onClick={() => void checkReceipt()}>核对入库回执</button>} <button disabled={busy} onClick={() => setChangingSource(true)}>更换素材</button></>} <button disabled={busy} onClick={() => { if (preview) setLeaving(true); else void close(); }}>返回知识库</button></div></header>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{restoring && <p role="status">正在读取本机拆书草稿…</p>}{restoreFailed && <p role="status">原草稿已保留，本工作区不会自动覆盖；请先处理恢复错误再选择新素材。</p>}
    <fieldset className="book-extraction-import" disabled={restoring || restoreFailed}>
      <div className="book-extraction-source-tabs" role="group" aria-label="素材来源">{([['file', '本地文件'], ['web', '网页文章'], ['paste', '粘贴正文']] as const).map(([kind, label]) => <button key={kind} aria-pressed={sourceKind === kind} disabled={busy || !!preview} onClick={() => setSourceKind(kind)}>{label}</button>)}</div>
      <div className="book-extraction-toolbar">{sourceKind === 'file' ? <><label>TXT 编码<select value={encoding} disabled={busy || !!preview} onChange={event => setEncoding(event.target.value as typeof encoding)}><option value="utf-8">UTF-8</option><option value="gb18030">GB18030</option></select></label><button className="primary" disabled={busy || !!preview} onClick={() => void choose()}>选择 TXT / DOCX</button></> : sourceKind === 'web' ? <><label className="book-extraction-address">公开网页地址<input type="url" value={url} disabled={busy || !!preview} onChange={event => setUrl(event.target.value)} placeholder="https://" /></label><button className="primary" disabled={busy || !!preview || !url.trim()} onClick={() => void importSource()}>获取并预览</button>{fileBusy && webOperation.current && <button onClick={() => void cancelFetch()}>取消获取</button>}</> : <div className="book-extraction-paste"><label>素材标题<input value={pasteTitle} maxLength={200} disabled={busy || !!preview} onChange={event => setPasteTitle(event.target.value)} /></label><label>粘贴原文<textarea value={pasteText} disabled={busy || !!preview} onChange={event => setPasteText(event.target.value)} /></label><button className="primary" disabled={busy || !!preview || !pasteTitle.trim() || !pasteText.trim()} onClick={() => void importSource()}>预览粘贴内容</button></div>}</div>
    </fieldset>
    {!preview && <p className="book-extraction-empty">选择有权使用的本地作品，逐段审核内容、分类和标签后入库。DOCX 图片与表格不作为摘选内容。</p>}
    {preview && <><div className="book-extraction-source"><p>{preview.filename} · {preview.segments.length} 段 · 默认不选中任何内容</p>
      {preview.source?.finalUrl && <details><summary>网页来源记录</summary><p>原始地址：{preview.source.originalUrl}<br />最终地址：{preview.source.finalUrl}<br />获取时间：{preview.source.fetchedAt}<br />正文 SHA-256：{preview.source.bodyHash}</p></details>}
      <label>来源作品名<input aria-label="来源作品名" value={sourceTitle} maxLength={200} disabled={busy} onChange={event => setSourceTitle(event.target.value)} /></label>
      <label>来源作者<input aria-label="来源作者" value={sourceAuthor} maxLength={200} disabled={busy} onChange={event => setSourceAuthor(event.target.value)} placeholder="未知可留空" /></label>
      <label><input type="checkbox" aria-label="确认有权使用摘选内容" checked={permission} disabled={busy} onChange={event => setPermission(event.target.checked)} />我确认有权使用这些摘选内容；仅整理已审核的写作参考。</label>
      {preview.warnings.map((warning, index) => <p role="status" key={index}>{warning.message}</p>)}
    </div><div className="book-extraction-columns"><section className="book-extraction-reader" aria-label="原文阅读"><header><h2>原文阅读</h2><span>{preview.segments.length} 段</span></header><div className="book-extraction-reader-scroll">{preview.segments.slice(readerPage * 20, (readerPage + 1) * 20).map(segment => <article key={segment.id}><small>{segment.chapterTitle} · 第 {segment.paragraphIndex} 段</small><p>{segment.text}</p></article>)}</div><nav aria-label="原文分页"><button disabled={busy || !readerPage} onClick={() => setReaderPage(readerPage - 1)}>原文上一页</button><span>第 {readerPage + 1} / {Math.ceil(preview.segments.length / 20)} 页</span><button disabled={busy || (readerPage + 1) * 20 >= preview.segments.length} onClick={() => setReaderPage(readerPage + 1)}>原文下一页</button></nav></section><section className="book-extraction-review" aria-label="摘选审核"><header><h2>摘选与审核</h2><span>入库需逐段确认</span></header><div className="book-extraction-review-scroll"><div inert={fileBusy}><BookExtractionAiPanel work={work} preview={preview} api={api} permission={permission} disabled={fileBusy} onUse={useSuggestion} onBusyChange={changeAiBusy} /></div><div className="book-extraction-segments">{preview.segments.slice(page * 20, (page + 1) * 20).map((segment, index) => {
      const item = reviews[segment.id], number = page * 20 + index + 1;
      return <fieldset key={segment.id} disabled={busy || item.committed}><legend>{segment.chapterTitle} · 第 {segment.paragraphIndex} 段{item.committed ? ' · 已入库' : ''}</legend>
        <details><summary>查看原文</summary><p>{segment.text}</p></details>
        <label>摘选内容<textarea aria-label={`摘选内容 ${number}`} value={item.body} maxLength={20000} onChange={event => update(segment.id, { body: event.target.value })} /></label>
        <label>写作手法<textarea aria-label={`写作手法 ${number}`} value={item.annotation.technique} maxLength={20000} onChange={event => update(segment.id, { annotation: { ...item.annotation, technique: event.target.value } })} /></label>
        <label>适用场景<textarea aria-label={`适用场景 ${number}`} value={item.annotation.usage} maxLength={20000} onChange={event => update(segment.id, { annotation: { ...item.annotation, usage: event.target.value } })} /></label>
        <label>仿写练习<textarea aria-label={`仿写练习 ${number}`} value={item.annotation.exercise} maxLength={20000} onChange={event => update(segment.id, { annotation: { ...item.annotation, exercise: event.target.value } })} /></label>
        <label>主分类<select aria-label={`摘选分类 ${number}`} value={item.categoryId} onChange={event => update(segment.id, { categoryId: event.target.value })}>{categories.map(category => <option key={category.id} value={category.id}>{extractionCategoryPath(categories, category.id)}</option>)}</select></label>
        <div className="book-extraction-tags" role="group" aria-label={`摘选标签 ${number}`}>{tags.map(tag => <label key={tag.id}><input type="checkbox" checked={item.tagIds.includes(tag.id)} onChange={event => update(segment.id, { tagIds: event.target.checked ? [...item.tagIds, tag.id] : item.tagIds.filter(id => id !== tag.id) })} />{tag.name}</label>)}</div>
        <label><input type="checkbox" aria-label={`审核通过段落 ${number}`} disabled={!item.body.trim() || !categories.some(category => category.id === item.categoryId)} checked={item.checked} onChange={event => update(segment.id, { checked: event.target.checked })} />审核通过，加入知识库</label>
      </fieldset>;
    })}</div></div><footer className="book-extraction-footer"><button disabled={busy || page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page + 1} / {Math.ceil(preview.segments.length / 20)} 页</span><button disabled={busy || (page + 1) * 20 >= preview.segments.length} onClick={() => setPage(page + 1)}>下一页</button><button className="primary" disabled={busy || !permission || !sourceTitle.trim() || !chosen.length || chosen.length > 100} onClick={() => void commit()}>确认入库（{chosen.length}）</button></footer>{chosen.length > 100 && <p role="alert">每次最多审核 100 段，请减少选择。</p>}</section></div></>}
    {leaving && <StructureDialog busy={busy} onClose={() => setLeaving(false)} state={{ heading: api.saveExtractionReview ? '保存草稿并返回？' : '放弃本次摘选？', description: api.saveExtractionReview ? '审核草稿将先保存在本机，下次进入可继续；未审核内容不会加入知识库。' : '尚未入库的审核内容将被放弃，原有知识库保持不变。', submitLabel: api.saveExtractionReview ? '保存草稿并返回' : '放弃摘选并返回', onSubmit: close }} />}
    {replacement && <StructureDialog busy={busy} onClose={() => setReplacement(null)} state={{ heading: '替换本段审核内容？', description: '本段已有手工修改或审核。替换后保留文件原文，但本次审核内容将改为AI建议，并需要重新审核。', submitLabel: '替换并重新审核', submitTone: 'primary', onSubmit: async () => await replacement.revalidate() && applySuggestion(replacement.suggestion) }} />}
    {changingSource && <StructureDialog busy={busy} onClose={() => setChangingSource(false)} state={{ heading: '更换拆书素材？', description: '本次尚未入库的审核草稿与批次候选将被放弃，已入库知识保持不变。入库回执尚未核对时不能更换。', submitLabel: '放弃草稿并更换', onSubmit: replaceSource }} />}
  </section>;
}
