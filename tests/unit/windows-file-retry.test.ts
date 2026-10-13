import { describe, expect, it } from 'vitest';
import { retryWindowsFileOperation } from '../../scripts/windows-file-retry.mjs';

describe('Windows 打包临时文件锁重试', () => {
  it('首次成功直接返回结果且不等待', async () => {
    const waits: number[] = [];
    expect(await retryWindowsFileOperation(async () => '完成', { platform: 'win32', delay: async (ms: number) => { waits.push(ms); } })).toBe('完成');
    expect(waits).toEqual([]);
  });

  it.each(['UNKNOWN', 'EBUSY'])('临时 %s open 错误有界等待后仍执行完整原操作', async code => {
    const error = Object.assign(new Error('文件暂时锁定'), { code, syscall: 'open' });
    const waits: number[] = [];
    let attempts = 0;
    const result = await retryWindowsFileOperation(async () => { attempts += 1; if (attempts < 3) throw error; return '完整性已写入'; }, { platform: 'win32', delay: async (ms: number) => { waits.push(ms); } });
    expect(result).toBe('完整性已写入');
    expect(attempts).toBe(3);
    expect(waits).toEqual([1500, 1500]);
  });

  it.each(['UNKNOWN', 'EBUSY'])('%s 五次操作耗尽时保留原错误且只等待四次', async code => {
    const error = Object.assign(new Error('持续锁定'), { code, syscall: 'open' });
    const waits: number[] = [];
    let attempts = 0;
    await expect(retryWindowsFileOperation(async () => { attempts += 1; throw error; }, { platform: 'win32', delay: async (ms: number) => { waits.push(ms); } })).rejects.toBe(error);
    expect(attempts).toBe(5);
    expect(waits).toEqual([1500, 1500, 1500, 1500]);
  });

  it.each([
    ['linux', 'UNKNOWN', 'open'],
    ['linux', 'EBUSY', 'open'],
    ['darwin', 'UNKNOWN', 'open'],
    ['win32', 'EACCES', 'open'],
    ['win32', 'UNKNOWN', 'read'],
    ['win32', 'EBUSY', 'write'],
    ['win32', undefined, undefined],
  ])('平台%s、错误%s、调用%s不触发重试', async (platform, code, syscall) => {
    const error = Object.assign(new Error('真实构建失败'), { code, syscall });
    let attempts = 0;
    const waits: number[] = [];
    await expect(retryWindowsFileOperation(async () => { attempts += 1; throw error; }, { platform, delay: async (ms: number) => { waits.push(ms); } })).rejects.toBe(error);
    expect(attempts).toBe(1);
    expect(waits).toEqual([]);
  });
});
