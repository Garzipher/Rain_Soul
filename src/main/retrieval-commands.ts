import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { retrievalQuerySchema, type RetrievalQuery, type RetrievalReply, type RetrievalHit } from '../shared/retrieval';
import type { RetrievalModelStatus } from '../shared/retrieval-model';
import type { KnowledgeScope, KnowledgeScopeResult } from '../shared/knowledge-scope';
import type { WorkSummary } from '../shared/contracts';
import type { EngineQuery, IndexEntry } from '../workers/retrieval/engine';
import { rankKnowledge } from '../workers/retrieval/ranking';

interface Store { execute(command: string, payload: unknown): Promise<unknown> }
interface Models {
  getStatus(): Promise<RetrievalModelStatus>; getActiveDirectory(): Promise<string | null>;
  setEnabled(enabled: boolean): Promise<void>; install(request: { operationId: string; source: 'local'; directory: string }): Promise<void>;
}
interface Client {
  search(request: EngineQuery, directory: string, queryId: string): Promise<RetrievalHit[]>;
  index(entries: IndexEntry[], directory: string): Promise<void>; close(): void;
  invalidateWork(workId: string): void; isIndexing(): boolean; cancel(queryId: string): void;
}
/** 只从可信作品库取正文，渲染层不能指定模型目录、向量或条目原文。 */
export class RetrievalCommands {
  private readonly queries = new Map<string, object>();
  private readonly indexed = new Map<string, string>();
  private modelGeneration = 0;
  constructor(private readonly store: Store, private readonly models: Models, private readonly client: Client,
    private readonly chooseDirectory: () => Promise<string | null>) {}
  accepts(command: string) { return ['queryKnowledge', 'cancelKnowledgeQuery', 'getRetrievalModelStatus', 'importRetrievalModel', 'setRetrievalModelEnabled', 'rebuildKnowledgeIndex'].includes(command); }
  async execute(command: string, value: unknown): Promise<unknown> {
    if (command === 'queryKnowledge') return this.query(retrievalQuerySchema.parse(value));
    if (command === 'cancelKnowledgeQuery') {
      const { queryId } = z.object({ queryId: z.uuid() }).strict().parse(value);
      this.queries.delete(queryId); this.client.cancel(queryId); return;
    }
    if (command === 'getRetrievalModelStatus') { z.object({}).strict().parse(value); return this.models.getStatus(); }
    if (command === 'importRetrievalModel') {
      z.object({}).strict().parse(value); const directory = await this.chooseDirectory();
      if (directory) { this.modelGeneration++; this.client.close(); this.indexed.clear(); await this.models.install({ operationId: randomUUID(), source: 'local', directory }); }
      return this.models.getStatus();
    }
    if (command === 'setRetrievalModelEnabled') {
      const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(value), status = await this.models.getStatus();
      if (enabled && !status.qualified) throw new Error('模型资格核验尚未完成，关键词检索仍可使用。');
      this.modelGeneration++; this.client.close(); this.indexed.clear(); await this.models.setEnabled(enabled); return this.models.getStatus();
    }
    if (command === 'rebuildKnowledgeIndex') {
      const { workId } = z.object({ workId: z.uuid().nullable() }).strict().parse(value);
      const status = await this.models.getStatus();
      if (!status.qualified || status.state !== 'ready') throw new Error('本机模型尚未就绪，请使用关键词检索。');
      const { entries } = await this.snapshot(workId), directory = await this.models.getActiveDirectory();
      if (!directory) throw new Error('本机模型校验失败。');
      for (const id of new Set(entries.map(entry => entry.workId))) { this.client.invalidateWork(id); this.indexed.delete(id); }
      await this.client.index(entries, directory); return;
    }
    throw new Error('未知检索命令。');
  }
  private async snapshot(workId: string | null) {
    const scope = await this.store.execute('readKnowledgeScope', { scopeId: workId }) as KnowledgeScope;
    const entries: IndexEntry[] = scope.knowledge.filter(entry => !entry.deletedAt).map(entry => {
      const owner = scope.entryOwners[entry.id]; if (!owner) throw new Error('知识来源身份无效。');
      return { workId: owner.workId, entryId: owner.sourceEntryId, body: entry.body, bodyHash: createHash('sha256').update(entry.body).digest('hex'),
        excerpt: entry.body, source: entry.source, categoryId: entry.categoryId, tagIds: entry.tagIds };
    });
    const works = await this.store.execute('listWorks', {}) as WorkSummary[];
    const revisions = Object.fromEntries(Object.values(scope.entryOwners).map(owner => [owner.workId, owner.sourceRevision]));
    const ledger = JSON.stringify(works.filter(work => workId === null || work.id === workId));
    return { entries, scope, revisions, ledger };
  }
  private async query(request: RetrievalQuery): Promise<RetrievalReply> {
    if (this.queries.has(request.queryId) || this.queries.size >= 100) throw new Error('检索请求重复或过多。');
    const identity = {}, modelGeneration = this.modelGeneration; this.queries.set(request.queryId, identity);
    const current = () => { if (this.queries.get(request.queryId) !== identity) throw new Error('检索已取消。'); };
    try {
      const frozen = await this.snapshot(request.workId); current();
      if (request.workId === null && (request.categoryId || request.tagIds.length)) throw new Error('跨作品检索请先选定作品再筛选分类与标签。');
      const rows: KnowledgeScopeResult[] = [];
      for (let offset = 0; offset <= frozen.entries.length; offset += 200) {
        const page = await this.store.execute('searchKnowledgeScope', { scopeId: request.workId,
          query: { text: request.query, mode: 'knowledge', ...(request.categoryId ? { categoryId: request.categoryId } : {}), tagIds: request.tagIds, offset, limit: 200 } }) as KnowledgeScopeResult[];
        current(); rows.push(...page); if (page.length < 200) break;
      }
      const categories = frozen.scope.categories.filter(category => !category.deletedAt).flatMap(category =>
        [...new Set(frozen.entries.map(entry => entry.workId))].map(workId => ({ ...category, workId })));
      const input: EngineQuery = { entries: frozen.entries, categories, keywords: rows.map(row => ({ workId: row.workId, entryId: frozen.scope.entryOwners[row.id]?.sourceEntryId ?? row.id })),
        text: request.query, mode: request.mode, filter: { workId: request.workId, categoryId: request.categoryId, tagIds: request.tagIds } };
      const keyword = () => rankKnowledge({ ...input, mode: 'keyword', threshold: 1, queryVector: [], chunks: [] });
      let hits: RetrievalHit[] = keyword(), status: RetrievalReply['status'] = 'ready', fingerprint: string | null = null, message: string | undefined;
      if (request.mode !== 'keyword') {
        const model = await this.models.getStatus(); current();
        const directory = model.qualified && model.state === 'ready' ? await this.models.getActiveDirectory() : null;
        current();
        if (!directory) { status = 'fallback'; message = model.qualified ? '本机模型未就绪，当前显示关键词结果。' : '模型资格核验尚未完成，当前显示关键词结果。'; }
        else try {
          for (const [workId, revision] of Object.entries(frozen.revisions)) {
            const key = `${revision}/${model.fingerprint}`;
            if (this.indexed.get(workId) !== key) {
              this.client.invalidateWork(workId); this.indexed.set(workId, key);
              void this.client.index(frozen.entries.filter(entry => entry.workId === workId), directory).catch(() => this.indexed.delete(workId));
            }
          }
          hits = await this.client.search(input, directory, request.queryId); current(); fingerprint = model.fingerprint;
          const after = await this.models.getStatus(); current();
          if (!after.qualified || after.state !== 'ready' || after.fingerprint !== model.fingerprint) {
            hits = keyword(); status = 'fallback'; fingerprint = null; message = '模型状态已变化，当前显示关键词结果。';
          }
          else if (this.client.isIndexing()) { status = 'indexing'; message = '本机索引正在更新，可稍后重试。'; }
        } catch { current(); hits = keyword(); status = 'fallback'; message = '本机检索未完成，当前显示关键词结果。'; }
      }
      const verified = await this.snapshot(request.workId); current();
      const finalModel = fingerprint ? await this.models.getStatus() : null; current();
      if (fingerprint && (modelGeneration !== this.modelGeneration || !finalModel?.qualified || finalModel.state !== 'ready' || finalModel.fingerprint !== fingerprint)) {
        hits = keyword(); status = 'fallback'; fingerprint = null; message = '模型状态已变化，当前显示关键词结果。';
      }
      if (frozen.ledger !== verified.ledger || JSON.stringify(frozen.revisions) !== JSON.stringify(verified.revisions) || JSON.stringify(frozen.entries) !== JSON.stringify(verified.entries)) {
        for (const id of Object.keys(frozen.revisions)) { this.client.invalidateWork(id); this.indexed.delete(id); }
        throw new Error('知识来源已变化，请重新检索。');
      }
      hits = hits.filter(hit => verified.entries.some(entry => entry.entryId === hit.entryId && entry.workId === hit.workId
        && entry.bodyHash === hit.bodyHash && entry.body.includes(hit.excerpt)));
      const offset = (request.page - 1) * request.pageSize;
      return { queryId: request.queryId, hits: hits.slice(offset, offset + request.pageSize), total: hits.length,
        sourceRevisions: verified.revisions, modelFingerprint: fingerprint, status, ...(message ? { message } : {}) };
    } finally { if (this.queries.get(request.queryId) === identity) this.queries.delete(request.queryId); }
  }
}
