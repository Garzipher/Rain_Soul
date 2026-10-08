import { setTimeout } from 'node:timers/promises';
import process from 'node:process';

/** 只缓解 Windows 重命名后短暂的 open 文件锁；其他故障保持原样抛出。 */
export async function retryWindowsFileOperation(operation, { platform = process.platform, delay = setTimeout } = {}) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (platform !== 'win32' || error?.code !== 'UNKNOWN' || error?.syscall !== 'open' || attempt === 5) throw error;
      await delay(1500);
    }
  }
}
