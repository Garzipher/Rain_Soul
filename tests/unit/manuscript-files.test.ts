import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { chooseLocalManuscript, saveLocalExport } from '../../src/main/manuscript-files';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function folder() { const dir = mkdtempSync(join(tmpdir(), 'rainsoul-files-')); dirs.push(dir); return dir; }
it('仅打开系统对话框选定文件，取消不读取；大小超限不截断', async () => {
  const dir = folder(), path = join(dir, '稿件.txt'); writeFileSync(path, '初稿');
  expect(await chooseLocalManuscript(async () => ({ canceled: true, filePaths: [] }))).toBeNull();
  expect(await chooseLocalManuscript(async () => ({ canceled: false, filePaths: [path] }))).toEqual({ name: '稿件.txt', bytes: Buffer.from('初稿') });
  await expect(chooseLocalManuscript(async () => ({ canceled: false, filePaths: [path] }), 1)).rejects.toThrow(/超限/);
});
it('取消导出保留文件，原子替换完整内容并清理临时文件', async () => {
  const dir = folder(), path = join(dir, '稿件.txt'); writeFileSync(path, '旧稿');
  expect(await saveLocalExport(async () => ({ canceled: true }), Buffer.from('新稿'))).toBe(false);
  expect(readFileSync(path, 'utf8')).toBe('旧稿');
  expect(await saveLocalExport(async () => ({ canceled: false, filePath: path }), Buffer.from('新稿'))).toBe(true);
  expect(readFileSync(path, 'utf8')).toBe('新稿'); expect(readdirSync(dir)).toEqual(['稿件.txt']);
});
