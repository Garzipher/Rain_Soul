import { useEffect, useRef, useState } from 'react';
import type { AssetAction, AssetState, Category, KnowledgeTag } from '../../shared/assets';
import { StructureDialog } from './structure-dialog';

interface CategoryDraft { id: string | null; name: string; parentId: string | null }
export interface KnowledgeDictionaryProps {
  assets: AssetState;
  busy: boolean;
  onAction: (action: AssetAction) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
}

export function KnowledgeDictionary({ assets, busy, onAction, onDirtyChange }: KnowledgeDictionaryProps) {
  const categories = assets.categories.filter(item => !item.deletedAt);
  const tags = assets.tags.filter(item => !item.deletedAt);
  const knowledge = assets.knowledge.filter(item => !item.deletedAt);
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [tagBaseline, setTagBaseline] = useState('');
  const [deleteCategory, setDeleteCategory] = useState<Category | null>(null);
  const [deleteTag, setDeleteTag] = useState<KnowledgeTag | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const [busyAction, setBusyAction] = useState(false);
  const disabled = busy || busyAction;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const hasDraftChanges = (!!draft && JSON.stringify(draft) !== baseline) || (tagDraft !== null && tagDraft !== tagBaseline);
  const dirty = hasDraftChanges || busyAction;
  const dictionaryLocked = disabled || hasDraftChanges;
  const orderedCategories = (parentId: string | null, depth = 0): { item: Category; depth: number; first: boolean; last: boolean }[] => {
    const siblings = categories.filter(item => item.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
    return siblings.flatMap((item, index) => [{ item, depth, first: index === 0, last: index === siblings.length - 1 }, ...orderedCategories(item.id, depth + 1)]);
  };
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  function descendants(id: string): Set<string> {
    const result = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of categories) if (item.parentId === id || (item.parentId && result.has(item.parentId))) {
        if (!result.has(item.id)) { result.add(item.id); changed = true; }
      }
    }
    return result;
  }
  function openCategory(item?: Category) {
    if (dictionaryLocked) return;
    setError(null); setNotice(null);
    const next = item ? { id: item.id, name: item.name, parentId: item.parentId } : { id: null, name: '', parentId: null };
    setDraft(next); setBaseline(JSON.stringify(next));
  }
  function openTag() { if (dictionaryLocked) return; setError(null); setNotice(null); setTagDraft(''); setTagBaseline(''); }
  async function operate(action: AssetAction): Promise<boolean> {
    if (busy || lock.current) return false;
    lock.current = true; setBusyAction(true); setError(null); setNotice(null);
    try {
      const success = await onAction(action);
      if (!success) setError('操作未完成，内容仍保留，请检查后重试。');
      return success;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，内容仍保留，请重试。');
      return false;
    } finally { lock.current = false; setBusyAction(false); }
  }
  async function saveCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const name = draft.name.trim();
    if (!name || categories.some(item => item.id !== draft.id && item.parentId === draft.parentId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError('同一层级下的分类名称必须唯一。'); return;
    }
    if (draft.id && descendants(draft.id).has(draft.parentId ?? '')) { setError('不能将分类移动到自身或其下级分类中。'); return; }
    const action: AssetAction = draft.id ? { type: 'updateCategory', id: draft.id, name, parentId: draft.parentId } : { type: 'createCategory', name, parentId: draft.parentId };
    if (await operate(action)) { setDraft(null); setError(null); }
  }
  async function saveTag(event: React.FormEvent) {
    event.preventDefault();
    const name = tagDraft?.trim();
    if (!name || tags.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { setError('标签名称不能为空且不能重复。'); return; }
    if (await operate({ type: 'createTag', name })) { setTagDraft(null); setError(null); }
  }
  const usedTag = deleteTag ? knowledge.some(item => item.tagIds.includes(deleteTag.id)) : false;
  const categoryChildren = deleteCategory ? categories.filter(item => item.parentId === deleteCategory.id) : [];
  const categoryEntries = deleteCategory ? knowledge.filter(item => item.categoryId === deleteCategory.id) : [];
  const deleteTargets = deleteCategory ? categories.filter(item => item.id !== deleteCategory.id && !descendants(deleteCategory.id).has(item.id)) : [];

  return <section className="knowledge-dictionary" aria-label="知识分类与标签维护">
    <div><h2>知识分类</h2><p>按层级整理人物描写、景物描写、内心描写、经典引用等知识。</p>
      <div className="knowledge-dictionary-list">{orderedCategories(null).map(({ item, depth, first, last }) => <div className="knowledge-dictionary-row" key={item.id}>
        <span style={{ paddingInlineStart: depth * 22 }}>{depth ? '↳ ' : ''}{item.name}</span>
        <div><button type="button" aria-label={`上移分类：${item.name}`} disabled={dictionaryLocked || first} onClick={() => void operate({ type: 'moveCategory', id: item.id, direction: 'up' })}>上移</button><button type="button" aria-label={`下移分类：${item.name}`} disabled={dictionaryLocked || last} onClick={() => void operate({ type: 'moveCategory', id: item.id, direction: 'down' })}>下移</button><button type="button" disabled={dictionaryLocked} onClick={() => openCategory(item)}>编辑分类：{item.name}</button><button type="button" aria-label={`删除分类：${item.name}`} disabled={dictionaryLocked || item.systemKey === 'uncategorized'} onClick={() => { setError(null); setDeleteCategory(item); setDestinationId(''); }}>删除</button></div>
      </div>)}</div>
      {draft && <form onSubmit={event => void saveCategory(event)}><h3>{draft.id ? '编辑分类' : '新增分类'}</h3>
        <label>分类名称<input aria-label="分类名称" value={draft.name} disabled={disabled} onChange={event => setDraft({ ...draft, name: event.target.value })} required /></label>
        <label>上级分类<select aria-label="上级分类" value={draft.parentId ?? ''} disabled={disabled} onChange={event => setDraft({ ...draft, parentId: event.target.value || null })}><option value="">顶级分类</option>{categories.filter(item => item.id !== draft.id && !descendants(draft.id ?? '').has(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div><button type="button" disabled={disabled} onClick={() => setDraft(null)}>取消</button><button type="submit" disabled={disabled || !draft.name.trim()}>{busyAction ? '正在保存…' : '保存分类'}</button></div>
      </form>}
      {!draft && <button type="button" disabled={dictionaryLocked} onClick={() => openCategory()}>新增分类</button>}
    </div>
    <div><h2>知识标签</h2><p>标签可组合筛选；删除标签只解除知识与该标签的关联。</p>
      <div className="knowledge-dictionary-list">{tags.map(item => <div className="knowledge-dictionary-row" key={item.id}><span>{item.name}</span><button type="button" aria-label={`删除标签：${item.name}`} disabled={dictionaryLocked} onClick={() => { setError(null); setDeleteTag(item); }}>删除</button></div>)}</div>
      {tagDraft !== null && <form onSubmit={event => void saveTag(event)}><h3>新增标签</h3><label>标签名称<input aria-label="标签名称" value={tagDraft} disabled={disabled} onChange={event => setTagDraft(event.target.value)} required /></label><div><button type="button" disabled={disabled} onClick={() => setTagDraft(null)}>取消</button><button type="submit" disabled={disabled || !tagDraft.trim() || tags.some(item => item.name.toLocaleLowerCase() === tagDraft.trim().toLocaleLowerCase())}>保存标签</button></div></form>}
      {tagDraft === null && <button type="button" disabled={dictionaryLocked} onClick={openTag}>新增标签</button>}
    </div>
    {hasDraftChanges && <p role="status">请先保存或取消当前草稿，再操作其他分类或标签。</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {deleteCategory && <StructureDialog role="alertdialog" busy={disabled} submitDisabled={!!categoryChildren.length || (categoryEntries.length > 0 && !destinationId)} onClose={() => setDeleteCategory(null)} state={{
      heading: `删除分类：${deleteCategory.name}`, description: categoryEntries.length ? `此分类下有 ${categoryEntries.length} 条知识，确认后先迁移知识，再删除分类。` : '删除后无法恢复分类。',
      submitLabel: categoryEntries.length ? '确认迁移并删除分类' : '确认删除分类', onSubmit: () => operate({ type: 'deleteCategory', id: deleteCategory.id, destinationId: categoryEntries.length ? destinationId : null }),
    }}>{categoryChildren.length ? <p role="alert">该分类有子分类，请先处理子分类。</p> : categoryEntries.length > 0 && <label>迁移到分类<select aria-label="迁移到分类" value={destinationId} disabled={disabled} onChange={event => setDestinationId(event.target.value)}><option value="">选择目标分类</option>{deleteTargets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</StructureDialog>}
    {deleteTag && <StructureDialog role="alertdialog" busy={disabled} onClose={() => setDeleteTag(null)} state={{
      heading: `删除标签：${deleteTag.name}`, description: usedTag ? '此标签会从知识条目解除关联，知识内容和其他标签会保留。' : '删除该标签。', submitLabel: '确认删除标签',
      onSubmit: async () => { const success = await operate({ type: 'deleteTag', id: deleteTag.id }); if (success) setNotice(usedTag ? '标签已删除，相关知识内容已保留。' : '标签已删除。'); return success; },
    }} />}
  </section>;
}
