import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { lstat, mkdir, open, rename, rm, statfs } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { fixedManifest, isRetrievalModelQualified, modelFingerprint, retrievalModelManifestSchema, type RetrievalModelManifest, type RetrievalModelStatus, type RetrievalModelInstallProgress } from '../shared/retrieval-model';
import { createTrustedModelDownloader } from './retrieval-model-download';
import { ModelSelectionVersionError, readModelSelection, readModelSelectionForMaintenance, writeModelSelection, type ModelSelection } from './retrieval-model-selection';

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
const localRequest = z.object({ operationId: z.uuid(), source: z.literal('local'), directory: z.string().min(1) }).strict();
const downloadRequest = z.object({ operationId: z.uuid(), source: z.literal('download') }).strict();
interface Dependencies { manifest?: RetrievalModelManifest; bundledDirectory?: string; download?: (url: string, signal?: AbortSignal) => AsyncIterable<Uint8Array>; freeSpace?: (directory: string) => Promise<number> }
export class RetrievalModelStore {
  private readonly root: string;
  private readonly manifest: RetrievalModelManifest;
  private readonly bundledDirectory?: string;
  private changing = false;
  private installing = false;
  private progress: RetrievalModelInstallProgress | null = null;
  constructor(directory: string, private readonly dependencies: Dependencies = {}) {
    this.root = resolve(directory); safePath(this.root);
    this.manifest = retrievalModelManifestSchema.parse(dependencies.manifest ?? fixedManifest);
    this.bundledDirectory = dependencies.bundledDirectory ? resolve(dependencies.bundledDirectory) : undefined;
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
  private selection() { return readModelSelection(this.root, modelFingerprint(this.manifest)); }
  private defaultSelection(): ModelSelection { return { schemaVersion: 1, source: 'bundled', fingerprint: modelFingerprint(this.manifest), enabled: true }; }
  private selectedDirectory(selection: ModelSelection): string | undefined {
    return selection.source === 'bundled' ? this.bundledDirectory : join(this.root, selection.userGeneration);
  }
  private async bundledPresent() {
    if (!this.bundledDirectory) return false;
    return !!await lstat(this.bundledDirectory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  }
  async getStatus(): Promise<RetrievalModelStatus> {
    const base = { modelId: this.manifest.modelId, fingerprint: modelFingerprint(this.manifest), bytes: this.manifest.files.reduce((sum, file) => sum + file.bytes, 0), qualified: isRetrievalModelQualified(this.manifest), requiredSpaceBytes: this.requiredSpace(), availableSpaceBytes: await this.availableSpace().catch(() => undefined), progress: this.getProgress() };
    let selection: ModelSelection | null = null;
    const bundledPresent = await this.bundledPresent().catch(() => false);
    try {
      selection = await this.selection() ?? this.defaultSelection();
      const directory = this.selectedDirectory(selection);
      const present = selection.source === 'bundled' ? bundledPresent : !!directory;
      if (present && directory) await validateModelDirectory(directory, this.manifest);
      return { ...base, source: selection.source, bundledPresent, enabled: selection.enabled, legacyDisabled: selection.legacyDisabled, installed: present, state: this.installing ? 'installing' : !present ? 'absent' : selection.enabled && base.qualified ? 'ready' : 'disabled' };
    } catch (error) {
      if (error instanceof ModelSelectionVersionError) selection = error.selection;
      return { ...base, ...(selection ? { source: selection.source, enabled: selection.enabled, legacyDisabled: selection.legacyDisabled } : {}), bundledPresent, installed: false, state: 'error',
        message: error instanceof ModelSelectionVersionError ? `${error.message}关键词仍可使用。` : '本机模型或选择记录校验失败，原文件保留；关键词仍可使用。' };
    }
  }
  async getActiveDirectory(): Promise<string | null> {
    try {
      const selection = await this.selection() ?? this.defaultSelection();
      if (!selection.enabled || !isRetrievalModelQualified(this.manifest) || this.changing || this.installing) return null;
      const directory = this.selectedDirectory(selection); if (!directory) return null;
      await validateModelDirectory(directory, this.manifest);
      const current = await this.selection() ?? this.defaultSelection();
      return !this.changing && !this.installing && JSON.stringify(selection) === JSON.stringify(current) ? directory : null;
    } catch { return null; }
  }
  async setEnabled(enabled: boolean): Promise<void> {
    z.boolean().parse(enabled); if (this.installing || this.changing) throw new Error('模型变更正在进行，请稍后重试。');
    if (enabled && !isRetrievalModelQualified(this.manifest)) throw new Error('模型资格核验尚未完成，关键词检索仍可使用。');
    this.changing = true;
    try {
      const selection = await this.selection() ?? this.defaultSelection();
      if (enabled) { const directory = this.selectedDirectory(selection); if (!directory) throw new Error('当前模型来源不存在。'); await validateModelDirectory(directory, this.manifest); }
      await writeModelSelection(this.root, { ...selection, enabled, legacyDisabled: false });
    } finally { this.changing = false; }
  }
  async selectSource(source: 'bundled' | 'user'): Promise<void> {
    z.enum(['bundled', 'user']).parse(source);
    if (this.installing || this.changing) throw new Error('模型变更正在进行，请稍后重试。');
    this.changing = true;
    try {
      const selection = await readModelSelectionForMaintenance(this.root) ?? this.defaultSelection();
      if (source === 'user' && !selection.userGeneration) throw new Error('没有可选择的手动模型。');
      const next = { ...selection, source, fingerprint: modelFingerprint(this.manifest) } as ModelSelection, directory = this.selectedDirectory(next);
      if (!directory) throw new Error('当前模型来源不存在。');
      await validateModelDirectory(directory, this.manifest);
      await writeModelSelection(this.root, next);
    } finally { this.changing = false; }
  }
  async install(value: { operationId: string; source: 'local' | 'download'; directory?: string }, signal?: AbortSignal): Promise<void> {
    const request = z.discriminatedUnion('source', [localRequest, downloadRequest]).parse(value);
    if (this.installing || this.changing) throw new Error('模型变更正在进行，请勿重复安装。');
    this.installing = true;
    this.progress = { operationId: request.operationId, source: request.source, phase: 'checking-space', receivedBytes: 0, totalBytes: this.manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
    const generation = randomUUID(), stage = join(this.root, `.stage-${generation}`), destination = join(this.root, generation);
    let activated = false;
    try {
      const selection = await readModelSelectionForMaintenance(this.root) ?? this.defaultSelection();
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
      await writeModelSelection(this.root, { schemaVersion: 1, source: 'user', userGeneration: generation, fingerprint: modelFingerprint(this.manifest), enabled: selection.enabled, legacyDisabled: selection.legacyDisabled }, signal); activated = true;
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
