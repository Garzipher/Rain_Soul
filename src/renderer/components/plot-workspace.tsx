import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AssetAction, AssetState, OutlineKind, OutlineNode } from '../../shared/assets';
import type { WorkDetail } from '../../shared/contracts';
import { StructureDialog } from './structure-dialog';
import { readableKnowledgeSource } from '../../shared/knowledge-source';
import './assets-workspace.css';
export interface AssetWorkspaceProps {
  work: WorkDetail; assets: AssetState; busy: boolean;
  onAction: (action: AssetAction) => Promise<boolean>;
  onLocate: (chapterId: string, paragraphId?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSelectOutline?: (id: string) => void;
  onSelectForeshadow?: (id: string) => void;
  selectedId?: string;
}

/** 独立动作锁防双击；失败只提示，不自动重发。 */
export function useAssetAction(props: AssetWorkspaceProps, dirty = false) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const notification = useRef(props.onDirtyChange);
  notification.current = props.onDirtyChange;
  useEffect(() => { notification.current?.(dirty || pending); }, [dirty, pending]);
  useEffect(() => () => { notification.current?.(false); }, []);
  async function execute(action: AssetAction) {
    if (inFlight.current || props.busy) return false;
    inFlight.current = true; setPending(true); setError('');
    try {
      const success = await props.onAction(action);
      if (!success) setError('操作失败，输入已保留，请检查提示后手动重试。');
      return success;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，输入已保留。');
      return false;
    } finally { inFlight.current = false; setPending(false); }
  }
  return { execute, error, setError, locked: props.busy || pending, pending };
}

export function PlotWorkspace(props: AssetWorkspaceProps) {
  const nodes = props.assets.outlines.filter((node) => !node.deletedAt);
  const [selection, setSelection] = useState({ id: props.selectedId ?? nodes[0]?.id ?? '', externalId: props.selectedId });
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [creating, setCreating] = useState<{ kind: OutlineKind; parentId: string | null } | null>(null);
  const [title, setTitle] = useState('');
  const [childDirty, setChildDirty] = useState(false);
  const parent = useAssetAction(props, childDirty || !!title.trim());
  const selectedId = props.selectedId !== selection.externalId && !childDirty ? props.selectedId : selection.id;
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  function select(id: string) {
    if (childDirty || title.trim()) { parent.setError('请先保存或放弃当前更改，再切换剧情节点。'); return; }
    setCreating(null); setSelection({ id, externalId: props.selectedId }); parent.setError('');
  }
  function create(kind: OutlineKind, parentId: string | null) {
    if (childDirty || title.trim()) { parent.setError('请先保存或放弃当前更改。'); return; }
    setCreating({ kind, parentId });
  }
  const tree = (parentId: string | null): ReactNode => nodes.filter((node) => node.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder).map((node) => <div key={node.id} className="asset-tree-node">
      <div className="asset-tree-row">
        {nodes.some((item) => item.parentId === node.id) && <button type="button" aria-label={`${collapsed.includes(node.id) ? '展开' : '收起'}剧情：${node.title}`} aria-expanded={!collapsed.includes(node.id)} onClick={() => setCollapsed((items) => items.includes(node.id) ? items.filter((id) => id !== node.id) : [...items, node.id])}>{collapsed.includes(node.id) ? '›' : '⌄'}</button>}
        <button type="button" aria-label={`选择剧情：${node.title}`} aria-current={selected?.id === node.id ? 'true' : undefined} disabled={parent.locked} onClick={() => select(node.id)}>{node.title}</button>
      </div>
      {!collapsed.includes(node.id) && tree(node.id)}
    </div>);
  return <section className="assets-workspace" aria-label="剧情架构">
    <aside className="assets-tree"><h2>剧情节点</h2><div className="asset-buttons"><button className="secondary" disabled={parent.locked} onClick={() => create('volume', null)}>新增卷节点</button><button className="secondary" disabled={parent.locked} onClick={() => create('chapter', selected?.type === 'volume' ? selected.id : null)}>新增章节点</button><button className="secondary" disabled={parent.locked || !selected || selected.type === 'volume'} onClick={() => create('detail', selected?.type === 'chapter' ? selected.id : selected?.parentId ?? null)}>新增详细节点</button></div>{tree(null)}{!nodes.length && <p>尚无剧情节点，从卷或章开始。</p>}</aside>
    <div className="assets-detail">
      {parent.error && <p role="alert" className="asset-error">{parent.error}</p>}
      {creating ? <form className="asset-form" onSubmit={(event) => { event.preventDefault(); if (title.trim()) void parent.execute({ type: 'createOutline', ...creating, title: title.trim() }).then((success) => { if (success) { setTitle(''); setCreating(null); } }); }}><h2>新增剧情节点</h2><label>节点名称<input autoFocus value={title} disabled={parent.locked} onChange={(event) => setTitle(event.target.value)} required /></label><div className="asset-buttons"><button className="primary" disabled={parent.locked || !title.trim()}>创建节点</button><button type="button" className="secondary" disabled={parent.locked} onClick={() => { setTitle(''); setCreating(null); }}>放弃更改</button></div></form>
        : selected && <PlotDetails key={`${selected.id}/${selected.title}/${selected.summary}/${selected.chapterId}`} {...props} node={selected} onDirtyChange={setChildDirty} />}
    </div>
  </section>;
}

function PlotDetails(props: AssetWorkspaceProps & { node: OutlineNode }) {
  const { node } = props;
  const [title, setTitle] = useState(node.title);
  const [summary, setSummary] = useState(node.summary);
  const [chapterId, setChapterId] = useState(node.chapterId ?? '');
  const [dirty, setDirty] = useState(false);
  const action = useAssetAction(props, dirty);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [knowledge, setKnowledge] = useState(node.knowledgeIds);
  const [hints, setHints] = useState(props.assets.foreshadows.filter((item) => !item.deletedAt && item.outlineId === node.id).map((item) => item.id));
  const entries = props.assets.knowledge.filter((entry) => !entry.deletedAt);
  const foreshadows = props.assets.foreshadows.filter((item) => !item.deletedAt);
  async function associate(kind: 'knowledge' | 'hint', id: string, checked: boolean) {
    if (dirty) { action.setError('请先保存或放弃节点更改，再维护关联。'); return; }
    const previous = kind === 'knowledge' ? knowledge : hints;
    const next = checked ? [...previous.filter((item) => item !== id), id] : previous.filter((item) => item !== id);
    const set = kind === 'knowledge' ? setKnowledge : setHints;
    set(next);
    const success = await action.execute(kind === 'knowledge' ? { type: 'setOutlineKnowledge', id: node.id, knowledgeIds: next } : { type: 'assignForeshadows', id: node.id, foreshadowIds: next });
    if (!success) set(previous);
  }
  return <>
    <form className="asset-form" onSubmit={(event) => { event.preventDefault(); if (title.trim()) void action.execute({ type: 'updateOutline', id: node.id, title: title.trim(), summary, chapterId: chapterId || null }).then((success) => { if (success) setDirty(false); }); }}>
      <h2>剧情内容</h2>
      {action.error && <p role="alert" className="asset-error">{action.error}</p>}
      <label>节点名称<input value={title} disabled={action.locked} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} required /></label>
      <label>剧情摘要<textarea value={summary} disabled={action.locked} onChange={(event) => { setSummary(event.target.value); setDirty(true); }} /></label>
      <label>关联正文章节<select value={chapterId} disabled={action.locked} onChange={(event) => { setChapterId(event.target.value); setDirty(true); }}><option value="">未关联</option>{props.work.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select></label>
      <div className="asset-buttons"><button className="primary" disabled={action.locked || !title.trim()}>保存剧情</button><button type="button" className="secondary" disabled={action.locked} onClick={() => { setTitle(node.title); setSummary(node.summary); setChapterId(node.chapterId ?? ''); setDirty(false); action.setError(''); }}>放弃更改</button><button type="button" className="secondary" disabled={action.locked || !node.chapterId} onClick={() => node.chapterId && props.onLocate(node.chapterId)}>定位正文</button></div>
    </form>
    <div className="asset-buttons"><button className="secondary" disabled={action.locked || dirty} onClick={() => void action.execute({ type: 'moveOutline', id: node.id, direction: 'up' })}>节点上移</button><button className="secondary" disabled={action.locked || dirty} onClick={() => void action.execute({ type: 'moveOutline', id: node.id, direction: 'down' })}>节点下移</button><button className="secondary" disabled={action.locked || dirty} onClick={() => setConfirmDelete(true)}>删除剧情</button></div>
    <details className="asset-picker"><summary>关联知识</summary><div className="asset-picker-options">{entries.length ? entries.map((entry) => <label key={entry.id}><input type="checkbox" checked={knowledge.includes(entry.id)} disabled={action.locked || dirty} onChange={(event) => void associate('knowledge', entry.id, event.target.checked)} /><span>{entry.body}<small>{readableKnowledgeSource(entry.source)}</small></span></label>) : <p>当前作品尚无知识条目，请先在知识库添加。</p>}</div></details>
    <div className="asset-selected">{entries.filter((entry) => knowledge.includes(entry.id)).map((entry) => <div key={entry.id}><details><summary>{entry.body.slice(0, 50)}</summary><p>{entry.body}</p><small>{readableKnowledgeSource(entry.source)}</small></details><button className="secondary" aria-label={`移除知识：${entry.body}`} disabled={action.locked || dirty} onClick={() => void associate('knowledge', entry.id, false)}>移除</button></div>)}</div>
    <details className="asset-picker"><summary>关联伏笔</summary><div className="asset-picker-options">{foreshadows.length ? foreshadows.map((hint) => <label key={hint.id}><input type="checkbox" checked={hints.includes(hint.id)} disabled={action.locked || dirty} onChange={(event) => void associate('hint', hint.id, event.target.checked)} /><span>{hint.name}<small>{hint.outlineId === node.id ? '当前节点' : hint.outlineId ? `原归属：${props.assets.outlines.find((item) => item.id === hint.outlineId)?.title ?? '已删除节点'}；勾选后移到本节点` : '未归属；勾选后移到本节点'}</small></span></label>) : <p>尚无伏笔，请先在伏笔架构添加。</p>}</div></details>
    <div className="asset-selected">{foreshadows.filter((hint) => hints.includes(hint.id)).map((hint) => <div key={hint.id}><span>{hint.name} · {hint.status}</span>{props.onSelectForeshadow && <button className="secondary" aria-label={`定位伏笔：${hint.name}`} disabled={action.locked || dirty} onClick={() => props.onSelectForeshadow?.(hint.id)}>定位伏笔</button>}<button className="secondary" aria-label={`移除伏笔：${hint.name}`} disabled={action.locked || dirty} onClick={() => void associate('hint', hint.id, false)}>移除</button></div>)}</div>
    {confirmDelete && <StructureDialog busy={action.locked} onClose={() => setConfirmDelete(false)} state={{ heading: '删除剧情节点', description: '将删除本节点及子节点，解除关联；正文、知识与伏笔均保留。', submitLabel: '确认删除', onSubmit: () => action.execute({ type: 'deleteOutline', id: node.id }) }} />}
  </>;
}
