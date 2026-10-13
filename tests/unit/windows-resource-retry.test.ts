import { expect, it } from 'vitest';
import { installWindowsResourceRetry } from '../../scripts/windows-resource-retry.mjs';

it('资源编辑保留原函数接收者、完整参数与结果，短暂open锁仅重跑原操作', async () => {
  const error = Object.assign(new Error('短暂锁'), { code: 'UNKNOWN', syscall: 'open' });
  const options = { file: 'RainSoul.exe', fileVersion: '1.3.0', productVersion: '1.3.0', iconPath: 'demo-logo.ico', requestedExecutionLevel: 'asInvoker' };
  const waits: number[] = [], calls: unknown[][] = [];
  const editor = { marker: '原接收者', async editWindowsResources(this: { marker: string }, ...args: unknown[]) {
    expect(this.marker).toBe('原接收者'); calls.push(args); if(calls.length<3) throw error; return '版本、图标、manifest全部完成';
  } };
  installWindowsResourceRetry(editor, { platform: 'win32', delay: async (ms: number) => { waits.push(ms); } });
  expect(await editor.editWindowsResources(options)).toBe('版本、图标、manifest全部完成');
  expect(calls).toEqual([[options], [options], [options]]); expect(waits).toEqual([1500, 1500]);
});
it('资源编辑持续open锁最多五次，保留原始失败', async () => {
  const error = Object.assign(new Error('持续锁'), { code: 'EBUSY', syscall: 'open' });
  let attempts=0; const waits: number[]=[];
  const editor={async editWindowsResources(){attempts++;throw error;}};
  installWindowsResourceRetry(editor,{platform:'win32',delay:async(ms:number)=>{waits.push(ms);}});
  await expect(editor.editWindowsResources()).rejects.toBe(error); expect(attempts).toBe(5); expect(waits).toEqual([1500,1500,1500,1500]);
});
it.each([['linux','UNKNOWN','open'],['win32','EACCES','open'],['win32','UNKNOWN','write']])('资源真实失败 %s/%s/%s 不重试或跳过',async(platform,code,syscall)=>{
  const error=Object.assign(new Error('资源编辑失败'),{code,syscall});let attempts=0;
  const editor={async editWindowsResources(){attempts++;throw error;}};
  installWindowsResourceRetry(editor,{platform,delay:async()=>{throw new Error('不能等待');}});
  await expect(editor.editWindowsResources()).rejects.toBe(error);expect(attempts).toBe(1);
});
it('上游资源编辑接口变化立即停止，不提供空函数绕过',()=>{
  expect(()=>installWindowsResourceRetry({})).toThrow(/接口/);
});
