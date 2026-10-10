import { useEffect, useRef, useState } from 'react';
import type { AiPreparedRequest } from '../../shared/ai';
import type { WorkDetail } from '../../shared/contracts';
import type { BookExtractionPreview } from '../../shared/book-extraction';
import type { BookExtractionAiApi, BookExtractionAiResult, BookExtractionAiSuggestion } from '../../shared/book-extraction-ai';
import { extractionCategoryPath } from '../../shared/ai-extraction';
import { StructureDialog } from './structure-dialog';
import './book-extraction-ai-panel.css';

export interface BookExtractionAiPanelProps {
  work: WorkDetail; preview: BookExtractionPreview; api: BookExtractionAiApi; permission: boolean;
  onUse: (suggestion: BookExtractionAiSuggestion) => void; onBusyChange: (busy: boolean) => void;
}
export function BookExtractionAiPanel(props: BookExtractionAiPanelProps) {
  return <BookExtractionAiPanelContent key={`${props.work.id}:${props.preview.token}`} {...props} />;
}
function BookExtractionAiPanelContent({ work, preview, api, permission, onUse, onBusyChange }: BookExtractionAiPanelProps) {
  const [selected, setSelected] = useState<string[]>([]), [page, setPage] = useState(0);
  const [prepared, setPrepared] = useState<AiPreparedRequest | null>(null), [result, setResult] = useState<BookExtractionAiResult | null>(null);
  const [rawResult, setRawResult] = useState<BookExtractionAiResult | null>(null), [notice, setNotice] = useState('');
  const [status, setStatus] = useState<'idle' | 'preparing' | 'prepared' | 'sending' | 'unknown' | 'checking' | 'cancelling'>('idle'), [error, setError] = useState('');
  const phase = useRef(status), tokens = useRef(new Set<string>()), alive = useRef(true), epoch = useRef(0);
  const active = useRef<AiPreparedRequest | null>(null), allowed = useRef(permission); allowed.current = permission;
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const busy = status !== 'idle';
  const categories = work.assets?.categories.filter(item => !item.deletedAt) ?? [], tags = work.assets?.tags.filter(item => !item.deletedAt) ?? [];
  function changeStatus(value: typeof status) { phase.current = value; busyCallback.current(value !== 'idle'); setStatus(value); }
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; epoch.current++; for (const token of tokens.current) void api.cancelBookExtractionAi(token).catch(() => undefined); busyCallback.current(false); };
  }, [api]);
  useEffect(() => { if (!permission && active.current && phase.current !== 'idle') void cancel(); }, [permission]);
  function accept(value: BookExtractionAiResult, request: AiPreparedRequest) {
    if (value.workId !== work.id || value.previewToken !== preview.token || value.requestHash !== request.requestHash) throw new Error('推荐回执不匹配本次原文，请核对本机结果。');
    if (value.validationError) setRawResult(value);
    else { setResult(value); setRawResult(null); }
    active.current = null; setError(''); setNotice(''); changeStatus('idle');
  }
  async function prepare() {
    if (phase.current !== 'idle' || !permission || preview.workId !== work.id || !selected.length || selected.length > 20) return;
    const serial = ++epoch.current; changeStatus('preparing'); setError(''); setNotice('');
    try {
      const value = await api.prepareBookExtractionAi({ workId: work.id, token: preview.token, segmentIds: preview.segments.filter(segment => selected.includes(segment.id)).map(segment => segment.id), permissionConfirmed: true });
      if (!alive.current || serial !== epoch.current || !allowed.current) {
        await api.cancelBookExtractionAi(value.confirmationToken);
        if (alive.current && serial === epoch.current) changeStatus('idle');
        return;
      }
      tokens.current.add(value.confirmationToken); active.current = value; setPrepared(value); changeStatus('prepared');
    } catch (failure) { if (alive.current && serial === epoch.current) { setError(failure instanceof Error ? failure.message : '无法准备 AI 推荐。'); changeStatus('idle'); } }
  }
  async function cancel() {
    const request = active.current;
    if (!request || phase.current === 'cancelling' || phase.current === 'idle') return;
    const wasPrepared = phase.current === 'prepared', serial = ++epoch.current; changeStatus('cancelling');
    try {
      await api.cancelBookExtractionAi(request.confirmationToken);
      if (!alive.current || serial !== epoch.current) return;
      tokens.current.delete(request.confirmationToken); active.current = null; setPrepared(null); setError(''); setNotice('已取消本次 AI 请求，已有成功推荐已保留。'); changeStatus('idle');
    } catch (failure) {
      if (alive.current && serial === epoch.current) { setError(failure instanceof Error ? failure.message : '取消失败，请重试。'); changeStatus(wasPrepared ? 'prepared' : 'unknown'); }
    }
  }
  async function execute() {
    if (!prepared || phase.current !== 'prepared' || !allowed.current) return false;
    const request = prepared, serial = ++epoch.current; changeStatus('sending'); setPrepared(null); setError(''); setNotice('');
    try {
      const value = await api.executeBookExtractionAi({ confirmationToken: request.confirmationToken, requestHash: request.requestHash, confirmed: true });
      if (alive.current && serial === epoch.current) accept(value, request);
    } catch (failure) {
      if (alive.current && serial === epoch.current) { setError(`${failure instanceof Error ? failure.message : 'AI 回执未确认。'} 请核对本机结果，不会自动重发。`); changeStatus('unknown'); }
    }
    return false;
  }
  async function lookup() {
    const request = active.current;
    if (!request || phase.current !== 'unknown') return;
    const serial = epoch.current; changeStatus('checking'); setError('');
    try {
      const value = await api.getBookExtractionAiResult({ workId: work.id, previewToken: preview.token, requestHash: request.requestHash });
      if (!alive.current || serial !== epoch.current) return;
      if (value.status === 'ready') accept(value.result, request);
      else if (value.status === 'running') { setNotice('请求仍在进行中，可稍后再次核对本机结果。'); changeStatus('unknown'); }
      else { active.current = null; setNotice('本机未发现完成回执，已有成功推荐已保留；重新准备需再次确认发送。'); changeStatus('idle'); }
    } catch (failure) { if (alive.current && serial === epoch.current) { setError(failure instanceof Error ? failure.message : '无法核对本机结果，请重试核对。'); changeStatus('unknown'); } }
  }
  async function copyRaw() {
    if (!rawResult) return;
    try { await navigator.clipboard.writeText(rawResult.rawText); if (alive.current) setNotice('原始响应已复制。'); }
    catch { if (alive.current) setError('复制失败，请选择原始响应手动复制。'); }
  }
  return <section className="book-extraction-ai" aria-label="AI 辅助拆书" aria-busy={busy}>
    <h2>AI 辅助拆书</h2><p>单独选择原文段落进行分析，每次最多 20 段。推荐带入后仍需人工审核。</p>
    {!permission && <p role="status">请先确认有权使用摘选内容，再准备 AI 推荐。</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="book-extraction-ai-selection" role="group" aria-label="AI 分析原文范围">{preview.segments.slice(page * 20, (page + 1) * 20).map((segment, index) => <label key={segment.id}>
      <input type="checkbox" aria-label={`AI 分析段落 ${page * 20 + index + 1}`} checked={selected.includes(segment.id)} disabled={busy || (!selected.includes(segment.id) && selected.length >= 20)} onChange={event => setSelected(current => event.target.checked ? [...current, segment.id] : current.filter(id => id !== segment.id))} />
      <span>{segment.chapterTitle} · 第 {segment.paragraphIndex} 段<span className="book-extraction-ai-original">{segment.text}</span></span>
    </label>)}</div>
    <div className="book-extraction-ai-actions"><button disabled={busy || !page} onClick={() => setPage(page - 1)}>AI 上一页</button><span>第 {page + 1} / {Math.ceil(preview.segments.length / 20)} 页 · 已选 {selected.length} / 20 段</span><button disabled={busy || (page + 1) * 20 >= preview.segments.length} onClick={() => setPage(page + 1)}>AI 下一页</button><button className="primary" disabled={busy || !permission || !selected.length || preview.workId !== work.id} onClick={() => void prepare()}>准备 AI 推荐</button></div>
    {status === 'sending' && <p role="status">正在生成 AI 推荐…</p>}
    {(status === 'sending' || status === 'unknown' || status === 'checking' || (status === 'cancelling' && !prepared)) && <div className="book-extraction-ai-actions">
      {status !== 'sending' && <button disabled={status !== 'unknown'} onClick={() => void lookup()}>核对本机结果</button>}
      <button disabled={status === 'cancelling' || status === 'checking'} onClick={() => void cancel()}>取消本次 AI 请求</button>
    </div>}
    {rawResult && <div aria-label="未通过校验的 AI 响应"><p role="alert">{rawResult.validationError} 本次响应不能带入审核，已有成功推荐已保留。</p><pre className="book-extraction-ai-preview">{rawResult.rawText}</pre><button onClick={() => void copyRaw()}>复制原始响应</button></div>}
    {result && <div className="book-extraction-ai-results" aria-label="AI 推荐结果">{result.suggestions.map(item => <article key={item.segmentId}>
      <h3>第 {(preview.segments.findIndex(segment => segment.id === item.segmentId)) + 1} 段推荐</h3><dl>
        <dt>原文摘录</dt><dd>{item.excerpt}</dd><dt>写作手法</dt><dd>{item.technique}</dd><dt>适用场景</dt><dd>{item.usage}</dd><dt>仿写练习</dt><dd>{item.exercise}</dd>
        <dt>主分类</dt><dd>{extractionCategoryPath(categories, item.categoryId)}</dd><dt>标签</dt><dd>{item.tagIds.map(id => tags.find(tag => tag.id === id)?.name ?? '标签已删除').join('、') || '无'}</dd>
      </dl><button disabled={busy || !permission || !!result.validationError} onClick={() => { if (phase.current === 'idle' && allowed.current && !result.validationError) onUse(item); }}>带入审核</button>
    </article>)}</div>}
    {prepared && <StructureDialog busy={status !== 'prepared'} submitDisabled={!permission} onClose={() => void cancel()} state={{ heading: '确认 AI 辅助拆书', description: `${prepared.service} · ${prepared.model} · ${prepared.scopeLabel}`, submitLabel: '确认发送', submitTone: 'primary', onSubmit: execute }}>
      <p>{prepared.billingHint}</p><p>预计输入 {prepared.estimatedInputTokens} token；输出上限 {prepared.maxOutputTokens} token。</p><details open><summary>完整发送内容</summary><pre className="book-extraction-ai-preview">{prepared.previewText}</pre></details>
    </StructureDialog>}
  </section>;
}
