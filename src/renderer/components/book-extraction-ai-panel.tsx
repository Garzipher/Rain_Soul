import { useEffect, useRef, useState } from 'react';
import type { AiPreparedRequest } from '../../shared/ai';
import type { WorkDetail } from '../../shared/contracts';
import type { BookExtractionPreview } from '../../shared/book-extraction';
import type { BookExtractionAiApi, BookExtractionAiResult, BookExtractionAiSuggestion } from '../../shared/book-extraction-ai';
import { extractionCategoryPath } from '../../shared/ai-extraction';
import { StructureDialog } from './structure-dialog';
import './book-extraction-ai-panel.css';

export interface BookExtractionAiPanelProps {
  work: WorkDetail; preview: BookExtractionPreview; api: BookExtractionAiApi; permission: boolean; disabled?: boolean;
  onUse: (suggestion: BookExtractionAiSuggestion, revalidate: () => Promise<boolean>) => void; onBusyChange: (busy: boolean) => void;
}
export function BookExtractionAiPanel(props: BookExtractionAiPanelProps) {
  return <BookExtractionAiPanelContent key={`${props.work.id}:${props.preview.token}`} {...props} />;
}
function BookExtractionAiPanelContent({ work, preview, api, permission, disabled = false, onUse, onBusyChange }: BookExtractionAiPanelProps) {
  const [selected, setSelected] = useState<string[]>([]), [page, setPage] = useState(0);
  const [prepared, setPrepared] = useState<AiPreparedRequest | null>(null), [result, setResult] = useState<BookExtractionAiResult | null>(null);
  const [rawResult, setRawResult] = useState<BookExtractionAiResult | null>(null), [notice, setNotice] = useState('');
  const [status, setStatus] = useState<'idle' | 'preparing' | 'prepared' | 'sending' | 'unknown' | 'checking' | 'adopting' | 'cancelling'>('idle'), [error, setError] = useState('');
  const phase = useRef(status), tokens = useRef(new Set<string>()), alive = useRef(true), epoch = useRef(0);
  const active = useRef<AiPreparedRequest | null>(null), allowed = useRef(permission); allowed.current = permission;
  const requests = useRef(new Map<string, AiPreparedRequest>()), sentHashes = useRef(new Set<string>());
  const manualLock = useRef(disabled); manualLock.current = disabled;
  const prepareButton = useRef<HTMLButtonElement>(null), restoreFocus = useRef(false);
  const latestApi = useRef(api); latestApi.current = api;
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const busy = status !== 'idle';
  const categories = work.assets?.categories.filter(item => !item.deletedAt) ?? [], tags = work.assets?.tags.filter(item => !item.deletedAt) ?? [];
  function changeStatus(value: typeof status) { phase.current = value; busyCallback.current(value !== 'idle'); setStatus(value); }
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; epoch.current++; for (const token of tokens.current) void latestApi.current.cancelBookExtractionAi(token).catch(() => undefined); busyCallback.current(false); };
  }, []);
  useEffect(() => { if (!permission && active.current && phase.current !== 'idle') void cancel(); }, [permission]);
  useEffect(() => { if (status === 'idle' && restoreFocus.current) { restoreFocus.current = false; prepareButton.current?.focus(); } }, [status]);
  function accept(value: BookExtractionAiResult, request: AiPreparedRequest) {
    if (value.workId !== work.id || value.previewToken !== preview.token || value.requestHash !== request.requestHash) throw new Error('推荐回执不匹配本次原文，请核对本机结果。');
    if (value.validationError) setRawResult(value);
    else { setResult(value); setRawResult(null); }
    active.current = null; setError(''); setNotice(''); changeStatus('idle');
  }
  async function prepare() {
    if (manualLock.current || phase.current !== 'idle' || !permission || preview.workId !== work.id || !selected.length || selected.length > 20) return;
    const serial = ++epoch.current; changeStatus('preparing'); setError(''); setNotice('');
    try {
      const value = await api.prepareBookExtractionAi({ workId: work.id, token: preview.token, segmentIds: preview.segments.filter(segment => selected.includes(segment.id)).map(segment => segment.id), permissionConfirmed: true });
      if (!alive.current || serial !== epoch.current) {
        await api.cancelBookExtractionAi(value.confirmationToken);
        return;
      }
      tokens.current.add(value.confirmationToken); requests.current.set(value.requestHash, value); active.current = value;
      if (!allowed.current) { await cancel(); return; }
      setPrepared(value); changeStatus('prepared');
    } catch (failure) { if (alive.current && serial === epoch.current) { setError(failure instanceof Error ? failure.message : '无法准备 AI 推荐。'); changeStatus('idle'); } }
  }
  async function cancel() {
    const request = active.current;
    if (!request || phase.current === 'cancelling' || phase.current === 'idle') return;
    const wasPrepared = phase.current === 'prepared', serial = ++epoch.current; changeStatus('cancelling');
    try {
      await api.cancelBookExtractionAi(request.confirmationToken);
      if (!alive.current || serial !== epoch.current) return;
      if (sentHashes.current.has(request.requestHash)) {
        let state = await api.getBookExtractionAiResult({ workId: work.id, previewToken: preview.token, requestHash: request.requestHash });
        if (!alive.current || serial !== epoch.current) return;
        if (state.status === 'ready') { await api.cancelBookExtractionAi(request.confirmationToken); state = await api.getBookExtractionAiResult({ workId: work.id, previewToken: preview.token, requestHash: request.requestHash }); }
        if (!alive.current || serial !== epoch.current) return;
        if (state.status !== 'missing') { setPrepared(null); setNotice('取消仍未完成，请核对本机结果后再离开。'); changeStatus('unknown'); return; }
      }
      tokens.current.delete(request.confirmationToken); requests.current.delete(request.requestHash); sentHashes.current.delete(request.requestHash); active.current = null; restoreFocus.current = wasPrepared; setPrepared(null); setError(''); setNotice('已取消本次 AI 请求，已有成功推荐已保留。'); changeStatus('idle');
    } catch (failure) {
      if (alive.current && serial === epoch.current) { setError(failure instanceof Error ? failure.message : '取消失败，请重试。'); changeStatus(wasPrepared ? 'prepared' : 'unknown'); }
    }
  }
  async function execute() {
    if (!prepared || manualLock.current || phase.current !== 'prepared' || !allowed.current) return false;
    if (prepared.expiresAt <= Date.now()) { setError('授权预览已过期，请取消后重新准备。'); return false; }
    const request = prepared, serial = ++epoch.current; changeStatus('sending'); setPrepared(null); setError(''); setNotice('');
    sentHashes.current.add(request.requestHash);
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
  async function checkSuggestion(item: BookExtractionAiSuggestion, source: BookExtractionAiResult): Promise<boolean> {
    if (manualLock.current || !allowed.current || phase.current !== 'idle' || source.validationError) return false;
    const serial = epoch.current; let keepLocked = false; changeStatus('adopting'); setError('');
    try {
      const state = await api.getBookExtractionAiResult({ workId: source.workId, previewToken: source.previewToken, requestHash: source.requestHash });
      if (!alive.current || serial !== epoch.current) return false;
      let invalid = '';
      if (state.status !== 'ready') {
        invalid = '本机结果尚未完成或已被放弃，不能带入审核。';
        if (state.status === 'running') { active.current = requests.current.get(source.requestHash) ?? null; keepLocked = true; changeStatus('unknown'); }
      }
      else if (state.result.workId !== source.workId || state.result.previewToken !== source.previewToken || state.result.requestHash !== source.requestHash || JSON.stringify(state.result.suggestions.find(suggestion => suggestion.segmentId === item.segmentId)) !== JSON.stringify(item)) invalid = '本机推荐回执与所选建议不匹配，不能带入审核。';
      else invalid = state.result.validationError ?? '';
      if (invalid) { const blocked = { ...source, validationError: invalid }; setResult(blocked); setRawResult(blocked); return false; }
      return !manualLock.current && allowed.current;
    } catch (failure) { if (alive.current && serial === epoch.current) setError(failure instanceof Error ? failure.message : '本机核对失败，不能带入审核。'); return false; }
    finally { if (alive.current && serial === epoch.current && !keepLocked) changeStatus('idle'); }
  }
  async function adoptSuggestion(item: BookExtractionAiSuggestion) {
    const source = result;
    if (source && await checkSuggestion(item, source)) onUse(item, () => checkSuggestion(item, source));
  }
  return <section className="book-extraction-ai" aria-label="AI 辅助拆书" aria-busy={busy}>
    <h2>AI 辅助拆书</h2><p>单独选择原文段落进行分析，每次最多 20 段。推荐带入后仍需人工审核。</p>
    {!permission && <p role="status">请先确认有权使用摘选内容，再准备 AI 推荐。</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="book-extraction-ai-selection" role="group" aria-label="AI 分析原文范围">{preview.segments.slice(page * 20, (page + 1) * 20).map((segment, index) => <label key={segment.id}>
      <input type="checkbox" aria-label={`AI 分析段落 ${page * 20 + index + 1}`} checked={selected.includes(segment.id)} disabled={disabled || busy || (!selected.includes(segment.id) && selected.length >= 20)} onChange={event => { if (manualLock.current || phase.current !== 'idle') return; const checked = event.target.checked; setSelected(current => checked ? current.includes(segment.id) || current.length >= 20 ? current : [...current, segment.id] : current.filter(id => id !== segment.id)); }} />
      <span>{segment.chapterTitle} · 第 {segment.paragraphIndex} 段<span className="book-extraction-ai-original">{segment.text}</span></span>
    </label>)}</div>
    <div className="book-extraction-ai-actions"><button disabled={disabled || busy || !page} onClick={() => setPage(page - 1)}>AI 上一页</button><span>第 {page + 1} / {Math.ceil(preview.segments.length / 20)} 页 · 已选 {selected.length} / 20 段</span><button disabled={disabled || busy || (page + 1) * 20 >= preview.segments.length} onClick={() => setPage(page + 1)}>AI 下一页</button><button ref={prepareButton} className="primary" disabled={disabled || busy || !permission || !selected.length || preview.workId !== work.id} onClick={() => void prepare()}>准备 AI 推荐</button></div>
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
      </dl><button disabled={disabled || busy || !permission || !!result.validationError} onClick={() => void adoptSuggestion(item)}>带入审核</button>
    </article>)}</div>}
    {prepared && <StructureDialog busy={status !== 'prepared'} submitDisabled={disabled || !permission} onClose={() => void cancel()} state={{ heading: '确认 AI 辅助拆书', description: `${prepared.service} · ${prepared.model} · ${prepared.scopeLabel}`, submitLabel: '确认发送', submitTone: 'primary', onSubmit: execute }}>
      <p>{prepared.billingHint}</p><p>预计输入 {prepared.estimatedInputTokens} token；输出上限 {prepared.maxOutputTokens} token。</p><details open><summary>完整发送内容</summary><pre className="book-extraction-ai-preview" tabIndex={0} aria-label="完整发送内容">{prepared.previewText}</pre></details>
    </StructureDialog>}
  </section>;
}
