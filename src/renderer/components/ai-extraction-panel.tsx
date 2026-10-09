import type { AssetState } from '../../shared/assets';
import { extractionCategoryPath, type AiExtractionDraft } from '../../shared/ai-extraction';
import { splitKnowledgeSource } from '../../shared/knowledge-source';
import { KnowledgeSourceAudit } from './knowledge-source-audit';

export interface ExtractionReviewItem extends AiExtractionDraft { checked: boolean; categoryId: string; tagIds: string[]; mode?: 'create' | 'update'; targetId?: string }
export function AiExtractionPanel({ items, assets, disabled, onChange }: { items: ExtractionReviewItem[]; assets?: AssetState; disabled: boolean; onChange: (index: number, patch: Partial<ExtractionReviewItem>) => void }) {
  const categories = assets?.categories.filter(item => !item.deletedAt) ?? [], tags = assets?.tags.filter(item => !item.deletedAt) ?? [];
  const entries = assets?.knowledge.filter(item => !item.deletedAt) ?? [];
  return <div className="ai-extracted"><p className="ai-muted">默认新建知识；更新已有条目需选择目标、对比后重新审核。确认前保存保护快照。建议中的未知分类和标签不会自动创建。</p>{items.map((item, index) => {
    const target = item.mode === 'update' ? entries.find(entry => entry.id === item.targetId) : undefined;
    const source = splitKnowledgeSource(target?.source ?? '');
    return <fieldset key={index} disabled={disabled}>
    <legend>条目 {index + 1} · {item.type}</legend>
    <p className="ai-muted">建议分类：{item.suggestedCategory || '未提供'}；建议标签：{item.suggestedTags.join('、') || '未提供'}</p>
    <label>入库方式<select aria-label={`知识入库方式 ${index + 1}`} value={item.mode ?? 'create'} onChange={event => onChange(index, { mode: event.target.value as 'create' | 'update', targetId: undefined, checked: false })}><option value="create">新建知识条目</option><option value="update">更新已有知识条目</option></select></label>
    {item.mode === 'update' && <><label>更新目标<select aria-label={`更新知识目标 ${index + 1}`} value={item.targetId ?? ''} onChange={event => {
      const selected = entries.find(entry => entry.id === event.target.value);
      onChange(index, { targetId: selected?.id, categoryId: selected?.categoryId ?? '', tagIds: selected?.tagIds ?? [], checked: false });
    }}><option value="">请选择当前作品条目</option>{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.body.slice(0, 60)} · {entry.id.slice(0, 8)}</option>)}</select></label>
    {target ? <div aria-label={`更新前知识 ${index + 1}`} className="ai-original"><h3>更新前内容</h3><pre>{target.body}</pre><p className="ai-muted">出处：{source.readable || '未注明'}；分类：{extractionCategoryPath(categories, target.categoryId) || '未分类'}；标签：{tags.filter(tag => target.tagIds.includes(tag.id)).map(tag => tag.name).join('、') || '无'}</p><KnowledgeSourceAudit records={source.records} /></div> : <p role="status">请先选择有效目标，再审核更新内容。</p>}</>}
    <label><input type="checkbox" aria-label={`审核通过条目 ${index + 1}`} disabled={item.mode === 'update' && !target} checked={item.checked} onChange={event => onChange(index, { checked: event.target.checked })} />作者审核通过</label>
    <textarea aria-label={`知识候选 ${index + 1}`} value={item.body} onChange={event => onChange(index, { body: event.target.value, checked: false })} />
    <input aria-label={`知识出处 ${index + 1}`} value={item.source} onChange={event => onChange(index, { source: event.target.value, checked: false })} />
    <label>知识分类<select aria-label={`知识分类 ${index + 1}`} value={item.categoryId} onChange={event => onChange(index, { categoryId: event.target.value, checked: false })}><option value="">未分类</option>{categories.map(category => <option key={category.id} value={category.id}>{extractionCategoryPath(categories, category.id)}</option>)}</select></label>
    <div role="group" aria-label={`知识标签 ${index + 1}`}>{tags.map(tag => <label key={tag.id}><input type="checkbox" checked={item.tagIds.includes(tag.id)} onChange={event => onChange(index, { tagIds: event.target.checked ? [...item.tagIds, tag.id] : item.tagIds.filter(id => id !== tag.id), checked: false })} />{tag.name}</label>)}</div>
  </fieldset>;
  })}</div>;
}
