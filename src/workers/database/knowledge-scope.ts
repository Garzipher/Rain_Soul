import { createHash } from 'node:crypto';
import type { AssetQuery, KnowledgeEntry } from '../../shared/assets';
import type { KnowledgeScope } from '../../shared/knowledge-scope';
import type { WorkDetail } from '../../shared/contracts';
import { RepositoryError } from './errors';

export function scopeEntryId(workId: string, entryId: string): string {
  const value = createHash('sha256').update(`${workId}:${entryId}`).digest('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
export function knowledgeScope(works: Pick<WorkDetail, 'id' | 'title' | 'revision' | 'assets'>[], all: boolean): KnowledgeScope {
  const scope: KnowledgeScope = { knowledge: [], categories: [], tags: [], entryOwners: {} };
  for (const work of works) {
    const assets = work.assets!;
    if (!all) { scope.categories = assets.categories.filter(item => !item.deletedAt); scope.tags = assets.tags.filter(item => !item.deletedAt); }
    for (const entry of assets.knowledge.filter(item => !item.deletedAt)) {
      const id = all ? scopeEntryId(work.id, entry.id) : entry.id;
      const display: KnowledgeEntry = { ...entry, id }; scope.knowledge.push(display);
      scope.entryOwners[id] = { workId: work.id, workTitle: work.title, sourceRevision: work.revision, sourceEntryId: entry.id };
    }
  }
  return scope;
}
export function assertGlobalKnowledgeQuery(query: AssetQuery): void {
  if (query.mode !== 'knowledge' || query.categoryId || query.tagIds?.length) {
    throw new RepositoryError('INVALID_INPUT', '全部作品只支持知识内容搜索，请选定作品后筛选分类或标签。');
  }
}
