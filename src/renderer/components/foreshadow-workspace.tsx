import { SelectField } from './select-field';
import { useState } from 'react';
import type { Evidence, EvidenceKind, Foreshadow, ForeshadowStatus } from '../../shared/assets';
import { StructureDialog } from './structure-dialog';
import { useAssetAction, type AssetWorkspaceProps } from './plot-workspace';
const statuses: ForeshadowStatus[] = ['未埋设', '已埋设', '已触发', '已回收', '废弃'];
export function ForeshadowWorkspace(props: AssetWorkspaceProps) {
  const items = props.assets.foreshadows.filter((item) => !item.deletedAt);
  const [selection, setSelection] = useState({ id: props.selectedId ?? items[0]?.id ?? '', externalId: props.selectedId });
  const [name, setName] = useState('');
  const [childDirty, setChildDirty] = useState(false);
  const action = useAssetAction(props, childDirty || !!name.trim());
  const selectedId = props.selectedId !== selection.externalId && !childDirty && !name.trim() ? props.selectedId : selection.id;
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  return <section className="assets-workspace" aria-label="伏笔架构">
    <aside className="assets-tree"><h2>伏笔</h2><form className="asset-form" onSubmit={(event) => { event.preventDefault(); if (childDirty) { action.setError('请先保存或放弃当前更改。'); return; } if (name.trim()) void action.execute({ type: 'createForeshadow', name: name.trim() }).then((success) => { if (success) setName(''); }); }}><label>新伏笔名称<input value={name} disabled={action.locked} onChange={(event) => setName(event.target.value)} /></label><button className="primary" disabled={action.locked || !name.trim()}>添加伏笔</button>{name && <button type="button" className="secondary" disabled={action.locked} onClick={() => setName('')}>放弃新增</button>}</form>
      {items.map((item) => <button key={item.id} className="asset-list-item" aria-label={`选择伏笔：${item.name}`} aria-current={selected?.id === item.id ? 'true' : undefined} disabled={action.locked} onClick={() => { if (childDirty || name.trim()) action.setError('请先保存或放弃当前更改，再切换伏笔。'); else { setSelection({ id: item.id, externalId: props.selectedId }); action.setError(''); } }}><span>{item.name}</span><small>{item.status}</small></button>)}{!items.length && <p>尚无伏笔，添加后记录埋设、触发与回收。</p>}
      {props.assets.foreshadows.some((item) => item.deletedAt) && <details className="asset-picker"><summary>已删除伏笔</summary>{props.assets.foreshadows.filter((item) => item.deletedAt).map((item) => <div key={item.id} className="asset-buttons"><span>{item.name}</span><button className="secondary" disabled={action.locked || childDirty} onClick={() => void action.execute({ type: 'restoreForeshadow', id: item.id })}>恢复伏笔</button></div>)}</details>}
    </aside>
    <div className="assets-detail">{action.error && <p role="alert" className="asset-error">{action.error}</p>}{selected && <ForeshadowDetails key={`${selected.id}/${selected.name}/${selected.status}/${selected.description}/${selected.outlineId}`} {...props} hint={selected} onDirtyChange={setChildDirty} />}</div>
  </section>;
}

function ForeshadowDetails(props: AssetWorkspaceProps & { hint: Foreshadow }) {
  const { hint } = props;
  const [name, setName] = useState(hint.name);
  const [status, setStatus] = useState(hint.status);
  const [description, setDescription] = useState(hint.description);
  const [outlineId, setOutlineId] = useState(hint.outlineId ?? '');
  const [dirty, setDirty] = useState(false);
  const [evidenceDirty, setEvidenceDirty] = useState(false);
  const [editingEvidence, setEditingEvidence] = useState<Evidence | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const action = useAssetAction(props, dirty || evidenceDirty);
  const evidence = props.assets.evidence.filter((item) => item.foreshadowId === hint.id && !item.deletedAt && !item.supersededBy);
  return <>
    <form className="asset-form" onSubmit={(event) => { event.preventDefault(); if (evidenceDirty) { action.setError('请先保存或放弃证据更改。'); return; } if (name.trim()) void action.execute({ type: 'updateForeshadow', id: hint.id, name: name.trim(), status, description, outlineId: outlineId || null }).then((success) => { if (success) setDirty(false); }); }}>
      <h2>伏笔详情</h2>{action.error && <p role="alert" className="asset-error">{action.error}</p>}
      <label>伏笔名称<input value={name} disabled={action.locked} onChange={(event) => { setName(event.target.value); setDirty(true); }} required /></label>
      <label>伏笔状态<SelectField value={status} disabled={action.locked} onChange={(event) => { setStatus(event.target.value as ForeshadowStatus); setDirty(true); }}>{statuses.map((item) => <option key={item}>{item}</option>)}</SelectField></label>
      <p className="asset-hint">人工改变状态不自动生成或删除证据。</p>
      <label>归属剧情节点<SelectField value={outlineId} disabled={action.locked} onChange={(event) => { setOutlineId(event.target.value); setDirty(true); }}><option value="">未归属</option>{props.assets.outlines.filter((item) => !item.deletedAt).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</SelectField></label>
      <button type="button" className="secondary" disabled={action.locked || dirty || evidenceDirty || !hint.outlineId || !props.onSelectOutline || !props.assets.outlines.some((item) => !item.deletedAt && item.id === hint.outlineId)} onClick={() => hint.outlineId && props.onSelectOutline?.(hint.outlineId)}>定位剧情节点</button>
      <label>伏笔说明<textarea value={description} disabled={action.locked} onChange={(event) => { setDescription(event.target.value); setDirty(true); }} /></label>
      <div className="asset-buttons"><button className="primary" disabled={action.locked || !name.trim()}>保存伏笔</button><button type="button" className="secondary" disabled={action.locked} onClick={() => { setName(hint.name); setStatus(hint.status); setDescription(hint.description); setOutlineId(hint.outlineId ?? ''); setDirty(false); action.setError(''); }}>放弃更改</button><button type="button" className="secondary" disabled={action.locked || dirty || evidenceDirty} onClick={() => setConfirmDelete(true)}>删除伏笔</button></div>
    </form>
    <section className="asset-evidence" aria-label="埋设、触发与回收证据"><h3>埋设、触发与回收证据</h3>{!evidence.length && <p>尚无证据</p>}{evidence.map((item) => { const chapter = props.work.chapters.find((candidate) => candidate.id === item.chapterId); const paragraphNumber = chapter?.document.content.findIndex((paragraph) => paragraph.attrs.id === item.paragraphId); return <div key={item.id} className="asset-evidence-card"><strong>{item.kind}</strong><p className="asset-evidence-location">{chapter?.title ?? '已删除章节'} · {paragraphNumber !== undefined && paragraphNumber >= 0 ? `第 ${paragraphNumber + 1} 段` : '章节位置'}</p><p className="asset-evidence-excerpt">{item.excerpt || '无摘录'}</p>{!item.valid && <p className="asset-error">证据失效：{item.invalidReason ?? '来源不可用'}，原出处仍保留。</p>}<details className="asset-evidence-history"><summary>查看历史追溯</summary><p>原出处：{item.originalSource.chapterTitle} · 版本 {item.originalSource.revision}</p><p>章节 ID：{item.originalSource.chapterId} · 段落 ID：{item.originalSource.paragraphId || '无'}</p><p>原出处摘录：{item.originalSource.excerpt || '无摘录'}</p><p>当前来源版本：{item.sourceRevision}</p></details><div className="asset-buttons"><button className="secondary" aria-label={`定位证据：${item.excerpt}`} disabled={action.locked || dirty || evidenceDirty || !item.valid} onClick={() => props.onLocate(item.chapterId, item.paragraphId ?? undefined)}>定位</button><button className="secondary" aria-label={`重新关联证据：${item.excerpt}`} disabled={action.locked || dirty || evidenceDirty} onClick={() => setEditingEvidence(item)}>重新关联</button><button className="secondary" aria-label={`删除证据：${item.excerpt}`} disabled={action.locked || dirty || evidenceDirty} onClick={() => void action.execute({ type: 'deleteEvidence', id: item.id })}>删除证据</button></div></div>; })}</section>
    <EvidenceForm key={editingEvidence?.id ?? 'new'} {...props} busy={action.locked || dirty} hintId={hint.id} evidence={editingEvidence} onDirtyChange={setEvidenceDirty} onFinished={() => setEditingEvidence(null)} />
    {confirmDelete && <StructureDialog busy={action.locked} onClose={() => setConfirmDelete(false)} state={{ heading: '删除伏笔', description: '伏笔可从已删除列表恢复；当前关联将按规则清理，历史证据保留。', submitLabel: '确认删除', onSubmit: () => action.execute({ type: 'deleteForeshadow', id: hint.id }) }} />}
  </>;
}

function EvidenceForm(props: AssetWorkspaceProps & { hintId: string; evidence: Evidence | null; onFinished: () => void }) {
  const [chapterId, setChapterId] = useState(props.evidence?.chapterId ?? '');
  const [paragraphId, setParagraphId] = useState(props.evidence?.paragraphId ?? '');
  const [excerpt, setExcerpt] = useState(props.evidence?.excerpt ?? '');
  const [kind, setKind] = useState<EvidenceKind>(props.evidence?.kind ?? '埋设');
  const [dirty, setDirty] = useState(false);
  const action = useAssetAction(props, dirty);
  const chapter = props.work.chapters.find((item) => item.id === chapterId);
  async function submit() {
    if (!chapter || (paragraphId && !chapter.document.content.some((item) => item.attrs.id === paragraphId))) { action.setError('请选择当前可用的章节和段落。'); return; }
    const success = await action.execute(props.evidence ? { type: 'relinkEvidence', id: props.evidence.id, chapterId, paragraphId: paragraphId || null, excerpt }
      : { type: 'addEvidence', foreshadowId: props.hintId, kind, chapterId, paragraphId: paragraphId || null, excerpt });
    if (success) { setChapterId(''); setParagraphId(''); setExcerpt(''); setDirty(false); props.onFinished(); }
  }
  return <form className="asset-form asset-evidence-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}><h3>{props.evidence ? '重新关联证据' : '添加证据'}</h3>{action.error && <p role="alert" className="asset-error">{action.error}</p>}
    {!props.evidence && <label>证据阶段<SelectField value={kind} disabled={action.locked} onChange={(event) => { setKind(event.target.value as EvidenceKind); setDirty(true); }}>{(['埋设', '触发', '回收'] as const).map((item) => <option key={item}>{item}</option>)}</SelectField></label>}
    <label>证据章节<SelectField value={chapterId} disabled={action.locked} onChange={(event) => { setChapterId(event.target.value); setParagraphId(''); setDirty(true); }}><option value="">请选择章节</option>{props.work.chapters.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</SelectField></label>
    <label>证据段落<SelectField value={paragraphId} disabled={action.locked || !chapter} onChange={(event) => { setParagraphId(event.target.value); setDirty(true); }}><option value="">仅关联章节</option>{chapter?.document.content.map((item, index) => <option key={item.attrs.id} value={item.attrs.id}>第 {index + 1} 段 · {item.content?.map((inline) => inline.type === 'text' ? inline.text : '').join('').slice(0, 45)}</option>)}</SelectField></label>
    <label>证据摘录<textarea value={excerpt} disabled={action.locked} onChange={(event) => { setExcerpt(event.target.value); setDirty(true); }} /></label>
    <div className="asset-buttons"><button className="primary" disabled={action.locked || !chapter}>{props.evidence ? '确认重新关联' : '添加证据'}</button><button type="button" className="secondary" disabled={action.locked} onClick={() => { setChapterId(''); setParagraphId(''); setExcerpt(''); setDirty(false); action.setError(''); props.onFinished(); }}>放弃证据更改</button></div>
  </form>;
}
