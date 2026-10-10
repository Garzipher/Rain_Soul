import { mkdtemp, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { fixedManifest } from '../../src/shared/retrieval-model';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

it('实际编译Worker在资格关闭时拒绝加载与后续命令，未读取模型、创建缓存或加载推理库', async () => {
  expect(Object.values(fixedManifest.qualification).some(value => !value)).toBe(true);
  const directory = await mkdtemp(join(tmpdir(), 'rainsoul-worker-gate-')); directories.push(directory);
  const compiled = join(directory, 'retrieval-worker.cjs');
  await copyFile(resolve('dist/desktop/retrieval-worker.cjs'), compiled);
  // 只复制实际Worker，没有推理库；先拦截本线程I/O与网络，证实资格检查发生在这些动作之前。
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const fs = require('node:fs');
    const io = [], network = [], runtime = [];
    for (const name of ['readFile', 'lstat', 'stat', 'realpath', 'readdir', 'mkdir', 'open']) {
      const original = fs.promises[name];
      fs.promises[name] = function(path, ...args) {
        io.push({ name, path: String(path) });
        return original.call(this, path, ...args);
      };
    }
    globalThis.fetch = () => { network.push('fetch'); throw Error('资格验收禁止联网'); };
    for (const name of ['http', 'https', 'net', 'tls', 'dns']) {
      const module = require('node:' + name);
      for (const method of ['request', 'get', 'connect', 'createConnection', 'lookup', 'resolve']) {
        if (typeof module[method] === 'function') module[method] = () => { network.push(name + '.' + method); throw Error('资格验收禁止联网'); };
      }
    }
    const Module = require('node:module'), originalLoad = Module._load;
    Module._load = function(name, ...args) {
      if (/retrieval-runtime|onnxruntime|tokenizers/.test(name)) runtime.push(name);
      return originalLoad.call(this, name === 'better-sqlite3' ? workerData.sqlite : name, ...args);
    };
    const originalPost = parentPort.postMessage.bind(parentPort);
    parentPort.postMessage = reply => originalPost({ ...reply, evidence: { io, network, runtime } });
    require(workerData.compiled);
  `, { eval: true, workerData: { compiled, sqlite: createRequire(import.meta.url).resolve('better-sqlite3'), directory: join(directory, 'model-must-not-read'), cacheDirectory: join(directory, 'cache-must-not-create') } });
  try {
    const request = (payload: unknown) => new Promise<{ id: string | null; ok: boolean; message: string; evidence: { io: unknown[]; network: unknown[]; runtime: unknown[] } }>((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('实际Worker未及时返回')), 5000);
      worker.once('error', reject);
      worker.once('message', message => { clearTimeout(timer); accept(message); });
      worker.postMessage(payload);
    });
    for (const [id, command] of [['load-1', 'load'], ['load-2', 'load'], ['search-1', 'search'], ['index-1', 'index']]) {
      const reply = await request({ id, command, payload: {} });
      expect(reply).toMatchObject({ id, ok: false, message: '本机模型执行失败，请使用关键词检索。' });
      expect(reply.evidence).toEqual({ io: [], network: [], runtime: [] });
    }
    for (const input of [null, [], 123, { id: 'invalid', command: 'not-a-command' }]) {
      const reply = await request(input);
      expect(reply.ok).toBe(false); expect(reply.evidence).toEqual({ io: [], network: [], runtime: [] });
    }
    const alive = await request({ id: 'still-alive', command: 'load', payload: {} });
    expect(alive).toMatchObject({ id: 'still-alive', ok: false });
    expect(await readdir(directory)).toEqual(['retrieval-worker.cjs']);
  } finally { await worker.terminate(); }
}, 15000);
