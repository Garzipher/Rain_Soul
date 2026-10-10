import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { RetrievalEngine } from '../../src/workers/retrieval/engine';
import { RetrievalCache } from '../../src/workers/retrieval/cache';
const directories: string[] = [];
const caches: RetrievalCache[] = [];
afterEach(() => { caches.splice(0).forEach(cache => cache.close()); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-engine-')); directories.push(directory);
  const vector = new Float32Array(512); vector[0] = 1;
  const model = { tokenize: (text: string) => Array.from(text).map((_, index) => index), embed: vi.fn(async (texts: string[]) => texts.map(() => vector)), dispose: vi.fn(async () => {}) };
  const cache = new RetrievalCache(directory), engine = new RetrievalEngine(cache, model, 'fixed-test-fingerprint', .7);
  caches.push(cache);
  const workId = randomUUID(), entryId = randomUUID(), body = '雨落在屋檐下';
  const entry = { workId, entryId, body, bodyHash: createHash('sha256').update(body).digest('hex'), excerpt: body, source: '原著', categoryId: randomUUID(), tagIds: [] };
  return { engine, cache, model, workId, entry };
}
it('实际文本分块并缓存向量，重启同指纹不重复嵌入，语义结果保留原文证据', async () => {
  const { engine, cache, model, entry, workId } = setup();
  await engine.index([entry]); await engine.index([entry]); expect(model.embed).toHaveBeenCalledTimes(1);
  const hits = await engine.search({ entries: [entry], categories: [], keywords: [], text: '雨声', mode: 'semantic', filter: { workId, tagIds: [] } });
  expect(hits).toEqual([expect.objectContaining({ entryId: entry.entryId, bodyHash: entry.bodyHash, excerpt: entry.body })]);
  await engine.close(); expect(model.dispose).toHaveBeenCalled(); cache.close();
});
it('编辑中旧索引任务即使晚返回也不能写回；删除条目不使用旧向量', async () => {
  const { engine, cache, model, entry, workId } = setup();
  let release!: (vectors: Float32Array<ArrayBuffer>[]) => void;
  model.embed.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = engine.index([entry]); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  engine.invalidateWork(workId); const vector = new Float32Array(512); vector[0] = 1; release([vector]); await pending;
  expect(cache.readWork(workId, [{ entryId: entry.entryId, bodyHash: entry.bodyHash }])).toEqual([]);
  expect(await engine.search({ entries: [], categories: [], keywords: [], text: '雨声', mode: 'semantic', filter: { workId, tagIds: [] } })).toEqual([]);
  await engine.close();
});
it('查询超长直接提示，指纹变化排除旧缓存，纯关键词不调用嵌入', async () => {
  const { engine, cache, model, entry, workId } = setup();
  expect(await engine.search({ entries: [entry], categories: [], keywords: [entry], text: '雨', mode: 'keyword', filter: { workId, tagIds: [] } })).toHaveLength(1);
  expect(model.embed).not.toHaveBeenCalled();
  await expect(engine.search({ entries: [entry], categories: [], keywords: [], text: '雨'.repeat(401), mode: 'semantic', filter: { workId, tagIds: [] } })).rejects.toThrow(/400/);
  cache.beginGeneration('different'); expect(cache.readWork(workId, [{ entryId: entry.entryId, bodyHash: entry.bodyHash }])).toEqual([]); await engine.close();
});
