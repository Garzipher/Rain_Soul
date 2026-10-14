import { SelectField } from './select-field';
import { useRef, useState } from 'react';
import { readableKnowledgeSource } from '../../shared/knowledge-source';
import type { Category, KnowledgeEntry, KnowledgeTag } from '../../shared/assets';
import type { WorkDetail } from '../../shared/contracts';
import type { KnowledgeOwner, KnowledgeScope } from '../../shared/knowledge-scope';
import { StructureDialog } from './structure-dialog';

export interface KnowledgeCopyPreview {
  targetWorkId: string; targetTitle: string; targetRevision: number;
  owner: KnowledgeOwner; entry: KnowledgeEntry; sourceCategory: string; sourceTags: string[];
  categories: Category[]; tags: KnowledgeTag[]; matchedTagIds: string[]; unmatchedTags: string[];
}
export function categoryPath(id: string, categories: Category[]): string {
  const names: string[] = [], visited = new Set<string>();
  let item = categories.find(category => category.id === id);
  while (item && !visited.has(item.id)) {
    visited.add(item.id); names.unshift(item.name);
    item = categories.find(category => category.id === item!.parentId);
  }
  return names.join(' / ') || '未分类';
}
/** 读取来源专属字典，名称匹配仅映射目标已有标签；不将来源 ID 混入目标。 */
export function prepareKnowledgeCopy(target: WorkDetail, source: KnowledgeScope, owner: KnowledgeOwner): KnowledgeCopyPreview {
  if (target.id === owner.workId) throw new Error('此知识已属于当前作品，无需跨作品复制。');
  const entry = source.knowledge.find(item => item.id === owner.sourceEntryId && !item.deletedAt);
  if (!entry) throw new Error('来源知识已删除或不存在，请重新查看。');
  const freshOwner = source.entryOwners[entry.id];
  if (!freshOwner || freshOwner.workId !== owner.workId || freshOwner.sourceRevision !== owner.sourceRevision) throw new Error('来源作品已变化，请重新查看后确认复制。');
  const categories = target.assets?.categories.filter(item => !item.deletedAt) ?? [];
  if (!categories.length) throw new Error('当前作品没有有效目标分类，请先在设置维护。');
  const tags = target.assets?.tags.filter(item => !item.deletedAt) ?? [];
  const sourceTags = entry.tagIds.map(id => source.tags.find(tag => tag.id === id && !tag.deletedAt)?.name).filter((name): name is string => !!name);
  const normalize = (name: string) => name.normalize('NFC').toLocaleLowerCase();
  const matchedTagIds: string[] = [], unmatchedTags: string[] = [];
  for (const name of sourceTags) {
    const match = tags.find(tag => normalize(tag.name) === normalize(name));
    if (match) { if (!matchedTagIds.includes(match.id)) matchedTagIds.push(match.id); }
    else unmatchedTags.push(name);
  }
  return { targetWorkId: target.id, targetTitle: target.title, targetRevision: target.revision, owner, entry,
    sourceCategory: categoryPath(entry.categoryId, source.categories), sourceTags, categories, tags, matchedTagIds, unmatchedTags };
}
export function KnowledgeCopyDialog({ preview, busy, pending = false, onRetry, onConfirm, onClose }: {
  preview: KnowledgeCopyPreview; busy: boolean;
  pending?: boolean; onRetry?: () => void;
  onConfirm: (categoryId: string, tagIds: string[]) => Promise<boolean>; onClose: () => void;
}) {
  const [categoryId, setCategoryId] = useState(preview.categories.find(item => item.systemKey === 'uncategorized')?.id ?? preview.categories[0].id);
  const [tagIds, setTagIds] = useState(preview.matchedTagIds);
  const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const disabled = busy || working || pending;
  async function confirm() {
    if (disabled || lock.current) return false;
    lock.current = true; setWorking(true); setError(null);
    try {
      const success = await onConfirm(categoryId, tagIds);
      if (!success) setError('复制未完成，选择已保留，请检查提示后重试。');
      return success;
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : '复制失败'}；选择已保留。`); return false;
    } finally { lock.current = false; setWorking(false); }
  }
  return <StructureDialog busy={disabled} onClose={onClose} submitDisabled={!preview.categories.some(item => item.id === categoryId)} state={{
    heading: '复制知识到当前作品', description: `从“${preview.owner.workTitle}”复制到“${preview.targetTitle}”，副本独立编辑并保留来源。`, submitLabel: '确认复制', submitTone: 'primary', onSubmit: confirm,
  }}>
    <div className="knowledge-copy-preview">
      <p className="knowledge-copy-content">{preview.entry.body}</p><p>出处：{readableKnowledgeSource(preview.entry.source) || '未注明出处'}</p>
      <p>来源分类：{preview.sourceCategory}</p><p>来源标签：{preview.sourceTags.join('、') || '无'}</p>
      <label>目标主分类<SelectField aria-label="目标主分类" value={categoryId} disabled={disabled} onChange={event => setCategoryId(event.target.value)}>{preview.categories.map(item => <option key={item.id} value={item.id}>{categoryPath(item.id, preview.categories)}</option>)}</SelectField></label>
      <fieldset disabled={disabled}><legend>目标作品已有标签</legend>{preview.tags.length ? preview.tags.map(tag => <label key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => setTagIds(previous => previous.includes(tag.id) ? previous.filter(id => id !== tag.id) : [...previous, tag.id])} />{tag.name}</label>) : <p>当前作品尚无标签。</p>}</fieldset>
      {!!preview.unmatchedTags.length && <p>未匹配标签：{preview.unmatchedTags.join('、')}。本次不添加；如需这些标签，请先在设置维护后重新复制。</p>}
      {error && <p role="alert">{error}</p>}
      {pending && <p role="status">复制结果待确认，选择与原请求已保留。<button type="button" className="secondary" disabled={busy || working} onClick={onRetry}>重试本次复制</button></p>}
    </div>
  </StructureDialog>;
}
