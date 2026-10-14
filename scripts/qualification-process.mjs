import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';

/** close同时等待进程与输出管道；超时还须等待本次Windows进程树终止。 */
export function waitForQualificationProcess(child, readLog, { platform = process.platform, timeoutMs = 180000, cleanupTimeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let timedOut = false, childClosed = false, treeClosed = true, exitCode, failure, treeFailure, cleanupTimer;
    const timeoutError = () => new Error(`实际Electron夹具超过${timeoutMs / 1000}秒，结果不能放行。\n${readLog()}`);
    const incomplete = error => Object.assign(error, { processCleanupIncomplete: true });
    const finish = () => {
      if (!childClosed || !treeClosed) return;
      clearTimeout(timer); clearTimeout(cleanupTimer);
      if (timedOut) {
        const error = timeoutError();
        reject(treeFailure ? incomplete(new AggregateError([error, treeFailure], `${error.message}\n进程树清理失败：${treeFailure.message}`)) : error);
      } else if (failure) reject(failure);
      else if (exitCode === 0) resolve();
      else reject(new Error(`Electron夹具退出码${exitCode}\n${readLog()}`));
    };
    child.once('error', error => { failure = error; clearTimeout(timer); });
    child.once('close', code => { childClosed = true; exitCode = code; finish(); });
    const timer = setTimeout(() => {
      timedOut = true;
      cleanupTimer = setTimeout(() => {
        const error = timeoutError();
        reject(incomplete(new AggregateError([error, treeFailure].filter(Boolean), `${error.message}\n进程树未在${cleanupTimeoutMs / 1000}秒清理期限内关闭，保留临时档案。`)));
      }, cleanupTimeoutMs);
      if (platform === 'win32' && child.pid) {
        treeClosed = false;
        try {
          const termination = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          termination.once('error', error => { treeFailure = error; });
          termination.once('close', code => {
            treeClosed = true;
            if (code !== 0) treeFailure ??= new Error(`taskkill退出码${code}`);
            finish();
          });
        } catch (error) { treeClosed = true; treeFailure = error; finish(); }
      } else {
        try { if (!child.kill()) treeFailure = new Error('未能终止Electron测试进程。'); }
        catch (error) { treeFailure = error; }
        finish();
      }
    }, timeoutMs);
  });
}
