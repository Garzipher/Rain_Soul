import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { lstat, open, readFile, rename, rm } from 'node:fs/promises';

export async function chooseLocalManuscript(choose: () => Promise<{ canceled: boolean; filePaths: string[] }>, maxBytes = 128 * 1024 * 1024) {
  const selection = await choose(); if (selection.canceled || !selection.filePaths[0]) return null;
  const path = selection.filePaths[0], stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('请选择普通本地文件。');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || stat.size > maxBytes) throw new Error('文件大小超限，未读取或截断内容。');
  const bytes = await readFile(path); if (bytes.length > maxBytes) throw new Error('文件大小超限，未截断内容。');
  return { name: basename(path), bytes };
}

/** 临时文件与目标同目录，全部写入并同步后才替换；失败保留旧文件。 */
export async function saveLocalExport(choose: () => Promise<{ canceled: boolean; filePath?: string }>, bytes: Buffer): Promise<boolean> {
  const selection = await choose(); if (selection.canceled || !selection.filePath) return false;
  const path = selection.filePath;
  const stat = await lstat(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('导出目标必须是普通文件。');
  const temporary = join(dirname(path), `.rainsoul-export-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path); return true;
  } finally { await rm(temporary, { force: true }); }
}
