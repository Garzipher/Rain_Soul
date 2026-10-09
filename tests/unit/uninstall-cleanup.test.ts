import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupLocalData } from '../../src/main/uninstall-cleanup';

describe('明确授权后的固定本机目录清理', () => {
  const directories: string[] = [];
  function fixture() {
    const localAppData = mkdtempSync(join(tmpdir(), 'rainsoul-uninstall-')); directories.push(localAppData);
    const data = join(localAppData, 'RainSoul'); mkdirSync(join(data, 'Projects'), { recursive: true });
    writeFileSync(join(data, 'Projects', 'draft.sqlite'), '作者原稿');
    writeFileSync(join(localAppData, 'outside.txt'), '目录外不能删除');
    return { localAppData, data };
  }
  afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
  it('未明确授权时不触碰文件', () => {
    const { localAppData, data } = fixture();
    expect(() => cleanupLocalData({ localAppData, confirmed: false })).toThrow(/明确确认/);
    expect(readFileSync(join(data, 'Projects', 'draft.sqlite'), 'utf8')).toBe('作者原稿');
  });
  it.each([undefined, '', '.', parse(process.cwd()).root])('拒绝非法本机应用目录 %s', localAppData => {
    expect(() => cleanupLocalData({ localAppData, confirmed: true })).toThrow(/目录/);
  });
  it('仅删除固定 RainSoul 子目录，保留同级与漫游数据', () => {
    const { localAppData, data } = fixture();
    mkdirSync(join(localAppData, 'Roaming')); writeFileSync(join(localAppData, 'Roaming', 'cache'), '漫游');
    expect(cleanupLocalData({ localAppData, confirmed: true })).toEqual({ removed: true });
    expect(existsSync(data)).toBe(false);
    expect(readFileSync(join(localAppData, 'outside.txt'), 'utf8')).toBe('目录外不能删除');
    expect(readFileSync(join(localAppData, 'Roaming', 'cache'), 'utf8')).toBe('漫游');
  });
  it('目录不存在时安全完成，且不会新建目录', () => {
    const { localAppData, data } = fixture(); rmSync(data, { recursive: true });
    expect(cleanupLocalData({ localAppData, confirmed: true })).toEqual({ removed: false });
    expect(existsSync(data)).toBe(false);
  });
  it('目标是普通文件时拒绝，保留其内容', () => {
    const { localAppData, data } = fixture(); rmSync(data, { recursive: true }); writeFileSync(data, '不能误删');
    expect(() => cleanupLocalData({ localAppData, confirmed: true })).toThrow(/普通目录/);
    expect(readFileSync(data, 'utf8')).toBe('不能误删');
  });
  it('拒绝目标目录junction，不删除链接目标', () => {
    const { localAppData, data } = fixture(); const outside = join(localAppData, 'outside');
    mkdirSync(outside); writeFileSync(join(outside, 'keep'), '保留'); rmSync(data, { recursive: true }); symlinkSync(outside, data, 'junction');
    expect(() => cleanupLocalData({ localAppData, confirmed: true })).toThrow(/链接/);
    expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('保留');
  });
  it('拒绝子目录junction，尚未删除任何原稿', () => {
    const { localAppData, data } = fixture(); const outside = join(localAppData, 'outside'); mkdirSync(outside);
    writeFileSync(join(outside, 'keep'), '保留'); symlinkSync(outside, join(data, 'linked'), 'junction');
    expect(() => cleanupLocalData({ localAppData, confirmed: true })).toThrow(/链接/);
    expect(readFileSync(join(data, 'Projects', 'draft.sqlite'), 'utf8')).toBe('作者原稿');
    expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('保留');
  });
  it('拒绝祖先junction，真实数据不被触碰', () => {
    const { localAppData, data } = fixture(); const alias = join(localAppData, 'alias'); symlinkSync(localAppData, alias, 'junction');
    expect(() => cleanupLocalData({ localAppData: alias, confirmed: true })).toThrow(/链接/);
    expect(existsSync(data)).toBe(true);
  });
  it('目录被占用导致改名失败时保留原目录，不开始删除', () => {
    const { localAppData, data } = fixture(); const rename = vi.fn(() => { throw new Error('EPERM'); });
    expect(() => cleanupLocalData({ localAppData, confirmed: true }, { rename })).toThrow(/原目录|未删除/);
    expect(readFileSync(join(data, 'Projects', 'draft.sqlite'), 'utf8')).toBe('作者原稿');
    expect(readdirSync(localAppData)).toEqual(expect.arrayContaining(['RainSoul', 'outside.txt']));
  });
  it('删除中断时明确报告隔离路径，不把残缺数据冒充原库', () => {
    const { localAppData, data } = fixture();
    expect(() => cleanupLocalData({ localAppData, confirmed: true }, { unlink: () => { throw new Error('文件占用'); } })).toThrow(/隔离目录/);
    expect(existsSync(data)).toBe(false);
    const isolated = readdirSync(localAppData).find(name => name.startsWith('.RainSoul-uninstall-'))!;
    expect(readFileSync(join(localAppData, isolated, 'Projects', 'draft.sqlite'), 'utf8')).toBe('作者原稿');
  });
  it('原子改名后被替换为junction时拒绝遍历外部目标', () => {
    const { localAppData, data } = fixture(); const outside = join(localAppData, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'keep'), '保留');
    const unlink = vi.fn((path: string) => { unlinkSync(path); });
    expect(() => cleanupLocalData({ localAppData, confirmed: true }, { rename: (source, isolated) => {
      renameSync(source, isolated);
      rmSync(isolated, { recursive: true }); symlinkSync(outside, isolated, 'junction');
    }, unlink })).toThrow(/隔离目录/);
    expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('保留'); expect(unlink).not.toHaveBeenCalled(); expect(existsSync(data)).toBe(false);
  });
  it('全树预检后新出现链接也拒绝遍历', () => {
    const { localAppData } = fixture(); const outside = join(localAppData, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'keep'), '保留');
    expect(() => cleanupLocalData({ localAppData, confirmed: true }, { rename: (source, isolated) => { renameSync(source, isolated); symlinkSync(outside, join(isolated, 'z-link'), 'junction'); } })).toThrow(/隔离目录/);
    expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('保留');
  });
  it('注入删除动作仅接收到同一隔离目录内的文件', () => {
    const { localAppData } = fixture(); const paths: string[] = [];
    cleanupLocalData({ localAppData, confirmed: true }, { unlink: path => { paths.push(path); unlinkSync(path); } });
    expect(paths).toHaveLength(1); expect(dirname(dirname(paths[0]))).toMatch(/\.RainSoul-uninstall-/);
  });
});
