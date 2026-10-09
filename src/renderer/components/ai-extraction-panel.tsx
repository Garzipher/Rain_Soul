import type { AssetState } from '../../shared/assets';
import { extractionCategoryPath, type AiExtractionDraft } from '../../shared/ai-extraction';

export interface ExtractionReviewItem extends AiExtractionDraft { checked: boolean; categoryId: string; tagIds: string[] }
export function AiExtractionPanel({ items, assets, disabled, onChange }: { items: ExtractionReviewItem[]; assets?: AssetState; disabled: boolean; onChange: (index: number, patch: Partial<ExtractionReviewItem>) => void }) {
  const categories = assets?.categories.filter(item => !item.deletedAt) ?? [], tags = assets?.tags.filter(item => !item.deletedAt) ?? [];
  return <div className="ai-extracted"><p className="ai-muted">审核通过的条目将新建到当前作品知识库，不覆盖已有条目。建议中的未知分类和标签不会自动创建。</p>{items.map((item, index) => <fieldset key={index} disabled={disabled}>
    <legend>条目 {index + 1} · {item.type}</legend>
    <p className="ai-muted">建议分类：{item.suggestedCategory || '未提供'}；建议标签：{item.suggestedTags.join('、') || '未提供'}</p>
    <label><input type="checkbox" aria-label={`审核通过条目 ${index + 1}`} checked={item.checked} onChange={event => onChange(index, { checked: event.target.checked })} />作者审核通过</label>
    <textarea aria-label={`知识候选 ${index + 1}`} value={item.body} onChange={event => onChange(index, { body: event.target.value, checked: false })} />
    <input aria-label={`知识出处 ${index + 1}`} value={item.source} onChange={event => onChange(index, { source: event.target.value, checked: false })} />
    <label>知识分类<select aria-label={`知识分类 ${index + 1}`} value={item.categoryId} onChange={event => onChange(index, { categoryId: event.target.value, checked: false })}><option value="">未分类</option>{categories.map(category => <option key={category.id} value={category.id}>{extractionCategoryPath(categories, category.id)}</option>)}</select></label>
    <div role="group" aria-label={`知识标签 ${index + 1}`}>{tags.map(tag => <label key={tag.id}><input type="checkbox" checked={item.tagIds.includes(tag.id)} onChange={event => onChange(index, { tagIds: event.target.checked ? [...item.tagIds, tag.id] : item.tagIds.filter(id => id !== tag.id), checked: false })} />{tag.name}</label>)}</div>
  </fieldset>)}</div>;
}
