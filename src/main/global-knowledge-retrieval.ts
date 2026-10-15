import { createHash } from 'node:crypto';
import type { EngineQuery, IndexEntry } from '../workers/retrieval/engine';
import type { RetrievalQuery, RetrievalHit } from '../shared/retrieval';
import { globalKnowledgePageSchema } from '../shared/global-knowledge-schema';
import type { GlobalKnowledgeTransport } from './global-knowledge-commands';
import { filterGlobalEntries } from '../workers/global-knowledge/search';

/** 全局缓存身份仅在推理缓存内部使用；对外全局条目workId始终为null。 */
export async function readGlobalRetrieval(client: GlobalKnowledgeTransport, request: RetrievalQuery) {
  const page = globalKnowledgePageSchema.parse(await client.request('readAllGlobalKnowledge', {}));
  const ownerKey = `global:${page.libraryId}`;
  const entries: IndexEntry[] = page.entries.filter(entry=>!entry.deletedAt).map(entry => ({ workId: ownerKey, entryId: entry.id, body: entry.body,
    bodyHash: createHash('sha256').update(entry.body).digest('hex'), excerpt: entry.body, source: entry.source, categoryId: entry.categoryId, tagIds: entry.tagIds }));
  const keywords = filterGlobalEntries(page.entries, page.categories, { text: request.query, categoryId: request.categoryId, tagIds: request.tagIds }).map(entry => ({ workId: ownerKey, entryId: entry.id }));
  const categories: EngineQuery['categories'] = page.categories.map(category => ({ ...category, workId: ownerKey }));
  const entryRevisions = new Map(page.entries.map(entry => [`${ownerKey}/${entry.id}`, entry.revision]));
  return { entries, keywords, categories, ownerKey, libraryId: page.libraryId, revision: page.revision, entryRevisions };
}
export function exposeRetrievalIdentity(hit: RetrievalHit, globalOwners: Map<string, string>, entryRevisions?: Map<string, number>): RetrievalHit {
  const libraryId = hit.workId ? globalOwners.get(hit.workId) : undefined;
  return libraryId ? { ...hit, workId: null, library: 'global', libraryId, entryRevision: entryRevisions?.get(`${hit.workId}/${hit.entryId}`) } : { ...hit, library: 'work' };
}
