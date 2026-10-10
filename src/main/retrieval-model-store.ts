import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, statfs } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { fixedManifest, modelFingerprint, retrievalModelManifestSchema, type RetrievalModelManifest, type RetrievalModelStatus, type RetrievalModelInstallProgress } from '../shared/retrieval-model';
import { createTrustedModelDownloader } from './retrieval-model-download';

function safePath(path: string): void {
  let current = resolve(path);
  while (true) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('模型路径不允许符号链接。');
    if (basename(current).toLowerCase() === 'projects') throw new Error('模型不能保存或导入作品目录。');
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('模型安装已取消，原模型保持。'); };
async function nextChunk(iterator: AsyncIterator<Uint8Array>, signal?: AbortSignal) {
  cancelled(signal);
  let abort!: () => void;
  const interrupted = new Promise<never>((_, reject) => { abort = () => reject(new Error('模型安装已取消，原模型保持。')); signal?.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([iterator.next(), interrupted]); }
  finally { signal?.removeEventListener('abort', abort); }
}
/** 精确文件白名单；不跟随链接、不运行包内代码，不接受额外文件或嵌套空目录。 */
export async function validateModelDirectory(directory: string, manifest: RetrievalModelManifest = fixedManifest): Promise<void> {
  const trusted = retrievalModelManifestSchema.parse(manifest), root = resolve(directory); safePath(root);
  if (!(await lstat(root)).isDirectory()) throw new Error('模型导入必须是受支持的离线目录。');
  const allowed = new Set(trusted.files.map(file => file.path));
  function walk(current: string): void {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, item.name); safePath(path);
      const name = relative(root, path).split('\\').join('/');
      if (item.isDirectory() && [...allowed].some(file => file.startsWith(name + '/'))) walk(path);
      else if (!item.isFile() || !allowed.has(name)) throw new Error('离线模型包含未知文件或目录。');
    }
  }
  walk(root);
  for (const file of trusted.files) {
    const path = join(root, file.path); safePath(path);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size !== file.bytes) throw new Error('模型文件大小校验失败。');
    const handle = await open(path, 'r');
    let data: Buffer;
    try {
      if ((await handle.stat()).size !== file.bytes) throw new Error('模型文件大小校验失败。');
      data = Buffer.alloc(file.bytes); let offset = 0;
      while (offset < file.bytes) { const read = await handle.read(data, offset, file.bytes - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
      if (offset !== file.bytes || (await handle.stat()).size !== file.bytes) throw new Error('模型文件大小校验失败。');
    } finally { await handle.close(); }
    if (data.length !== file.bytes || createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error('模型文件SHA校验失败。');
  }
}
const pointerSchema = z.object({ generation: z.uuid(), fingerprint: z.string().max(20000), enabled: z.boolean() }).strict();
const localRequest = z.object({ operationId: z.uuid(), source: z.literal('local'), directory: z.string().min(1) }).strict();
const downloadRequest = z.object({ operationId: z.uuid(), source: z.literal('download') }).strict();
interface Dependencies { manifest?: RetrievalModelManifest; download?: (url: string, signal?: AbortSignal) => AsyncIterable<Uint8Array>; freeSpace?: (directory: string) => Promise<number> }
export class RetrievalModelStore {
  private readonly root: string;
  private readonly manifest: RetrievalModelManifest;
  private installing = false;
  private progress: RetrievalModelInstallProgress | null = null;
  constructor(directory: string, private readonly dependencies: Dependencies = {}) {
    this.root = resolve(directory); safePath(this.root);
    this.manifest = retrievalModelManifestSchema.parse(dependencies.manifest ?? fixedManifest);
  }
  getProgress() { return this.progress ? { ...this.progress } : null; }
  private requiredSpace() { return this.manifest.files.reduce((sum, file) => sum + file.bytes, 0) + 8 * 1024 ** 2; }
  private async availableSpace() {
    let existing = this.root;
    while (!lstatSync(existing, { throwIfNoEntry: false })) { const parent = dirname(existing); if (parent === existing) throw new Error('无法确认模型安装磁盘空间。'); existing = parent; }
    safePath(existing);
    const bytes = this.dependencies.freeSpace ? await this.dependencies.freeSpace(existing) : await statfs(existing, { bigint: true }).then(stat => Number(stat.bavail * stat.bsize));
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error('无法确认模型安装磁盘空间。'); return bytes;
  }
  private async pointer() {
    const path = join(this.root, 'active.json'); safePath(path);
    const stat = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return null;
    if (!stat.isFile() || stat.size > 20000) throw new Error('模型激活记录无效。');
    const value = pointerSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    if (value.fingerprint !== modelFingerprint(this.manifest)) throw new Error('模型版本已变化，请重新安装。');
    return value;
  }
  private async writePointer(value: z.infer<typeof pointerSchema>, signal?: AbortSignal) {
    safePath(this.root); await mkdir(this.root, { recursive: true }); safePath(this.root);
    const temporary = join(this.root, `.pointer-${randomUUID()}.tmp`), target = join(this.root, 'active.json');
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
      safePath(target); cancelled(signal); await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  }
  async getStatus(): Promise<RetrievalModelStatus> {
    const base = { modelId: this.manifest.modelId, fingerprint: modelFingerprint(this.manifest), bytes: this.manifest.files.reduce((sum, file) => sum + file.bytes, 0), qualified: Object.values(this.manifest.qualification).every(Boolean), requiredSpaceBytes: this.requiredSpace(), availableSpaceBytes: await this.availableSpace().catch(() => undefined), progress: this.getProgress() };
    try {
      const pointer = await this.pointer();
      if (pointer) await validateModelDirectory(join(this.root, pointer.generation), this.manifest);
      return { ...base, installed: !!pointer, state: this.installing ? 'installing' : !pointer ? 'absent' : pointer.enabled ? 'ready' : 'disabled' };
    } catch { return { ...base, installed: false, state: 'error', message: '本机模型校验失败，原文件保留；关键词仍可使用。' }; }
  }
  async getActiveDirectory(): Promise<string | null> {
    try {
      const pointer = await this.pointer(); if (!pointer?.enabled || !Object.values(this.manifest.qualification).every(Boolean)) return null;
      const directory = join(this.root, pointer.generation); await validateModelDirectory(directory, this.manifest); return directory;
    } catch { return null; }
  }
  async setEnabled(enabled: boolean): Promise<void> {
    z.boolean().parse(enabled); if (this.installing) throw new Error('模型安装正在进行，请稍后重试。');
    if (enabled && !Object.values(this.manifest.qualification).every(Boolean)) throw new Error('模型资格核验尚未完成，关键词检索仍可使用。');
    const pointer = await this.pointer(); if (pointer) await this.writePointer({ ...pointer, enabled });
  }
  async install(value: { operationId: string; source: 'local' | 'download'; directory?: string }, signal?: AbortSignal): Promise<void> {
    const request = z.discriminatedUnion('source', [localRequest, downloadRequest]).parse(value);
    if (this.installing) throw new Error('模型安装正在进行，请勿重复安装。');
    this.installing = true;
    this.progress = { operationId: request.operationId, source: request.source, phase: 'checking-space', receivedBytes: 0, totalBytes: this.manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
    const generation = randomUUID(), stage = join(this.root, `.stage-${generation}`), destination = join(this.root, generation);
    let activated = false;
    try {
      cancelled(signal); if (await this.availableSpace() < this.requiredSpace()) throw new Error('模型安装磁盘空间不足，原模型保持。'); cancelled(signal);
      safePath(this.root); mkdirSync(this.root, { recursive: true }); safePath(this.root);
      await mkdir(stage); safePath(stage);
      if (request.source === 'local') await validateModelDirectory(request.directory, this.manifest);
      const download = this.dependencies.download ?? createTrustedModelDownloader();
      for (const file of this.manifest.files) {
        cancelled(signal);
        this.progress.phase = request.source === 'local' ? 'copying' : 'downloading'; this.progress.file = file.path;
        const path = join(stage, file.path); await mkdir(dirname(path), { recursive: true }); safePath(path);
        const handle = await open(path, 'wx', 0o600);
        try {
          const source = request.source === 'local' ? join(request.directory, file.path) : null;
          if (source) safePath(source);
          const stream = source ? createReadStream(source) : null;
          const url = `https://huggingface.co/${this.manifest.repository}/resolve/${this.manifest.revision}/${file.path}`;
          const iterator = (stream ?? download(url, signal))[Symbol.asyncIterator]();
          let length = 0;
          try {
            while (true) {
              const item = await nextChunk(iterator, signal); if (item.done) break;
              const chunk = item.value; cancelled(signal); length += chunk.byteLength;
              if (length > file.bytes) throw new Error('模型下载大小超过清单上限。');
              await handle.writeFile(chunk);
              this.progress.receivedBytes += chunk.byteLength;
            }
          } finally { stream?.destroy(); void iterator.return?.().catch(() => undefined); }
          await handle.sync();
        } finally { await handle.close(); }
      }
      cancelled(signal); this.progress.phase = 'verifying'; await validateModelDirectory(stage, this.manifest); cancelled(signal);
      safePath(destination); await rename(stage, destination); cancelled(signal);
      this.progress.phase = 'activating';
      await this.writePointer({ generation, fingerprint: modelFingerprint(this.manifest), enabled: Object.values(this.manifest.qualification).every(Boolean) }, signal); activated = true;
    } finally {
      this.installing = false;
      this.progress = null;
      const cleanup = async (path: string) => {
        const child = relative(this.root, resolve(path));
        if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('模型临时清理路径越界。');
        safePath(path); await rm(path, { recursive: true, force: true });
      };
      await cleanup(stage); if (!activated) await cleanup(destination);
    }
  }
}
