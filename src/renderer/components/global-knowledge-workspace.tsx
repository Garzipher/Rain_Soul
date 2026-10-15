import { AnimatePresence, m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { GlobalKnowledgeAction, GlobalKnowledgeEntry, GlobalKnowledgePage, GlobalKnowledgeQuery } from '../../shared/global-knowledge';
import { SelectField } from './select-field';
import { StructureDialog, type StructureDialogState } from './structure-dialog';
import { readableKnowledgeSource, replaceKnowledgeSource } from '../../shared/knowledge-source';
import { AnimatedCollapse } from '../motion/animated-collapse';
import './knowledge-workspace.css';
import './global-knowledge-workspace.css';

interface Props {
  page: GlobalKnowledgePage; query: GlobalKnowledgeQuery; busy: boolean; loading: boolean; error: string;
  onQuery: (query: GlobalKnowledgeQuery) => void; onAction: (action: GlobalKnowledgeAction) => Promise<boolean>;
  onExtract: () => void; onSettings: () => void; onRetry: () => void; onDirtyChange: (dirty: boolean) => void;
  onUse?: (entry: GlobalKnowledgeEntry) => Promise<boolean>;
}
interface Draft { id: string | null; body: string; source: string; categoryId: string; tagIds: string[] }
export function GlobalKnowledgeWorkspace(props: Props) {
  const { page, query } = props;
  const categories = page.categories.filter(item => !item.deletedAt), tags = page.tags.filter(item => !item.deletedAt);
  const [open, setOpen] = useState<string | null>(null), [collapsed, collapse] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null), [baseline, setBaseline] = useState('');
  const [dialog, setDialog] = useState<StructureDialogState | null>(null), [notice, setNotice] = useState('');
  const [using, setUsing] = useState(false), [tagDraft, setTagDraft] = useState<string | null>(null);
  const categoryTrigger = useRef<HTMLButtonElement>(null);
  const dirty = !!draft && JSON.stringify(draft) !== baseline || tagDraft !== null && !!tagDraft.trim() || props.busy || using;
  useEffect(() => { props.onDirtyChange(dirty); }, [dirty, props.onDirtyChange]);
  useEffect(() => () => props.onDirtyChange(false), [props.onDirtyChange]);
  const locked = props.busy || using, editing = !!draft || tagDraft !== null;
  function filter(next: Partial<GlobalKnowledgeQuery>) { if (!editing && !locked) props.onQuery({ ...query, ...next, offset: next.offset ?? 0 }); }
  function edit(entry?: GlobalKnowledgeEntry) {
    const next: Draft = entry ? { id: entry.id, body: entry.body, source: readableKnowledgeSource(entry.source), categoryId: entry.categoryId, tagIds: [...entry.tagIds] }
      : { id: null, body: '', source: '', categoryId: query.categoryId ?? categories.find(item => item.systemKey === 'uncategorized')?.id ?? categories[0]?.id ?? '', tagIds: [] };
    setDraft(next); setBaseline(JSON.stringify(next)); setNotice('');
  }
  async function save() {
    if (!draft?.body.trim() || !draft.categoryId || locked) return;
    const { id, ...body } = draft;
    if (id) body.source = replaceKnowledgeSource(page.entries.find(entry => entry.id === id)?.source ?? '', body.source);
    if (await props.onAction(id ? { type: 'updateKnowledge', id, ...body } : { type: 'createKnowledge', ...body })) { setDraft(null); setNotice('知识已保存，所有作品均可检索。'); }
  }
  async function use(entry: GlobalKnowledgeEntry) {
    if (!props.onUse || locked) return;
    setUsing(true); setNotice('');
    try { if (await props.onUse(entry)) setNotice('已复制到当前作品并保留来源，可在写作工具中选作 AI 参考。'); }
    finally { setUsing(false); }
  }
  const offset = query.offset ?? 0, limit = query.limit ?? 20;
  return <section className="knowledge-workspace global-knowledge" aria-label="全局知识库">
    <div className="knowledge-heading"><p>{page.total} 条知识 · 所有作品可用</p><div><button className="secondary" disabled={locked || editing} onClick={props.onSettings}>分类管理</button><button className="secondary" disabled={locked || editing} onClick={props.onExtract}>拆书工具</button><button className="primary" disabled={locked || editing || !categories.length} onClick={() => edit()}>新增知识</button></div></div>
    <div className={`knowledge-layout ${collapsed ? 'is-collapsed' : ''}`}>
      <AnimatedCollapse open={!collapsed} triggerRef={categoryTrigger}><nav className="knowledge-categories" aria-label="全局知识分类"><strong>知识分类</strong><button aria-pressed={!query.categoryId} disabled={locked || editing} onClick={() => filter({ categoryId: null })}>全部知识</button>{categories.map(item => <button key={item.id} disabled={locked || editing} aria-pressed={query.categoryId === item.id} onClick={() => filter({ categoryId: item.id })}>{item.parentId ? '↳ ' : ''}{item.name}</button>)}</nav></AnimatedCollapse>
      <div className="knowledge-content"><div className="knowledge-toolbar"><div className="knowledge-search"><button ref={categoryTrigger} className="secondary" aria-expanded={!collapsed} onClick={() => collapse(value => !value)}>{collapsed ? '展开分类' : '收起分类'}</button><input type="search" aria-label="搜索全局知识" placeholder="搜索描写、出处、标签" value={query.text ?? ''} maxLength={2000} disabled={editing || locked} onChange={event => filter({ text: event.target.value })} /></div></div>
        <div className="knowledge-filter-tags" aria-label="全局标签筛选"><span>标签一览</span>{tags.map(tag => <button key={tag.id} disabled={locked || editing} aria-pressed={query.tagIds?.includes(tag.id) ?? false} onClick={() => filter({ tagIds: query.tagIds?.includes(tag.id) ? query.tagIds.filter(id => id !== tag.id) : [...query.tagIds ?? [], tag.id] })}>{tag.name}</button>)}<button disabled={locked || editing} onClick={() => setTagDraft('')}>＋ 添加标签</button></div>
        {tagDraft !== null && <form className="global-inline-tag" onSubmit={event => { event.preventDefault(); if (tagDraft.trim()) void props.onAction({ type: 'createTag', name: tagDraft.trim() }).then(ok => { if (ok) setTagDraft(null); }); }}><input aria-label="全局标签名称" maxLength={100} value={tagDraft} disabled={locked} onChange={event => setTagDraft(event.target.value)} /><button disabled={locked || !tagDraft.trim()}>添加</button><button type="button" disabled={locked} onClick={() => setTagDraft(null)}>取消</button></form>}
        {props.error && <p role="alert">{props.error}<button disabled={locked || editing} onClick={props.onRetry}>重试读取</button></p>}{notice && <p role="status">{notice}</p>}
        {draft && <form className="knowledge-form" onSubmit={event => { event.preventDefault(); void save(); }}><h2>{draft.id ? '编辑知识' : '新增知识'}</h2><label>知识内容<textarea value={draft.body} disabled={locked} onChange={event => setDraft({ ...draft, body: event.target.value })} required /></label><label>出处<input value={draft.source} disabled={locked} onChange={event => setDraft({ ...draft, source: event.target.value })} /></label><label>分类<SelectField value={draft.categoryId} disabled={locked} onChange={event => setDraft({ ...draft, categoryId: event.target.value })}>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField></label><fieldset disabled={locked}><legend>标签</legend>{tags.map(tag => <label key={tag.id}><input type="checkbox" checked={draft.tagIds.includes(tag.id)} onChange={() => setDraft({ ...draft, tagIds: draft.tagIds.includes(tag.id) ? draft.tagIds.filter(id => id !== tag.id) : [...draft.tagIds, tag.id] })} />{tag.name}</label>)}</fieldset><div className="knowledge-form-actions"><button type="button" className="secondary" disabled={locked} onClick={() => setDraft(null)}>取消</button><button className="primary" disabled={locked || !draft.body.trim()}>保存知识</button></div></form>}
        <div className="knowledge-results" aria-busy={props.loading}>{props.loading ? <p role="status">正在读取全局知识…</p> : <div className="knowledge-grid"><AnimatePresence initial={false}>{page.entries.map(entry => <m.article layout="position" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .985 }} key={entry.id} className="knowledge-entry"><button className={`knowledge-snippet ${open === entry.id ? '' : 'is-collapsed'}`} aria-expanded={open === entry.id} onClick={() => setOpen(open === entry.id ? null : entry.id)}>{entry.body}</button><div className="knowledge-entry-bottom"><div className="knowledge-entry-actions">{props.onUse && <button disabled={locked || editing} onClick={() => void use(entry)}>用于当前作品</button>}<button disabled={locked || editing} onClick={() => edit(entry)}>编辑</button><button disabled={locked || editing} onClick={() => setDialog({ heading: '删除知识', description: '删除后不再参与全局检索，已有作品副本和历史出处继续保留。', submitLabel: '确认删除', onSubmit: () => props.onAction({ type: 'deleteKnowledge', id: entry.id }) })}>删除</button></div><div className="knowledge-source"><span>{readableKnowledgeSource(entry.source) || '未注明出处'}</span></div></div><AnimatedCollapse open={open === entry.id}><div className="global-knowledge-notes"><small>全局知识 · 版本 {entry.revision}</small>{entry.tagIds.map(id => <span className="global-tag" key={id}>{tags.find(tag => tag.id === id)?.name}</span>)}{page.annotations.filter(item => item.entryId === entry.id).map(item => <dl key={item.id}><dt>写作手法</dt><dd>{item.technique}</dd><dt>适用场景</dt><dd>{item.usage}</dd><dt>仿写练习</dt><dd>{item.exercise}</dd></dl>)}</div></AnimatedCollapse></m.article>)}</AnimatePresence></div>}{!props.loading && !page.total && <div className="empty-state"><h2>{query.text || query.categoryId || query.tagIds?.length ? '没有匹配的知识' : '建立你的写作储备'}</h2><p>从拆书工具摘选真实原句，逐条审核后供所有作品使用。</p></div>}</div>
        <nav className="knowledge-pagination" aria-label="全局知识分页"><span>共 {page.total} 条</span><button disabled={locked || editing || props.loading || offset === 0} onClick={() => filter({ offset: Math.max(0, offset - limit) })}>上一页</button><span>{Math.floor(offset / limit) + 1} / {Math.max(1, Math.ceil(page.total / limit))}</span><button disabled={locked || editing || props.loading || offset + limit >= page.total} onClick={() => filter({ offset: offset + limit })}>下一页</button></nav>
      </div>
    </div><AnimatePresence>{dialog && <StructureDialog key="global-knowledge-delete" state={dialog} busy={locked} onClose={() => setDialog(null)} />}</AnimatePresence>
  </section>;
}
