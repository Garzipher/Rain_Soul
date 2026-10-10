import { useEffect, useRef, useState } from 'react';
import type { AssetAction, AssetQuery, AssetState, KnowledgeEntry, SearchResult } from '../../shared/assets';
import type { WorkDetail, WorkSummary } from '../../shared/contracts';
import type { RetrievalQuery, RetrievalReply } from '../../shared/retrieval';
import { StructureDialog, type StructureDialogState } from './structure-dialog';
import { readableKnowledgeSource, replaceKnowledgeSource, splitKnowledgeSource } from '../../shared/knowledge-source';
import { KnowledgeSourceAudit } from './knowledge-source-audit';
import './knowledge-workspace.css';
export interface KnowledgeWorkspaceProps {
  referenceIds?: string[];
  onToggleReference?: (entryId: string) => void;
  onReturnWriting?: () => void;
  onRetrieve?: (query: RetrievalQuery) => Promise<RetrievalReply>;
  onBookExtraction?: () => void;
  selectedEntryId?: string | null;
  work: WorkDetail; assets: AssetState; busy: boolean;
  onAction: (action: AssetAction) => Promise<boolean>; onDirtyChange?: (dirty: boolean) => void;
  onSearch: (query: AssetQuery) => Promise<SearchResult[]>; onLocate: (chapterId: string, paragraphId?: string) => void;
  scopeProps?: { works: WorkSummary[]; scopeId: string; onScopeChange: (id: string) => void; canEdit: boolean;
    onCopy?: (entryId: string) => Promise<boolean>; entryOwners?: Record<string, { workId: string; workTitle: string; sourceEntryId?: string }> };
}
interface KnowledgeDraft { id: string | null; body: string; source: string; originalSource: string; categoryId: string; tagIds: string[] }
export function KnowledgeWorkspace(props: KnowledgeWorkspaceProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [categoryId, setCategory] = useState<string | null>(null);
  const [tagIds, setTags] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<AssetQuery['mode']>('knowledge');
  const [retrievalMode, setRetrievalMode] = useState<RetrievalQuery['mode']>('keyword');
  const [page, setPage] = useState(1);
  const [reply, setReply] = useState<RetrievalReply | null>(null);
  const retrieve = useRef(props.onRetrieve); retrieve.current = props.onRetrieve;
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<KnowledgeDraft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<StructureDialogState | null>(null);
  const [splitter, setSplitter] = useState(false);
  const actionLock = useRef(false), epoch = useRef(0);
  const latestSearch = useRef(props.onSearch), dirtyCallback = useRef(props.onDirtyChange);
  const trigger = useRef<HTMLElement | null>(null), editor = useRef<HTMLTextAreaElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  latestSearch.current = props.onSearch; dirtyCallback.current = props.onDirtyChange;
  const categories = props.assets.categories.filter(item => !item.deletedAt);
  const tags = props.assets.tags.filter(item => !item.deletedAt);
  const entries = props.assets.knowledge.filter(item => !item.deletedAt);
  const canEdit = props.scopeProps?.canEdit ?? true;
  const globalScope = props.scopeProps?.scopeId === 'all';
  const disabled = props.busy || sending;
  const dirty = sending || (!!form && JSON.stringify(form) !== baseline);
  useEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);
  useEffect(() => () => { dirtyCallback.current?.(false); }, []);
  useEffect(() => { if (form) editor.current?.focus(); }, [form?.id, !!form]);
  useEffect(() => {
    setCategory(null); setTags([]); setExpanded(new Set()); setText(''); setMode('knowledge');
  }, [props.work.id, props.scopeProps?.scopeId]);
  useEffect(() => {
    const id = props.selectedEntryId;
    if (!id || !props.assets.knowledge.some(entry => entry.id === id && !entry.deletedAt)) return;
    setCategory(null); setTags([]); setText(''); setMode('knowledge'); setExpanded(new Set([id]));
  }, [props.selectedEntryId, props.assets.knowledge]);
  useEffect(() => {
    const card = props.selectedEntryId && cards.current.get(props.selectedEntryId);
    if (card && expanded.has(props.selectedEntryId!)) { card.scrollIntoView?.({ block: 'center' }); card.focus(); }
  }, [expanded, props.selectedEntryId]);
  const queryKey = JSON.stringify({ text, mode, categoryId, tagIds, retrievalMode });
  useEffect(() => { setPage(1); }, [queryKey, props.scopeProps?.scopeId]);
  const needsSearch = !!text.trim() || mode === 'all';
  useEffect(() => {
    const current = ++epoch.current;
    setReply(null);
    if (!needsSearch) { setResults([]); setSearching(false); setSearchError(null); setHasMore(false); return; }
    setSearching(true); setSearchError(null); setResults([]);
    const query: AssetQuery = { text, mode, categoryId, tagIds };
    if (mode === 'knowledge' && retrieve.current) {
      const queryId = crypto.randomUUID();
      void retrieve.current({ queryId, query: text.trim(), mode: retrievalMode,
        workId: props.scopeProps?.scopeId === 'all' ? null : props.scopeProps?.scopeId ?? props.work.id,
        ...(categoryId ? { categoryId } : {}), tagIds, page, pageSize: 20 }).then(value => {
        if (epoch.current !== current) return;
        if (value.queryId !== queryId) throw new Error('检索回执不匹配，请重新搜索');
        setReply(value); setHasMore(false);
      }).catch((reason: unknown) => { if (epoch.current === current) setSearchError(reason instanceof Error ? reason.message : '检索失败'); })
        .finally(() => { if (epoch.current === current) setSearching(false); });
      return () => { epoch.current++; };
    }
    void latestSearch.current({ ...query, offset: 0, limit: 200 }).then(rows => {
      if (epoch.current !== current) return;
      setResults(rows); setHasMore(rows.length === 200);
    }).catch((reason: unknown) => { if (epoch.current === current) setSearchError(reason instanceof Error ? reason.message : '搜索失败，请重试'); })
      .finally(() => { if (epoch.current === current) setSearching(false); });
    return () => { epoch.current++; };
  }, [queryKey, needsSearch, props.assets, searchRetry, props.scopeProps?.scopeId, page]);
  async function more() {
    const current = epoch.current; setSearching(true);
    try {
      const rows = await latestSearch.current({ text, mode, categoryId, tagIds, offset: results.length, limit: 200 });
      if (current === epoch.current) { setResults(previous => [...previous, ...rows]); setHasMore(rows.length === 200); setSearchError(null); }
    } catch (reason) { if (current === epoch.current) setSearchError(reason instanceof Error ? reason.message : '搜索失败，请重试'); }
    finally { if (current === epoch.current) setSearching(false); }
  }
  function belongsTo(id: string): boolean {
    if (categoryId === null) return true;
    const seen = new Set<string>(); let current: string | null = id;
    while (current && !seen.has(current)) {
      if (current === categoryId) return true;
      seen.add(current); current = categories.find(item => item.id === current)?.parentId ?? null;
    }
    return false;
  }
  const matched = new Set(results.filter(row => row.kind === 'knowledge').map(row => row.id));
  const entriesBySource = new Map(entries.map(entry => {
    const owner = props.scopeProps?.entryOwners?.[entry.id];
    return [`${owner?.workId ?? props.work.id}/${owner?.sourceEntryId ?? entry.id}`, entry];
  }));
  const retrievedEntries = reply ? reply.hits.flatMap(hit => {
    const entry = entriesBySource.get(`${hit.workId}/${hit.entryId}`);
    return entry ? [entry] : [];
  }) : entries;
  const visible = retrievedEntries.filter(entry => belongsTo(entry.categoryId) && tagIds.every(id => entry.tagIds.includes(id)) && (!needsSearch || !!reply || matched.has(entry.id)));
  async function operate(operation: () => Promise<boolean>): Promise<boolean> {
    if (disabled || actionLock.current) return false;
    actionLock.current = true; setSending(true); setError(null); setNotice(null);
    try { const success = await operation(); if (!success) setError('操作未完成，请保留输入并重试。'); return success; }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请保留输入并重试'); return false; }
    finally { actionLock.current = false; setSending(false); }
  }
  function openForm(entry?: KnowledgeEntry) {
    if (!canEdit || disabled || form) return;
    trigger.current = document.activeElement as HTMLElement;
    const draft: KnowledgeDraft = entry ? { id: entry.id, body: entry.body, source: readableKnowledgeSource(entry.source), originalSource: entry.source, categoryId: entry.categoryId, tagIds: [...entry.tagIds] }
      : { id: null, body: '', source: '', originalSource: '', categoryId: categoryId ?? categories.find(item => item.systemKey === 'uncategorized')?.id ?? categories[0]?.id ?? '', tagIds: [] };
    setForm(draft); setBaseline(JSON.stringify(draft)); setError(null);
  }
  function closeForm() { setForm(null); setError(null); trigger.current?.focus(); }
  async function save() {
    if (!form || !canEdit || !form.body.trim() || !categories.some(item => item.id === form.categoryId)) return;
    const payload = { body: form.body, source: replaceKnowledgeSource(form.originalSource, form.source), categoryId: form.categoryId, tagIds: form.tagIds };
    const action: AssetAction = form.id ? { type: 'updateKnowledge', id: form.id, ...payload } : { type: 'createKnowledge', ...payload };
    if (await operate(() => props.onAction(action))) closeForm();
  }
  function toggleTag(id: string) { setTags(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]); }
  const paragraphs = results.filter(row => row.kind === 'paragraph');
  return <section className="knowledge-workspace" aria-label="知识工作区">
    <div className="knowledge-heading"><p>按分类、标签和来源整理作品素材。</p><div>{props.onReturnWriting && <button className="secondary" disabled={disabled || !!form} onClick={props.onReturnWriting}>返回写作</button>}<button className="secondary" disabled={disabled || !!form} onClick={() => props.onBookExtraction ? props.onBookExtraction() : setSplitter(true)}>拆书工具</button><button className="primary" disabled={disabled || !canEdit || !!form || !categories.length} onClick={() => openForm()}>新增知识</button></div></div>
    {splitter ? <div className="knowledge-deferred" role="status"><h2>后续开发：本功能尚未交付</h2><p>素材拆文会将参考作品中的描写与写法整理入知识库，保留出处供学习与创作参考。当前阶段：知识库与手工条目。</p><button className="secondary" onClick={() => setSplitter(false)}>返回知识库</button></div> : <div className={`knowledge-layout ${collapsed ? 'is-collapsed' : ''}`}>
      {!collapsed && <nav className="knowledge-categories" aria-label="知识分类"><div><strong>分类</strong><button className="secondary" aria-expanded="true" onClick={() => setCollapsed(true)}>收起分类</button></div>
        <button aria-pressed={categoryId === null} onClick={() => setCategory(null)}>全部知识</button>
        {categories.map(category => <button key={category.id} disabled={globalScope} aria-pressed={categoryId === category.id} onClick={() => setCategory(category.id)}><span>{category.parentId && '↳ '}{category.name}</span></button>)}
      </nav>}
      <div className="knowledge-content"><div className="knowledge-toolbar">
        {collapsed && <button className="secondary" aria-expanded="false" onClick={() => setCollapsed(false)}>展开分类</button>}
        <input type="search" aria-label="模糊搜索知识与正文" placeholder="搜索内容、出处、标签" value={text} onChange={event => setText(event.target.value)} />
        <label>搜索范围<select aria-label="搜索范围" value={mode} onChange={event => { setMode(event.target.value as AssetQuery['mode']); setRetrievalMode('keyword'); }}><option value="knowledge">知识内容</option>{canEdit && <option value="all">正文与知识</option>}</select></label>
        {props.onRetrieve && <label>检索方式<select aria-label="检索方式" value={mode === 'all' ? 'keyword' : retrievalMode} disabled={mode === 'all'} onChange={event => { if (mode === 'knowledge') setRetrievalMode(event.target.value as RetrievalQuery['mode']); }}><option value="keyword">关键词</option><option value="semantic">语义</option><option value="hybrid">混合</option></select></label>}
        {props.scopeProps && <label>作品范围<select aria-label="作品范围" value={props.scopeProps.scopeId} disabled={disabled || !!form} onChange={event => props.scopeProps?.onScopeChange(event.target.value)}><option value={props.work.id}>当前作品：{props.work.title}</option><option value="all">全部作品（只读）</option>{props.scopeProps.works.filter(item => item.id !== props.work.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      </div>
      {!canEdit && <p className="knowledge-readonly">当前范围只读；复制后在当前作品独立编辑。</p>}
      {globalScope && <p className="knowledge-readonly">请选择一部作品后筛选分类与标签。</p>}
      <div className="knowledge-filter-tags" role="group" aria-label="标签筛选"><span>标签一览</span>{tags.map(tag => <button key={tag.id} disabled={globalScope} aria-pressed={tagIds.includes(tag.id)} onClick={() => toggleTag(tag.id)}>{tag.name}</button>)}{!tags.length && <small>请到设置维护标签</small>}</div>
      {error && <p role="alert" className="knowledge-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      {form && <form className="knowledge-form" aria-label={form.id ? '编辑知识' : '新添知识'} onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2>{form.id ? '编辑知识' : '新添知识'}</h2><label>知识内容<textarea ref={editor} value={form.body} disabled={disabled} onChange={event => setForm({ ...form, body: event.target.value })} required /></label>
        <label>出处<input value={form.source} disabled={disabled} onChange={event => setForm({ ...form, source: event.target.value })} /></label>
        <label>主分类<select value={form.categoryId} disabled={disabled} onChange={event => setForm({ ...form, categoryId: event.target.value })}>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <fieldset disabled={disabled}><legend>已维护标签</legend>{tags.map(tag => <label key={tag.id}><input type="checkbox" checked={form.tagIds.includes(tag.id)} onChange={() => setForm({ ...form, tagIds: form.tagIds.includes(tag.id) ? form.tagIds.filter(id => id !== tag.id) : [...form.tagIds, tag.id] })} />{tag.name}</label>)}</fieldset>
        <div className="knowledge-form-actions"><button type="button" className="secondary" disabled={disabled} onClick={closeForm}>取消编辑</button><button className="primary" disabled={disabled || !form.body.trim() || !form.categoryId}>{sending ? '正在保存…' : '保存知识'}</button></div>
      </form>}
      {searchError && <p role="alert">{searchError}<button className="secondary" onClick={() => setSearchRetry(value => value + 1)}>重新搜索</button></p>}
      {searching && <p role="status">正在搜索本机内容…</p>}
      {reply?.message && <p role="status">{reply.message}</p>}
      <div className="knowledge-grid">{visible.map(entry => { const source = splitKnowledgeSource(entry.source); return <article key={entry.id} ref={element => { if (element) cards.current.set(entry.id, element); else cards.current.delete(entry.id); }} tabIndex={-1} className="knowledge-entry" aria-label={`知识：${entry.body.slice(0, 20)}`}>
        <button className={`knowledge-snippet ${expanded.has(entry.id) ? '' : 'is-collapsed'}`} aria-label={`${expanded.has(entry.id) ? '收起' : '展开'}知识：${entry.body.slice(0, 20)}`} aria-expanded={expanded.has(entry.id)} onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })}>{entry.body}</button>
        <div className="knowledge-entry-tags">{entry.tagIds.map(id => { const tag = tags.find(item => item.id === id); return tag && <span key={id}>{tag.name}</span>; })}</div>
        {reply && <small>{reply.hits.find(hit => hit.entryId === (props.scopeProps?.entryOwners?.[entry.id]?.sourceEntryId ?? entry.id) && hit.workId === (props.scopeProps?.entryOwners?.[entry.id]?.workId ?? props.work.id))?.matchedBy.map(value => value === 'keyword' ? '关键词命中' : '语义相关').join(' · ')}</small>}
        <div className="knowledge-entry-bottom"><div>{canEdit ? <><button disabled={disabled || !!form} onClick={() => openForm(entry)}>编辑知识</button><button disabled={disabled || !!form} onClick={() => setDialog({ heading: '删除知识', description: '将删除这条知识。历史内容与引用追溯仍保留，不会删除正文。', submitLabel: '确认删除', onSubmit: () => operate(() => props.onAction({ type: 'deleteKnowledge', id: entry.id })) })}>删除知识</button></> : props.scopeProps?.entryOwners?.[entry.id]?.workId === props.work.id ? <span>已在当前作品</span> : props.scopeProps?.onCopy && <button disabled={disabled} onClick={() => { void operate(() => props.scopeProps!.onCopy!(entry.id)); }}>复制到当前作品</button>}</div>
          <div className="knowledge-source">{props.scopeProps?.entryOwners?.[entry.id] && <span>{props.scopeProps.entryOwners[entry.id].workTitle}</span>}<span>{source.readable || '未注明出处'}</span>{entry.origin && <small>来源作品：{entry.origin.workTitle}</small>}</div></div>
        {canEdit && props.onToggleReference && <button className="secondary" aria-pressed={props.referenceIds?.includes(entry.id) ?? false} disabled={disabled || !!form || (!props.referenceIds?.includes(entry.id) && (props.referenceIds?.length ?? 0) >= 5)} onClick={() => props.onToggleReference!(entry.id)}>{props.referenceIds?.includes(entry.id) ? '移除写作参考' : '用于写作参考'}</button>}
        <KnowledgeSourceAudit records={source.records} />
      </article>; })}</div>
      {paragraphs.map(row => <article className="knowledge-paragraph-result" key={row.id}><small>正文 · {row.source}</small><p>{row.snippet}</p><button className="secondary" disabled={!row.chapterId || disabled} aria-label={`定位正文：${row.title}`} onClick={() => { if (row.chapterId) props.onLocate(row.chapterId, row.paragraphId ?? undefined); }}>{row.title}</button></article>)}
      {!searching && !searchError && !visible.length && !paragraphs.length && <p role="status">没有匹配的知识或正文内容</p>}
      {needsSearch && hasMore && <button className="secondary" disabled={searching} onClick={() => void more()}>加载更多结果</button>}
      {reply && <nav className="knowledge-pagination" aria-label="检索结果分页"><button className="secondary" aria-label="上一页检索结果" disabled={searching || page === 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page} 页 · 共 {reply.total} 条</span><button className="secondary" aria-label="下一页检索结果" disabled={searching || page * 20 >= reply.total} onClick={() => setPage(value => value + 1)}>下一页</button></nav>}
      </div></div>}
    {dialog && <StructureDialog state={dialog} busy={disabled} onClose={() => setDialog(null)} />}
  </section>;
}
