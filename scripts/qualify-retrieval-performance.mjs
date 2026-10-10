import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem } from 'node:os';
import { setInterval, clearInterval, setTimeout } from 'node:timers';
import process from 'node:process';
import console from 'node:console';
import { build } from 'esbuild';

// 受控研究直接调用真实适配器；不改产品资格旗标，只使用原创合成知识与隔离数据库。
const root = resolve(import.meta.dirname, '..'), temporary = join(root, '.tmp-model-qualification');
const runDirectory = join(temporary, `performance-${randomUUID()}`);
await mkdir(runDirectory, { recursive: true });
const helper = join(runDirectory, 'helpers.cjs');
await build({ stdin: { contents: `export { RetrievalEngine } from './src/workers/retrieval/engine'; export { RetrievalCache } from './src/workers/retrieval/cache'; export { RetrievalScheduler } from './src/workers/retrieval/scheduler'; export { createCpuEmbeddingModel } from './src/workers/retrieval/model'; export { modelFingerprint, fixedManifest } from './src/shared/retrieval-model';`, resolveDir: root }, outfile: helper, bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['better-sqlite3'] });
const modelFiles = JSON.parse(await readFile(join(root, 'assets/retrieval-model-manifest.json'), 'utf8'));
for (const file of modelFiles.files) {
  const body = await readFile(join(temporary, 'model', file.path));
  assert.equal(body.length, file.bytes); assert.equal(createHash('sha256').update(body).digest('hex'), file.sha256);
}
const fixture = JSON.parse(await readFile(join(temporary, 'quality-fixture.json'), 'utf8'));
const stableId = text => {
  const hash = createHash('sha256').update(text).digest(); hash[6] = hash[6] & 15 | 64; hash[8] = hash[8] & 63 | 128;
  const hex = hash.subarray(0, 16).toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const workId = stableId('performance-work'), categoryId = stableId('performance-category');
const entries = Array.from({ length: 1000 }, (_, index) => {
  const base = fixture.knowledge[index % 100].body;
  const body = `${base}案例编号${index + 1}，人物在雨后的旧街道观察眼前变化，再据此调整行动，情绪由具体行为呈现，先完成当前场景目标并检查线索的前后关联。`;
  return { workId, entryId: stableId(`knowledge-${index}`), categoryId, tagIds: [], body, bodyHash: createHash('sha256').update(body).digest('hex'), source: `原创性能案例${index + 1}`, excerpt: body };
});
const queries = Array.from({ length: 200 }, (_, index) => fixture.acceptance[index % 30].text);
const fixtureHash = createHash('sha256').update(JSON.stringify({ entries, queries })).digest('hex');
const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
let network = 0;
globalThis.fetch = () => { network++; throw Error('性能试验禁止联网'); };
for (const name of ['http','https','net','tls','dns']) {
  const module = require('node:' + name);
  for (const method of ['request','get','connect','createConnection','lookup','resolve']) if(typeof module[method]==='function') module[method]=()=>{network++;throw Error('性能试验禁止联网');};
}
const { RetrievalEngine, RetrievalCache, RetrievalScheduler, createCpuEmbeddingModel, modelFingerprint, fixedManifest } = require(workerData.helper);
let engine, scheduler;
const load = (async () => {
  const started = performance.now();
  const runtime = createRequire(workerData.runtime)(workerData.runtime);
  const model = await createCpuEmbeddingModel(workerData.modelDirectory, { loadRuntime: async () => runtime });
  scheduler = new RetrievalScheduler(model);
  engine = new RetrievalEngine(new RetrievalCache(workerData.cacheDirectory), scheduler.background, createHash('sha256').update(modelFingerprint()).digest('hex'), fixedManifest.similarityThreshold);
  parentPort.postMessage({ id:'ready', ok:true, data:{ coldLoadMs:performance.now()-started, qualified:Object.values(fixedManifest.qualification).every(Boolean) } });
})();
load.catch(error=>parentPort.postMessage({id:'ready',ok:false,message:error.stack}));
parentPort.on('message',async ({id,command,payload})=>{
  try { await load; const started=performance.now(); let data;
    if(command==='index'){parentPort.postMessage({id:'index-started',ok:true});await engine.index(payload);}
    else if(command==='search')data=await scheduler.withQuery(id,()=>engine.search(payload));
    else if(command==='close')await engine.close();
    parentPort.postMessage({id,ok:true,data:{value:data,elapsedMs:performance.now()-started,networkAttempts:network}});
  }catch(error){parentPort.postMessage({id,ok:false,message:error.stack});}
});
`;
const retrieval = new Worker(workerSource, { eval: true, workerData: { helper, runtime: join(root, 'dist/desktop/retrieval-runtime.cjs'), modelDirectory: join(temporary, 'model'), cacheDirectory: join(runDirectory, 'cache') } });
const database = new Worker(join(root, 'dist/desktop/database-worker.cjs'), { workerData: { directory: join(runDirectory, 'isolated-work') } });
function client(worker, databaseProtocol = false) {
  const pending = new Map();
  worker.on('message', reply => { const id = databaseProtocol ? reply.requestId : reply.id, request = pending.get(id); if (!request) return; pending.delete(id); if (reply.ok) request.resolve(reply.data); else request.reject(new Error(reply.message)); });
  worker.on('error', error => { for (const request of pending.values()) request.reject(error); pending.clear(); });
  return { wait(id) { return new Promise((resolveResult, reject) => pending.set(id, { resolve: resolveResult, reject })); }, request(command, payload) { const id = randomUUID(), promise = this.wait(id); worker.postMessage({ [databaseProtocol ? 'requestId' : 'id']: id, command, payload }); return promise; } };
}
const retrievalClient = client(retrieval), databaseClient = client(database, true);
const rssStart = process.memoryUsage().rss, cpuStart = process.cpuUsage(), wallStart = performance.now();
let peakRss = rssStart;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);
const percentile = values => { const sorted = [...values].sort((a, b) => a - b); return { minimum: sorted[0], median: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], maximum: sorted.at(-1) }; };
try {
  const ready = await retrievalClient.wait('ready');
  assert.equal(ready.qualified, false, '研究不得打开生产资格开关');
  const work = await databaseClient.request('createWork', { title: '隔离性能试验作品' });
  let revision = work.revision;
  const indexStarted = retrievalClient.wait('index-started');
  const indexStart = performance.now();
  let indexed = false;
  const indexing = retrievalClient.request('index', entries).then(result => { indexed = true; return result; });
  await indexStarted;
  const saves = [];
  for (let index = 0; index < 30 && !indexed; index++) {
    const started = performance.now();
    const saved = await databaseClient.request('saveChapter', { workId: work.id, chapterId: work.chapters[0].id, title: '第一章', document: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: `真实数据库保存第${index + 1}次。${'雨声中的创作片段。'.repeat(2000)}` }] }] }, expectedRevision: revision, operationId: randomUUID() });
    revision = saved.revision; saves.push(performance.now() - started);
    await new Promise(resolveResult => setTimeout(resolveResult, 200));
  }
  const indexedResult = await indexing, indexMs = performance.now() - indexStart;
  assert.equal(indexedResult.networkAttempts, 0);
  const makeRequest = (text, mode) => ({ entries, categories: [], keywords: entries.filter(entry => entry.body.includes(text.slice(0, 2))).map(({ workId, entryId }) => ({ workId, entryId })), text, mode, filter: { workId, tagIds: [] } });
  await retrievalClient.request('search', makeRequest(queries[0], 'hybrid'));
  const hybrid = [], keyword = [];
  for (const text of queries) {
    for (const [mode, list] of [['hybrid', hybrid], ['keyword', keyword]]) {
      const started = performance.now();
      const result = await retrievalClient.request('search', makeRequest(text, mode));
      assert.equal(result.networkAttempts, 0); list.push(performance.now() - started);
    }
  }
  const cpu = process.cpuUsage(cpuStart), wallMs = performance.now() - wallStart;
  const reopened = await databaseClient.request('openWork', { id: work.id });
  assert.equal(reopened.revision, revision);
  assert.ok(JSON.stringify(reopened.chapters[0].document).includes(`真实数据库保存第${saves.length}次。`));
  const report = { timestamp: new Date().toISOString(), status: 'measured', fixtureHash, knowledgeCount: entries.length, queryCount: queries.length,
    textLengthCodepoints: percentile(entries.map(entry => [...entry.body].length)), hardware: { cpu: cpus()[0].model, logicalCores: cpus().length, totalMemory: totalmem(), versions: process.versions },
    runtime: modelFiles.runtime, qualificationFlags: modelFiles.qualification, coldLoadMs: ready.coldLoadMs, indexMs,
    hybridMs: percentile(hybrid), keywordMs: percentile(keyword), concurrentSaveMs: percentile(saves), concurrentSaveCount: saves.length, persistedSaveRevision: reopened.revision,
    rssBaseline: rssStart, peakRss, rssIncrease: peakRss - rssStart, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, totalWallMs: wallMs,
    networkAttempts: indexedResult.networkAttempts, numericTargets: { hybridP95: percentile(hybrid).p95 <= 1000, keywordP95: percentile(keyword).p95 <= 1000, saveMaximum: Math.max(...saves) <= 5000, coldLoad: ready.coldLoadMs <= 30000, rssIncrease: peakRss - rssStart <= 1.5 * 1024 ** 3 },
    limitation: '本机新进程OS文件缓存可能预热；主机CPU含并行Worker且受其他进程竞争；无系统抓包；不是产品EXE/真实作者知识规模验收' };
  await writeFile(join(temporary, 'retrieval-performance-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await retrievalClient.request('close', {});
} finally { clearInterval(sampler); await Promise.all([retrieval.terminate(), database.terminate()]); }
