import { _electron } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { inspectPackagedRetrieval, evaluateRetrievalQuality, assertPackagedAcceptance, assertQualificationFixture } from './packaged-retrieval-acceptance.mjs';

const options = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, index) => process.argv.slice(2 + index * 2, 4 + index * 2)));
if (!isAbsolute(options['--executable'] ?? '') || !isAbsolute(options['--report'] ?? '')) throw new Error('用法：node scripts/accept-packaged-retrieval-model.mjs --executable <绝对RainSoul.exe> --report <绝对报告路径> [--fixture <夹具路径>]');
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'assets/retrieval-model-manifest.json'), 'utf8'));
const fixture = JSON.parse(await readFile(options['--fixture'] ?? join(root, 'tests/fixtures/retrieval-quality.json'), 'utf8'));
assertQualificationFixture(fixture);
const fixtureHash = createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
const identity = await inspectPackagedRetrieval(options['--executable'], manifest);
const isolation = await mkdtemp(join(tmpdir(), 'rainsoul-packaged-model-'));
const env = { ...process.env, APPDATA: isolation, LOCALAPPDATA: isolation, RAINSOUL_TEST_DIRECTORY: isolation };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
let application, report;
try {
  application = await _electron.launch({ executablePath: options['--executable'], args: [`--user-data-dir=${join(isolation, 'ElectronProfile')}`], env, timeout: 60000 });
  const page = await application.firstWindow(); await page.context().setOffline(true);
  const measured = await application.evaluate(async ({ app }, payload) => {
    // 在真正EXE的主进程创建隔离推理Worker，使用ASAR中的原始运行库，而非研究构建。
    const { createRequire } = await import('node:module');
    const runtimeRequire = createRequire(payload.identity.runtimePath);
    const { Worker } = runtimeRequire('node:worker_threads');
    const source = `
      const { parentPort, workerData } = require('node:worker_threads');
      const { performance } = require('node:perf_hooks');
      let networkAttempts = 0;
      const deny = () => { networkAttempts++; throw new Error('模型验收禁止联网'); };
      globalThis.fetch = deny;
      for (const name of ['http','https','net','tls','dns','dgram']) {
        const api = require('node:' + name);
        for (const method of ['request','get','connect','createConnection','lookup','resolve','resolve4','resolve6','createSocket']) if (typeof api[method] === 'function') api[method] = deny;
        if(api.promises) for(const method of ['lookup','resolve','resolve4','resolve6']) if(typeof api.promises[method]==='function') api.promises[method]=deny;
      }
      (async () => {
        const start = performance.now(), runtime = require(workerData.identity.runtimePath);
        Object.assign(runtime.env,{allowRemoteModels:false,allowLocalModels:true,useBrowserCache:false,useFSCache:false});
        const tokenizer = await runtime.AutoTokenizer.from_pretrained(workerData.identity.modelDirectory,{local_files_only:true});
        const extractor = await runtime.pipeline('feature-extraction',workerData.identity.modelDirectory,{local_files_only:true,device:'wasm',dtype:'q8',session_options:{executionProviders:['wasm']}});
        const coldLoadMs = performance.now()-start;
        const embed = async (texts, query) => {
          const vectors = [];
          for(let offset=0;offset<texts.length;offset+=16) {
            const inputs=texts.slice(offset,offset+16).map(text=>{
              if(tokenizer(text,{add_special_tokens:false,padding:false,truncation:false}).input_ids.data.length>400)throw new Error('夹具超过400 token');
              return query ? workerData.manifest.queryPrefix+text : text;
            });
            const output=await extractor(inputs,{pooling:'cls',normalize:true});
            if(output.dims.length!==2 || output.dims[1]!==512)throw new Error('向量维数无效');
            for(let row=0;row<inputs.length;row++) {
              const vector=Array.from(output.data.slice(row*512,(row+1)*512));
              if(!vector.every(Number.isFinite)||Math.abs(Math.sqrt(vector.reduce((sum,x)=>sum+x*x,0))-1)>1e-4)throw new Error('向量未归一化');
              vectors.push(vector);
            }
          }
          return vectors;
        };
        const documents=await embed(workerData.fixture.knowledge.map(entry=>entry.body),false);
        const queries=await embed(workerData.fixture.acceptance.map(query=>query.text),true);
        await extractor.dispose();
        parentPort.postMessage({ok:true,data:{documents,queries,coldLoadMs,dimensions:512,networkAttempts,totalMs:performance.now()-start,versions:process.versions}});
      })().catch(error=>parentPort.postMessage({ok:false,error:error.message}));
    `;
    const worker = new Worker(source, { eval: true, workerData: payload });
    const timer = await import('node:timers');
    try {
      const result = await new Promise((accept, reject) => {
        const timeout = timer.setTimeout(() => reject(new Error('实际包推理超过5分钟')), 300000);
        worker.once('message', reply => { timer.clearTimeout(timeout); if(reply.ok) accept(reply.data); else reject(new Error(reply.error)); });
        worker.once('error', error => { timer.clearTimeout(timeout); reject(error); });
        worker.once('exit', code => { if(code!==0) { timer.clearTimeout(timeout); reject(new Error(`实际包推理Worker退出：${code}`)); } });
      });
      return { ...result, actualExecutable: app.getPath('exe'), packaged: app.isPackaged };
    } finally { await worker.terminate(); }
  }, { identity, manifest, fixture });
  if (!measured.packaged || resolve(measured.actualExecutable) !== resolve(options['--executable'])) throw new Error('运行入口不是指定实际目录包。');
  const after = await inspectPackagedRetrieval(options['--executable'], manifest);
  const quality = evaluateRetrievalQuality(fixture, measured.documents, measured.queries, manifest.similarityThreshold);
  const metrics = { ...measured }; delete metrics.documents; delete metrics.queries;
  report = { schemaVersion: 1, timestamp: new Date().toISOString(), status: 'measured', identity: after, fixtureHash,
    annotation: fixture.annotation, fixtureKnowledgeCount: fixture.knowledge.length, fixtureAcceptanceCount: fixture.acceptance.length,
    ...metrics, quality, isolation, networkAuditScope: '真实EXE主进程创建的推理Worker；拦截fetch及Node http/https/net/tls/dns/dgram入口，渲染Context离线。未做全系统抓包，未验证安装/卸载。',
    qualificationScope: '加载实际ASAR运行库与旁树WASM、固定权重并评估原创中文夹具；不等于UI启用资格或混合检索完整交互验收。' };
  assertPackagedAcceptance(identity, report); report.status = 'passed';
} catch (error) {
  report = { ...report, schemaVersion: 1, timestamp: new Date().toISOString(), status: 'failed', identity, fixtureHash, isolation, error: error.message };
  process.exitCode = 1;
} finally {
  if (application) {
    try { await application.close(); }
    catch (error) { report = { ...report, status: 'failed', closeError: error.message }; process.exitCode = 1; }
  }
  await mkdir(dirname(options['--report']), { recursive: true }); await writeFile(options['--report'], JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, report: options['--report'], error: report.error, semanticRecall: report.quality?.semanticParaphraseRecall, networkAttempts: report.networkAttempts }));
}
