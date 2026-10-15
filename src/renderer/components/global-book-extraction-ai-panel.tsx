import { AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { AiPreparedRequest } from '../../shared/ai';
import type { GlobalBookExtractionAiApi, GlobalBookExtractionAiResult } from '../../shared/global-book-extraction-ai';
import type { GlobalExtractionPreview, GlobalExtractionDraft } from '../../shared/global-book-extraction';
import type { GlobalKnowledgePage } from '../../shared/global-knowledge';
import type { BookExtractionAiSuggestion } from '../../shared/book-extraction-ai';
import { StructureDialog } from './structure-dialog';
import { extractionCategoryPath } from '../../shared/ai-extraction';
import './book-extraction-ai-panel.css';
interface Props { api: GlobalBookExtractionAiApi; library: GlobalKnowledgePage; preview: GlobalExtractionPreview; permission: boolean;
  disabled: boolean; batches: GlobalExtractionDraft['batches']; onUse(item: BookExtractionAiSuggestion): void; onBusyChange(busy: boolean): void }
/** 与作品拆书使用相同的传输服务；全局身份、发送范围和审核结果独立。 */
export function GlobalBookExtractionAiPanel({ api, library, preview, permission, disabled, batches, onUse, onBusyChange }: Props) {
  const [selected, setSelected] = useState<string[]>([]), [page, setPage] = useState(0), [prepared, setPrepared] = useState<AiPreparedRequest | null>(null);
  const [result, setResult] = useState<GlobalBookExtractionAiResult | null>(null), [error, setError] = useState('');
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'confirm' | 'sending' | 'unknown' | 'checking' | 'cancelling'>('idle');
  const active = useRef<AiPreparedRequest | null>(null), lock = useRef(false), alive = useRef(true), serial = useRef(0);
  const latestApi = useRef(api), callback = useRef(onBusyChange); latestApi.current = api; callback.current = onBusyChange;
  const busy = phase !== 'idle';
  function change(next: typeof phase) { lock.current = next !== 'idle'; setPhase(next); callback.current(next !== 'idle'); }
  useEffect(() => { alive.current = true; return () => { alive.current = false; serial.current++; if (active.current) void latestApi.current.cancelGlobalBookExtractionAi(active.current.confirmationToken).catch(() => {}); callback.current(false); }; }, []);
  function accept(value: GlobalBookExtractionAiResult, requestHash: string) {
    if (value.target.kind !== 'global' || value.target.libraryId !== library.libraryId || value.previewToken !== preview.token || value.requestHash !== requestHash)
      throw new Error('AI 回执不属于本次全局来源，请核对。');
    setResult(value); active.current = null; setPrepared(null); change('idle');
  }
  async function prepare() {
    if (lock.current || disabled || !permission || !selected.length) return;
    const epoch = ++serial.current; change('preparing'); setError('');
    try {
      const value = await api.prepareGlobalBookExtractionAi({ token: preview.token, segmentIds: selected, permissionConfirmed: true });
      if (!alive.current || epoch !== serial.current) { await api.cancelGlobalBookExtractionAi(value.confirmationToken); return; }
      active.current = value; setPrepared(value); change('confirm');
    } catch (failure) { if (alive.current && epoch === serial.current) { setError(failure instanceof Error ? failure.message : '准备失败。'); change('idle'); } }
  }
  async function send() {
    if (!prepared || !permission || disabled || phase !== 'confirm') return false;
    const request = prepared, epoch = ++serial.current; change('sending'); setPrepared(null); setError('');
    try { const value = await api.executeGlobalBookExtractionAi({ confirmationToken: request.confirmationToken, requestHash: request.requestHash, confirmed: true });
      if (alive.current && epoch === serial.current) accept(value, request.requestHash);
    } catch (failure) { if (alive.current && epoch === serial.current) { setError(`${failure instanceof Error ? failure.message : '发送结果未确认。'} 不会自动重发。`); change('unknown'); } }
    return false;
  }
  async function lookup(requestHash: string) {
    if (lock.current && phase !== 'unknown') return;
    const epoch = ++serial.current; change('checking'); setError('');
    try { const value = await api.getGlobalBookExtractionAiResult({ previewToken: preview.token, requestHash });
      if (!alive.current || epoch !== serial.current) return;
      if (value.status === 'ready') accept(value.result, requestHash);
      else { setError(value.status === 'running' ? '请求仍在生成，可取消或稍后核对。' : '没有已完成结果，未自动重发。'); change(value.status === 'running' ? 'unknown' : 'idle'); }
    } catch (failure) { if (alive.current && epoch === serial.current) { setError(failure instanceof Error ? failure.message : '读取本机结果失败。'); change(active.current ? 'unknown' : 'idle'); } }
  }
  async function cancel() {
    const request = active.current; if (!request || phase === 'cancelling') return;
    const epoch = ++serial.current; change('cancelling'); setError('');
    try { await api.cancelGlobalBookExtractionAi(request.confirmationToken);
      if (alive.current && epoch === serial.current) { setPrepared(null); active.current = null; change('idle'); }
    } catch (failure) { if (alive.current && epoch === serial.current) { setError(failure instanceof Error ? failure.message : '取消结果未确认，请重试。'); change('unknown'); } }
  }
  async function adopt(item: BookExtractionAiSuggestion) {
    if (lock.current || disabled || !permission || !result || result.validationError) return;
    const epoch = ++serial.current, source = result; change('checking'); setError('');
    try { const state = await api.getGlobalBookExtractionAiResult({ previewToken: preview.token, requestHash: source.requestHash });
      if (!alive.current || epoch !== serial.current) return;
      const found = state.status === 'ready' && !state.result.validationError && state.result.target.libraryId === library.libraryId
        && state.result.suggestions.find(candidate => candidate.segmentId === item.segmentId);
      if (!found || JSON.stringify(found) !== JSON.stringify(item)) throw new Error('建议或分类证据已变化，禁止带入；请重新核对。');
      onUse(item);
    } catch (failure) { if (alive.current && epoch === serial.current) setError(failure instanceof Error ? failure.message : '建议核对失败。'); }
    finally { if (alive.current && epoch === serial.current) change('idle'); }
  }
  return <section className="book-extraction-ai" aria-label="全局 AI 辅助拆书" aria-busy={busy}>
    <h2>AI 辅助拆书</h2><p>分析已选原文，推荐写作手法、适用场景和仿写练习。带入后仍需逐条审核。</p>
    {error && <p role="alert">{error}</p>}
    <div className="book-extraction-ai-selection" role="group" aria-label="全局 AI 分析范围">{preview.segments.slice(page * 20, (page + 1) * 20).map(segment => <label key={segment.id}>
      <input type="checkbox" disabled={disabled || busy || !selected.includes(segment.id) && selected.length >= 20} checked={selected.includes(segment.id)} onChange={event => setSelected(current => event.target.checked ? [...current, segment.id] : current.filter(id => id !== segment.id))} />
      <span>{segment.chapterTitle} · 第 {segment.paragraphIndex} 段<span className="book-extraction-ai-original">{segment.text}</span></span></label>)}</div>
    <div className="book-extraction-ai-actions"><button disabled={busy || !page} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page + 1} / {Math.ceil(preview.segments.length / 20)} 页 · 已选 {selected.length}/20 段</span><button disabled={busy || (page + 1) * 20 >= preview.segments.length} onClick={() => setPage(page + 1)}>下一页</button><button className="primary" disabled={disabled || busy || !permission || !selected.length} onClick={() => void prepare()}>准备 AI 推荐</button></div>
    {busy && phase !== 'confirm' && <div className="book-extraction-ai-actions"><span role="status">{phase === 'sending' ? '正在分析原文…' : phase === 'unknown' ? '结果待核对' : '正在处理…'}</span>{phase === 'unknown' && active.current && <button onClick={() => void lookup(active.current!.requestHash)}>核对本机结果</button>}<button disabled={!active.current || phase === 'cancelling'} onClick={() => void cancel()}>取消本次请求</button></div>}
    {batches.filter(batch => batch.status === 'ready').map((batch, index) => <button key={batch.requestHash} disabled={disabled || busy} onClick={() => void lookup(batch.requestHash)}>查看已保存 AI 批次 {index + 1}</button>)}
    {result && <div className="book-extraction-ai-results">{result.validationError ? <><p role="alert">{result.validationError}</p><pre className="book-extraction-ai-preview">{result.rawText}</pre></> : result.suggestions.map(item => <article key={item.segmentId}><h3>AI 建议 · 原文第 {preview.segments.find(segment => segment.id === item.segmentId)?.paragraphIndex} 段</h3><dl><dt>原句摘录</dt><dd>{item.excerpt}</dd><dt>写作手法</dt><dd>{item.technique}</dd><dt>适用场景</dt><dd>{item.usage}</dd><dt>仿写练习</dt><dd>{item.exercise}</dd><dt>分类</dt><dd>{extractionCategoryPath(library.categories, item.categoryId)}</dd><dt>标签</dt><dd>{item.tagIds.map(id => library.tags.find(tag => tag.id === id)?.name ?? '已删除标签').join('、') || '无'}</dd></dl><button disabled={disabled || busy || !permission} onClick={() => void adopt(item)}>带入审核</button></article>)}</div>}
    <AnimatePresence>{prepared && <StructureDialog key="global-ai-confirm" busy={phase !== 'confirm'} submitDisabled={disabled || !permission} onClose={() => void cancel()} state={{ heading: '确认全局拆书 AI 发送', description: `${prepared.service} · ${prepared.model} · ${prepared.scopeLabel}`, submitLabel: '确认发送', submitTone: 'primary', onSubmit: send }}><p>{prepared.billingHint}</p><p>预计输入 {prepared.estimatedInputTokens} token，输出上限 {prepared.maxOutputTokens} token。</p><details><summary>完整发送内容</summary><pre className="book-extraction-ai-preview">{prepared.previewText}</pre></details></StructureDialog>}</AnimatePresence>
  </section>;
}
