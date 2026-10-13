import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readModelSelection, writeModelSelection } from '../../src/main/retrieval-model-selection';

const roots: string[] = [];
const root = () => { const value = mkdtempSync(join(tmpdir(), 'rainsoul-selection-')); roots.push(value); return value; };
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

it('无记录不会创建选择文件或猜测用户来源', async () => {
  const directory = root();
  expect(await readModelSelection(directory, '当前指纹')).toBeNull();
  expect(readdirSync(directory)).toEqual([]);
});
it.each([true, false])('旧手动选择迁移保留 generation 和 enabled=%s，原记录不变', async enabled => {
  const directory = root(), generation = randomUUID();
  const original = JSON.stringify({ generation, fingerprint: '当前指纹', enabled });
  writeFileSync(join(directory, 'active.json'), original);
  expect(await readModelSelection(directory, '当前指纹')).toEqual({ schemaVersion: 1, source: 'user', userGeneration: generation, fingerprint: '当前指纹', enabled, legacyDisabled: !enabled });
  expect(readFileSync(join(directory, 'active.json'), 'utf8')).toBe(original);
  expect(await readModelSelection(directory, '当前指纹')).toMatchObject({ source: 'user', enabled });
});
it('原子选择记录跨启动保留停用偏好且不残留临时文件', async () => {
  const directory = root();
  await writeModelSelection(directory, { schemaVersion: 1, source: 'bundled', fingerprint: '当前指纹', enabled: false });
  expect(await readModelSelection(directory, '当前指纹')).toMatchObject({ source: 'bundled', enabled: false });
  expect(readdirSync(directory)).toEqual(['selection.json']);
});
it.each(['{', 'null', '[]', JSON.stringify({ schemaVersion: 2 }), ' '.repeat(20001)])('坏选择记录原样保留，不能读取旧激活记录代替', async contents => {
  const directory = root();
  writeFileSync(join(directory, 'selection.json'), contents);
  writeFileSync(join(directory, 'active.json'), JSON.stringify({ generation: randomUUID(), fingerprint: '当前指纹', enabled: true }));
  await expect(readModelSelection(directory, '当前指纹')).rejects.toThrow();
  expect(readFileSync(join(directory, 'selection.json'), 'utf8')).toBe(contents);
});
it('升级指纹不兼容保留原选择，写入非法用户路径不会覆盖记录', async () => {
  const directory = root();
  const original = JSON.stringify({ schemaVersion: 1, source: 'bundled', fingerprint: '旧指纹', enabled: false });
  writeFileSync(join(directory, 'selection.json'), original);
  await expect(readModelSelection(directory, '新指纹')).rejects.toThrow(/版本/);
  await expect(writeModelSelection(directory, { schemaVersion: 1, source: 'user', userGeneration: '../越界', fingerprint: '新指纹', enabled: true })).rejects.toThrow();
  expect(readFileSync(join(directory, 'selection.json'), 'utf8')).toBe(original);
});
it('选择目录 junction 不读取也不覆盖链接目标', async () => {
  const directory = root(), outside = root(), target = join(outside, 'selection.json'), linked = join(directory, 'linked');
  writeFileSync(target, '保留'); symlinkSync(outside, linked, 'junction');
  await expect(readModelSelection(linked, '当前指纹')).rejects.toThrow(/链接/);
  await expect(writeModelSelection(linked, { schemaVersion: 1, source: 'bundled', fingerprint: '当前指纹', enabled: true })).rejects.toThrow(/链接/);
  expect(readFileSync(target, 'utf8')).toBe('保留');
});
it('取消写入不替换原偏好且清理临时文件', async () => {
  const directory = root(), controller = new AbortController();
  await writeModelSelection(directory, { schemaVersion: 1, source: 'bundled', fingerprint: '当前指纹', enabled: false });
  const original = readFileSync(join(directory, 'selection.json'), 'utf8'); controller.abort();
  await expect(writeModelSelection(directory, { schemaVersion: 1, source: 'bundled', fingerprint: '当前指纹', enabled: true }, controller.signal)).rejects.toThrow(/取消/);
  expect(readFileSync(join(directory, 'selection.json'), 'utf8')).toBe(original);
  expect(readdirSync(directory)).toEqual(['selection.json']);
});
it('旧记录迁移和随后显式写入并发时不覆盖新偏好', async () => {
  const directory = root();
  writeFileSync(join(directory, 'active.json'), JSON.stringify({ generation: randomUUID(), fingerprint: '当前指纹', enabled: false }));
  await Promise.all([readModelSelection(directory, '当前指纹'), writeModelSelection(directory, { schemaVersion: 1, source: 'bundled', fingerprint: '当前指纹', enabled: true })]);
  expect(await readModelSelection(directory, '当前指纹')).toMatchObject({ source: 'bundled', enabled: true });
});
