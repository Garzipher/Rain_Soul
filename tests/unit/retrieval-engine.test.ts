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
it('重建失败或进行中仍返回旧代，新代全部完成后才原子切换',async()=>{
  const {engine,cache,model,entry,workId}=setup();await engine.index([entry]);
  const changedBody='风掠过窗棂',changed={...entry,body:changedBody,bodyHash:createHash('sha256').update(changedBody).digest('hex'),excerpt:changedBody};
  let release!:(vectors:Float32Array<ArrayBuffer>[])=>void;model.embed.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const pending=engine.index([changed]);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  expect(cache.readWork(workId,[{entryId:entry.entryId,bodyHash:entry.bodyHash}])).toHaveLength(1);
  expect(cache.readWork(workId,[{entryId:entry.entryId,bodyHash:changed.bodyHash}])).toHaveLength(0);
  const vector=new Float32Array(512);vector[0]=1;release([vector]);await pending;
  expect(cache.readWork(workId,[{entryId:entry.entryId,bodyHash:entry.bodyHash}])).toHaveLength(0);
  expect(cache.readWork(workId,[{entryId:entry.entryId,bodyHash:changed.bodyHash}])).toHaveLength(1);
  model.embed.mockRejectedValueOnce(new Error('推理失败'));
  await expect(engine.index([entry])).rejects.toThrow(/推理/);
  expect(cache.readWork(workId,[{entryId:entry.entryId,bodyHash:changed.bodyHash}])).toHaveLength(1);
});
it('完整知识清单增量复用未变块，删除条目不留下缓存',async()=>{
  const {engine,cache,model,entry,workId}=setup();const other={...entry,entryId:randomUUID()};
  await engine.index([entry,other]);expect(model.embed).toHaveBeenCalledTimes(2);
  await engine.index([entry]);expect(model.embed).toHaveBeenCalledTimes(2);
  expect(cache.readWork(workId,[{entryId:other.entryId,bodyHash:other.bodyHash}])).toHaveLength(0);
});
it('重建第二条失败不能提前发布第一条新hash',async()=>{
  const {engine,cache,model,entry,workId}=setup(),other={...entry,entryId:randomUUID()};await engine.index([entry,other]);
  const change=(value:typeof entry)=>({...value,body:'新正文',bodyHash:createHash('sha256').update('新正文').digest('hex')});
  model.embed.mockImplementationOnce(async texts=>texts.map(()=>{const vector=new Float32Array(512);vector[0]=1;return vector;})).mockRejectedValueOnce(new Error('第二条失败'));
  await expect(engine.index([change(entry),change(other)])).rejects.toThrow(/第二条/);
  expect(cache.readWork(workId,[{entryId:entry.entryId,bodyHash:entry.bodyHash}])).toHaveLength(1);
  expect(cache.readWork(workId,[{entryId:entry.entryId,bodyHash:change(entry).bodyHash}])).toEqual([]);
});
it('真实重启只为失败批次的剩余条目推理，空作品清单原子清除派生块',async()=>{
  const {engine,cache,model,entry,workId}=setup(),other={...entry,entryId:randomUUID()};
  model.embed.mockImplementationOnce(async texts=>texts.map(()=>{const vector=new Float32Array(512);vector[0]=1;return vector;})).mockRejectedValueOnce(new Error('中断'));
  await expect(engine.index([entry,other])).rejects.toThrow();await engine.close();
  const reopened=new RetrievalCache(directories.at(-1)!);caches.push(reopened);const next=new RetrievalEngine(reopened,model,'fixed-test-fingerprint',.7);
  model.embed.mockClear();await next.index([entry,other]);expect(model.embed).toHaveBeenCalledTimes(1);
  expect(reopened.readWork(workId,[{entryId:entry.entryId,bodyHash:entry.bodyHash}])).toHaveLength(1);
  await next.index([],[workId]);expect(reopened.readWork(workId,[{entryId:entry.entryId,bodyHash:entry.bodyHash}])).toEqual([]);
  expect(cache).toBeDefined();await next.close();
});
it('关闭前后拒绝新查询，推理晚结果不激活索引且关闭幂等',async()=>{
  const {engine,model,entry}=setup();let release!:(vectors:Float32Array<ArrayBuffer>[])=>void;
  model.embed.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const pending=engine.index([entry]);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  await engine.close();const vector=new Float32Array(512);vector[0]=1;release([vector]);await pending;
  await expect(engine.index([entry])).rejects.toThrow(/关闭/);
  await expect(engine.search({entries:[entry],categories:[],keywords:[],text:'雨',mode:'semantic',filter:{workId:entry.workId,tagIds:[]}})).rejects.toThrow(/关闭/);
  await engine.close();expect(model.dispose).toHaveBeenCalledTimes(1);
});
it('缓存hash相同但原文offset不符不能进入语义结果，空文本不创建虚假块',async()=>{
  const {engine,model,entry}=setup();await engine.index([entry]);
  const request={entries:[{...entry,body:'完全不相同'}],categories:[],keywords:[],text:'雨',mode:'semantic' as const,filter:{workId:entry.workId,tagIds:[]}};
  expect(await engine.search(request)).toEqual([]);model.embed.mockClear();
  await engine.index([{...entry,body:'',bodyHash:createHash('sha256').update('').digest('hex')}]);expect(model.embed).not.toHaveBeenCalled();
});
it('学习注释参与本机嵌入和缓存失效，语义命中仍呈现原句与原文哈希', async () => {
  const { engine, model, entry, workId } = setup();
  const searchText = `${entry.body}\n写作手法：重复动作表现克制情绪`;
  const annotated = { ...entry, searchText, searchHash: createHash('sha256').update(searchText).digest('hex') };
  await engine.index([annotated]);
  expect(model.embed).toHaveBeenCalledWith([searchText], 'document');
  const request = { entries: [annotated], categories: [], keywords: [], text: '用动作表达情绪', mode: 'semantic' as const, filter: { workId, tagIds: [] } };
  expect(await engine.search(request)).toEqual([expect.objectContaining({ excerpt: entry.body, bodyHash: entry.bodyHash, source: entry.source })]);
  const changedText = `${entry.body}\n写作手法：光影映衬人物`;
  const changed = { ...annotated, searchText: changedText, searchHash: createHash('sha256').update(changedText).digest('hex') };
  expect(await engine.search({ ...request, entries: [changed] })).toEqual([]);
  await engine.index([changed]);
  expect(model.embed).toHaveBeenCalledWith([changedText], 'document');
  expect(await engine.search({ ...request, entries: [changed] })).toEqual([expect.objectContaining({ excerpt: entry.body, bodyHash: entry.bodyHash })]);
  expect(await engine.search({ ...request, entries: [{ ...changed, searchText: '篡改说明' }] })).toEqual([]);
});
