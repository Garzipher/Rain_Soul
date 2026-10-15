import type { GlobalKnowledgeQuery, GlobalKnowledgeEntry } from '../../shared/global-knowledge';
import type { Category } from '../../shared/assets';

/** 中文短词直接做大小写折叠子串匹配，避免分词器丢弃一至二字查询。 */
export function filterGlobalEntries(entries: GlobalKnowledgeEntry[], categories: Category[], query: GlobalKnowledgeQuery): GlobalKnowledgeEntry[] {
  const accepted = new Set<string>();
  if (query.categoryId) {
    accepted.add(query.categoryId);
    for (let previous = -1; previous !== accepted.size;) { previous = accepted.size; for (const category of categories) if (!category.deletedAt && category.parentId && accepted.has(category.parentId)) accepted.add(category.id); }
  }
  const needle = (query.text ?? '').trim().toLocaleLowerCase();
  return entries.filter(entry => !entry.deletedAt && (!query.categoryId || accepted.has(entry.categoryId))
    && (query.tagIds ?? []).every(tag => entry.tagIds.includes(tag))
    && (!needle || `${entry.body}\n${entry.source}`.toLocaleLowerCase().includes(needle)));
}
