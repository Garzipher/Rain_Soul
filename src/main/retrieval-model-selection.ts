import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

const fingerprint = z.string().min(1).max(19000);
const preference = { schemaVersion: z.literal(1), fingerprint, enabled: z.boolean(), legacyDisabled: z.boolean().optional() };
const selectionSchema = z.discriminatedUnion('source', [
  z.object({ ...preference, source: z.literal('bundled'), userGeneration: z.uuid().optional() }).strict(),
  z.object({ ...preference, source: z.literal('user'), userGeneration: z.uuid() }).strict(),
]);
const pointerSchema = z.object({ generation: z.uuid(), fingerprint, enabled: z.boolean() }).strict();
export type ModelSelection = z.infer<typeof selectionSchema>;
const pending = new Map<string, Promise<unknown>>();
function serialize<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const key = resolve(directory).toLowerCase(), previous = pending.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(action);
  pending.set(key, result);
  void result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => undefined);
  return result;
}

function safePath(path: string): void {
  let current = resolve(path);
  while (true) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('模型选择路径不允许符号链接。');
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}
async function readRecord(path: string): Promise<unknown | undefined> {
  safePath(path);
  let handle;
  try { handle = await open(path, 'r'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 20000) throw new Error('模型选择记录无效。');
    // 有界读取；文件在读取期间增长也不能造成无上限内存分配。
    const buffer = Buffer.alloc(20001);
    let offset = 0;
    while (offset < buffer.length) { const result = await handle.read(buffer, offset, buffer.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
    if (offset > 20000) throw new Error('模型选择记录超过容量上限。');
    return JSON.parse(buffer.subarray(0, offset).toString('utf8'));
  } finally { await handle.close(); }
}
function currentVersion(value: ModelSelection, expected: string): ModelSelection {
  if (value.fingerprint !== expected) throw new Error('模型版本已变化，原选择记录保留，请修复当前来源。');
  return value;
}
/** 优先读取明确选择；仅没有选择文件时幂等迁移旧手动来源，坏记录不猜测。 */
async function readSelection(directory: string, expectedFingerprint: string): Promise<ModelSelection | null> {
  const selection = await readRecord(join(directory, 'selection.json'));
  if (selection !== undefined) return currentVersion(selectionSchema.parse(selection), expectedFingerprint);
  const pointer = await readRecord(join(directory, 'active.json'));
  if (pointer === undefined) return null;
  const legacy = pointerSchema.parse(pointer);
  const migrated = currentVersion({ schemaVersion: 1, source: 'user', userGeneration: legacy.generation, fingerprint: legacy.fingerprint, enabled: legacy.enabled, legacyDisabled: !legacy.enabled }, expectedFingerprint);
  await writeSelection(directory, migrated);
  return migrated;
}
/** 同目录临时文件写入并 fsync 后原子替换；从不删除旧 active.json。 */
async function writeSelection(directory: string, value: ModelSelection, signal?: AbortSignal): Promise<void> {
  const validated = selectionSchema.parse(value), contents = JSON.stringify(validated);
  if (Buffer.byteLength(contents) > 20000) throw new Error('模型选择记录超过容量上限。');
  safePath(directory); await mkdir(directory, { recursive: true }); safePath(directory);
  const temporary = join(directory, `.selection-${randomUUID()}.tmp`), target = join(directory, 'selection.json');
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
    safePath(target);
    if (signal?.aborted) throw new Error('模型安装已取消，原模型保持。');
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}
export function readModelSelection(directory: string, expectedFingerprint: string): Promise<ModelSelection | null> {
  return serialize(directory, () => readSelection(directory, expectedFingerprint));
}
export function writeModelSelection(directory: string, value: ModelSelection, signal?: AbortSignal): Promise<void> {
  return serialize(directory, () => writeSelection(directory, value, signal));
}
