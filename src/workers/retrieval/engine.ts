import type { CpuEmbeddingModel } from './model';
import { chunkKnowledgeText } from './chunking';
import { rankKnowledge, type RankedEntry, type RankedHit, type CategoryNode } from './ranking';
import { RetrievalCache } from './cache';

export interface IndexEntry extends RankedEntry { body: string }
export interface EngineQuery {
  entries: IndexEntry[]; categories: CategoryNode[]; keywords: { workId: string; entryId: string }[];
  text: string; mode: 'keyword' | 'semantic' | 'hybrid'; filter: { workId: string | null; categoryId?: string; tagIds: string[] };
}
/** 只在检索Worker运行，缓存原文hash不匹配的块不能进入排序。 */
export class RetrievalEngine {
  private closed = false;
  constructor(private readonly cache: RetrievalCache, private readonly model: CpuEmbeddingModel,
    private readonly fingerprint: string, private readonly threshold: number) { cache.beginGeneration(fingerprint); }
  invalidateWork(workId: string) { this.cache.invalidateWork(workId); }
  async index(entries: IndexEntry[]): Promise<void> {
    if (this.closed) throw new Error('本机检索已关闭。');
    this.cache.beginGeneration(this.fingerprint);
    for (const entry of entries) {
      if (this.closed) return;
      if (this.cache.readWork(entry.workId, [{ entryId: entry.entryId, bodyHash: entry.bodyHash }]).length) continue;
      this.cache.beginGeneration(this.fingerprint);
      const token = this.cache.getWorkToken(entry.workId), chunks = chunkKnowledgeText(entry.body, text => this.model.tokenize(text));
      if (!chunks.length) continue;
      const vectors: Float32Array[] = [];
      for (let offset = 0; offset < chunks.length; offset += 32) {
        if (this.closed) return;
        vectors.push(...await this.model.embed(chunks.slice(offset, offset + 32).map(chunk => chunk.text), 'document'));
        // 每个推理批次让出事件循环，主进程的保存使用独立数据库Worker。
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      if (!this.closed) this.cache.writeCAS(token, { entryId: entry.entryId, bodyHash: entry.bodyHash,
        chunks: chunks.map((chunk, index) => ({ ...chunk, vector: vectors[index] })) });
    }
  }
  async search(request: EngineQuery): Promise<RankedHit[]> {
    if (this.closed) throw new Error('本机检索已关闭。');
    if (request.mode !== 'keyword' && this.model.tokenize(request.text).length > 400) throw Object.assign(new Error('查询超过400 token，请缩小范围。'), { code: 'RETRIEVAL_QUERY_TOO_LONG' });
    const queryVector = request.mode === 'keyword' ? [] : (await this.model.embed([request.text], 'query'))[0];
    const workIds = [...new Set(request.entries.map(entry => entry.workId))];
    const chunks = workIds.flatMap(workId => this.cache.readWork(workId, request.entries.filter(entry => entry.workId === workId).map(({ entryId, bodyHash }) => ({ entryId, bodyHash })))
      .filter(chunk => request.entries.some(entry => entry.workId === chunk.workId && entry.entryId === chunk.entryId
        && entry.bodyHash === chunk.bodyHash && entry.body.slice(chunk.start, chunk.end) === chunk.text))
      .map(chunk => ({ ...chunk, chunkIndex: chunk.index, excerpt: chunk.text })));
    return rankKnowledge({ ...request, queryVector, chunks, threshold: this.threshold });
  }
  async close() { if (!this.closed) { this.closed = true; await this.model.dispose(); this.cache.close(); } }
}
