import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { retrievalQuerySchema, type RetrievalQuery, type RetrievalReply, type RetrievalHit } from '../shared/retrieval';
import type { RetrievalModelStatus } from '../shared/retrieval-model';
import type { KnowledgeScope, KnowledgeScopeResult } from '../shared/knowledge-scope';
import type { WorkSummary } from '../shared/contracts';
import type { EngineQuery, IndexEntry } from '../workers/retrieval/engine';
import { rankKnowledge } from '../workers/retrieval/ranking';
import type { GlobalKnowledgeTransport } from './global-knowledge-commands';
import { exposeRetrievalIdentity, readGlobalRetrieval } from './global-knowledge-retrieval';

interface Store { execute(command: string, payload: unknown): Promise<unknown> }
interface Models {
  getStatus(): Promise<RetrievalModelStatus>; getActiveDirectory(): Promise<string | null>;
  setEnabled(enabled: boolean): Promise<void>; install(request: { operationId: string; source: 'local' | 'download'; directory?: string }, signal?: AbortSignal): Promise<void>;
  selectSource(source: 'bundled' | 'user'): Promise<void>;
}
interface Client {
  search(request: EngineQuery, directory: string, queryId: string): Promise<RetrievalHit[]>;
  index(entries: IndexEntry[], directory: string, workIds?:string[]): Promise<void>; close(): void;
  invalidateWork(workId: string): void; isIndexing(): boolean; cancel(queryId: string): void;
}
/** 只从可信作品库取正文，渲染层不能指定模型目录、向量或条目原文。 */
export class RetrievalCommands {
  private readonly queries = new Map<string, object>();
  private readonly indexed = new Map<string, string>();
  private modelGeneration = 0;
  private changing = false;
  private installation: { operationId: string; controller: AbortController } | null = null;
  constructor(private readonly store: Store, private readonly models: Models, private readonly client: Client,
    private readonly chooseDirectory: () => Promise<string | null>, private readonly global?: GlobalKnowledgeTransport) {}
  accepts(command: string) { return ['queryKnowledge', 'cancelKnowledgeQuery', 'getRetrievalModelStatus', 'importRetrievalModel', 'downloadRetrievalModel', 'cancelRetrievalModelInstall', 'setRetrievalModelEnabled', 'selectRetrievalModelSource', 'rebuildKnowledgeIndex'].includes(command); }
  private modelChanged() { this.modelGeneration++; this.client.close(); this.indexed.clear(); }
  private async changeModel(action: () => Promise<void>) {
    if (this.changing || this.installation) throw new Error('模型变更正在进行，请稍后重试。');
    this.changing = true;
    try { this.modelChanged(); await action(); return await this.models.getStatus(); }
    finally { this.changing = false; }
  }
  private sameModel(before: RetrievalModelStatus, after: RetrievalModelStatus, generation: number): boolean {
    return !this.changing && !this.installation && generation === this.modelGeneration && after.qualified && after.state === 'ready' && after.enabled !== false && after.fingerprint === before.fingerprint && after.source === before.source;
  }
  async execute(command: string, value: unknown): Promise<unknown> {
    if (command === 'queryKnowledge') return this.query(retrievalQuerySchema.parse(value));
    if (command === 'cancelKnowledgeQuery') {
      const { queryId } = z.object({ queryId: z.uuid() }).strict().parse(value);
      this.queries.delete(queryId); this.client.cancel(queryId); return;
    }
    if (command === 'getRetrievalModelStatus') { z.object({}).strict().parse(value); return this.models.getStatus(); }
    if (command === 'cancelRetrievalModelInstall') {
      const { operationId } = z.object({ operationId: z.uuid() }).strict().parse(value);
      if (this.installation?.operationId === operationId) this.installation.controller.abort(); return;
    }
    if (command === 'importRetrievalModel' || command === 'downloadRetrievalModel') {
      const { operationId } = (command === 'importRetrievalModel' ? z.object({ operationId: z.uuid().optional() }).strict() : z.object({ operationId: z.uuid() }).strict()).parse(value);
      return this.install(command === 'importRetrievalModel' ? 'local' : 'download', operationId ?? randomUUID());
    }
    if (command === 'setRetrievalModelEnabled') {
      const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(value);
      return this.changeModel(async () => {
        const status = await this.models.getStatus();
        if (enabled && !status.qualified) throw new Error('模型资格核验尚未完成，关键词检索仍可使用。');
        await this.models.setEnabled(enabled);
      });
    }
    if (command === 'selectRetrievalModelSource') {
      const { source } = z.object({ source: z.enum(['bundled', 'user']) }).strict().parse(value);
      return this.changeModel(() => this.models.selectSource(source));
    }
    if (command === 'rebuildKnowledgeIndex') {
      const { workId } = z.object({ workId: z.uuid().nullable() }).strict().parse(value);
      const generation = this.modelGeneration, status = await this.models.getStatus();
      if (!status.qualified || status.state !== 'ready') throw new Error('本机模型尚未就绪，请使用关键词检索。');
      const { entries,workIds } = await this.snapshot(workId), directory = await this.models.getActiveDirectory();
      if (!directory) throw new Error('本机模型校验失败。');
      if (!this.sameModel(status, await this.models.getStatus(), generation)) throw new Error('模型状态已变化，请重新重建。');
      for (const id of workIds) this.indexed.delete(id);
      await this.client.index(entries, directory,workIds); return;
    }
    throw new Error('未知检索命令。');
  }
  private async install(source: 'local' | 'download', operationId: string) {
    if (this.installation || this.changing) throw new Error('模型变更正在进行，请勿重复安装。');
    const installation = { operationId, controller: new AbortController() }; this.installation = installation;
    const signal = installation.controller.signal;
    try {
      const directory = source === 'local' ? await this.chooseDirectory() : undefined;
      if (signal.aborted) throw new Error('模型安装已取消，原模型保持。');
      if (source === 'local' && !directory) return this.models.getStatus();
      this.modelChanged();
      await this.models.install({ operationId, source, ...(directory ? { directory } : {}) }, signal);
      return this.models.getStatus();
    } finally { if (this.installation === installation) this.installation = null; }
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
    const workIds=works.filter(work=>workId===null || work.id===workId).map(work=>work.id);
    const ledger = JSON.stringify(works.filter(work => workId === null || work.id === workId));
    return { entries, scope, revisions, ledger,workIds };
  }
  private async scopedSnapshot(request: RetrievalQuery) {
    const scope = request.scope;
    const workId = scope && scope.kind !== 'global' ? scope.workId : request.workId;
    const work = scope?.kind === 'global' ? { entries: [] as IndexEntry[], scope: { knowledge: [], categories: [], tags: [], entryOwners: {} } as KnowledgeScope, revisions: {} as Record<string, number>, ledger: '', workIds: [] as string[] } : await this.snapshot(workId);
    const categories: EngineQuery['categories'] = work.scope.categories.filter(category => !category.deletedAt).flatMap(category => [...new Set(work.entries.map(entry => entry.workId))].map(owner => ({ ...category, workId: owner })));
    const globalOwners = new Map<string, string>(), globalKeywords: EngineQuery['keywords'] = [], entryRevisions = new Map<string, number>();
    const result = { ...work, categories, globalOwners, globalKeywords, entryRevisions, globalFailed: false, workLedger: work.ledger, workEntries: JSON.stringify(work.entries), workRevisions: JSON.stringify(work.revisions), globalRevision: 0, workId: scope?.kind === 'global' ? null : workId };
    if (scope?.kind !== 'global' && scope?.kind !== 'combined') return result;
    try {
      if (!this.global) throw new Error('全局库未初始化。');
      const global = await readGlobalRetrieval(this.global, request);
      result.entries = [...work.entries, ...global.entries]; result.categories.push(...global.categories); result.globalKeywords.push(...global.keywords);
      result.globalOwners.set(global.ownerKey, global.libraryId); result.workIds = [...work.workIds, global.ownerKey];
      for (const [key, value] of global.entryRevisions) result.entryRevisions.set(key, value);
      result.revisions = { ...work.revisions, [global.ownerKey]: global.revision }; result.globalRevision = global.revision;
      return result;
    } catch {
      if (scope.kind === 'global') throw new Error('全局知识库暂不可用，请切换到当前作品继续检索。');
      result.globalFailed = true; return result;
    }
  }
  private async query(request: RetrievalQuery): Promise<RetrievalReply> {
    if (this.queries.has(request.queryId) || this.queries.size >= 100) throw new Error('检索请求重复或过多。');
    const identity = {}, modelGeneration = this.modelGeneration; this.queries.set(request.queryId, identity);
    const current = () => { if (this.queries.get(request.queryId) !== identity) throw new Error('检索已取消。'); };
    try {
      const frozen = await this.scopedSnapshot(request); current();
      if (!request.scope && request.workId === null && (request.categoryId || request.tagIds.length)) throw new Error('跨作品检索请先选定作品再筛选分类与标签。');
      const rows: KnowledgeScopeResult[] = [];
      for (let offset = 0; request.scope?.kind !== 'global' && offset <= frozen.entries.length; offset += 200) {
        const page = await this.store.execute('searchKnowledgeScope', { scopeId: frozen.workId,
          query: { text: request.query, mode: 'knowledge', ...(request.categoryId ? { categoryId: request.categoryId } : {}), tagIds: request.tagIds, offset, limit: 200 } }) as KnowledgeScopeResult[];
        current(); rows.push(...page); if (page.length < 200) break;
      }
      const input: EngineQuery = { entries: frozen.entries, categories: frozen.categories, keywords: [...rows.map(row => ({ workId: row.workId, entryId: frozen.scope.entryOwners[row.id]?.sourceEntryId ?? row.id })), ...frozen.globalKeywords],
        text: request.query, mode: request.mode, filter: { workId: request.scope?.kind === 'global' || request.scope?.kind === 'combined' ? null : frozen.workId, categoryId: request.categoryId, tagIds: request.tagIds } };
      const keyword = () => rankKnowledge({ ...input, mode: 'keyword', threshold: 1, queryVector: [], chunks: [] });
      let hits: RetrievalHit[] = keyword(), status: RetrievalReply['status'] = 'ready', fingerprint: string | null = null, selectedModel: RetrievalModelStatus | null = null, message: string | undefined;
      if (request.mode !== 'keyword') {
        const model = await this.models.getStatus(); current();
        let directory = !this.changing && !this.installation && model.qualified && model.state === 'ready' && model.enabled !== false ? await this.models.getActiveDirectory() : null;
        current();
        if (directory && !this.sameModel(model, await this.models.getStatus(), modelGeneration)) directory = null;
        current();
        if (!directory) { status = 'fallback'; message = model.qualified ? '本机模型未就绪，当前显示关键词结果。' : '模型资格核验尚未完成，当前显示关键词结果。'; }
        else try {
          for (const workId of frozen.workIds) {
            const entries=frozen.entries.filter(entry=>entry.workId===workId);
            const key = `${modelGeneration}/${model.source ?? ''}/${model.fingerprint}/${JSON.stringify(entries.map(({entryId,bodyHash})=>[entryId,bodyHash]).sort((a,b)=>a[0].localeCompare(b[0])))}`;
            if (this.indexed.get(workId) !== key) {
              this.indexed.set(workId, key);
              void this.client.index(entries, directory,[workId]).catch(() => {if(this.indexed.get(workId)===key)this.indexed.delete(workId);});
            }
          }
          hits = await this.client.search(input, directory, request.queryId); current(); fingerprint = model.fingerprint; selectedModel = model;
          const after = await this.models.getStatus(); current();
          if (!this.sameModel(model, after, modelGeneration)) {
            hits = keyword(); status = 'fallback'; fingerprint = null; message = '模型状态已变化，当前显示关键词结果。';
          }
          else if (this.client.isIndexing()) { status = 'indexing'; message = '本机索引正在更新，可稍后重试。'; }
        } catch (error) {
          current(); hits = keyword(); status = 'fallback';
          message = error && typeof error === 'object' && 'code' in error && error.code === 'RETRIEVAL_QUERY_TOO_LONG'
            ? '查询超过400 token，请缩小范围；当前显示关键词结果。' : '本机检索未完成，当前显示关键词结果。';
        }
      }
      const verified = await this.scopedSnapshot(request); current();
      const finalModel = fingerprint ? await this.models.getStatus() : null; current();
      if (fingerprint && (!selectedModel || !finalModel || !this.sameModel(selectedModel, finalModel, modelGeneration))) {
        hits = keyword(); status = 'fallback'; fingerprint = null; message = '模型状态已变化，当前显示关键词结果。';
      }
      if (frozen.workLedger !== verified.workLedger || frozen.workEntries !== verified.workEntries || frozen.workRevisions !== verified.workRevisions) {
        for (const id of Object.keys(frozen.revisions)) this.indexed.delete(id);
        throw new Error('知识来源已变化，请重新检索。');
      }
      if (frozen.globalRevision !== verified.globalRevision) {
        for (const id of frozen.globalOwners.keys()) this.indexed.delete(id);
        if (request.scope?.kind === 'global') throw new Error('全局知识来源已变化，请重新检索。');
        hits = hits.filter(hit => !hit.workId || !frozen.globalOwners.has(hit.workId));
        status = 'fallback'; message = '全局知识来源已变化，当前仅显示作品结果，请重新检索。';
      }
      if (frozen.globalFailed || verified.globalFailed) { status = 'fallback'; message = '全局知识库暂不可用，当前显示作品结果。'; }
      hits = hits.filter(hit => verified.entries.some(entry => entry.entryId === hit.entryId && entry.workId === hit.workId
        && entry.bodyHash === hit.bodyHash && entry.body.includes(hit.excerpt)));
      const offset = (request.page - 1) * request.pageSize;
      return { queryId: request.queryId, hits: hits.slice(offset, offset + request.pageSize).map(hit => exposeRetrievalIdentity(hit, verified.globalOwners, verified.entryRevisions)), total: hits.length,
        sourceRevisions: verified.revisions, modelFingerprint: fingerprint, status, ...(message ? { message } : {}) };
    } finally { if (this.queries.get(request.queryId) === identity) this.queries.delete(request.queryId); }
  }
}
