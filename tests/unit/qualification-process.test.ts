import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({ spawn: vi.fn(), rm: vi.fn(), writeFile: vi.fn() }));
vi.mock('esbuild', () => ({ build: vi.fn().mockResolvedValue(undefined) }));
vi.mock('node:child_process', () => ({ spawn: dependencies.spawn }));
vi.mock('node:timers', () => ({ setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args), clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer) }));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined), mkdtemp: vi.fn().mockResolvedValue('E:/qualification-fixture'),
  readFile: vi.fn(async (path: string) => path.endsWith('report.json') ? JSON.stringify({ results: [], qualification: {} }) : Buffer.from('fixture')),
  rm: dependencies.rm, writeFile: dependencies.writeFile,
}));
import { qualifyRestrictedRender } from '../../scripts/qualify-restricted-render.mjs';

class ProcessFixture extends EventEmitter {
  pid = 4821;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => true);
}
let child: ProcessFixture, termination: ProcessFixture;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  dependencies.rm.mockResolvedValue(undefined); dependencies.writeFile.mockResolvedValue(undefined);
  child = new ProcessFixture(); termination = new ProcessFixture();
  dependencies.spawn.mockImplementation((command: string) => command === 'taskkill' ? termination : child);
});
afterEach(() => vi.useRealTimers());
async function start() {
  const outcome = qualifyRestrictedRender('E:/qualification-evidence/report.json').then(value => ({ value, error: undefined }),
    (error: Error & { processCleanupIncomplete?: boolean }) => ({ value: undefined, error }));
  await vi.advanceTimersByTimeAsync(0);
  return { outcome };
}

describe('资格工具等待完整进程退出后才删除档案', () => {
  it('正常exit不等于管道close，迟到日志仍写入证据', async () => {
    const { outcome } = await start();
    child.emit('exit', 0); await vi.advanceTimersByTimeAsync(0);
    expect(dependencies.rm).not.toHaveBeenCalled();
    child.stderr.emit('data', Buffer.from('close前的完整诊断')); child.emit('close', 0);
    expect(await outcome).toHaveProperty('value.diagnostics', 'close前的完整诊断');
    expect(dependencies.rm).toHaveBeenCalledOnce();
  });

  it.each(['child-first', 'tree-first'])('超时%s顺序仍等待Electron与整树taskkill双方close', async order => {
    const { outcome } = await start();
    await vi.advanceTimersByTimeAsync(180000);
    expect(dependencies.spawn).toHaveBeenLastCalledWith('taskkill', ['/PID', '4821', '/T', '/F'], expect.objectContaining({ windowsHide: true }));
    if (order === 'child-first') { child.emit('exit', null); child.emit('close', null); }
    else { termination.emit('exit', 0); termination.emit('close', 0); }
    await vi.advanceTimersByTimeAsync(0); expect(dependencies.rm).not.toHaveBeenCalled();
    child.stderr.emit('data', Buffer.from('fixture:infinite-loop-cancel'));
    if (order === 'child-first') { termination.emit('exit', 0); termination.emit('close', 0); }
    else { child.emit('exit', null); child.emit('close', null); }
    expect((await outcome).error?.message).toContain('超过180秒');
    expect((await outcome).error?.message).toContain('fixture:infinite-loop-cancel');
    expect(dependencies.rm).toHaveBeenCalledOnce();
  });

  it('非零退出也等待close并保留最终日志', async () => {
    const { outcome } = await start();
    child.emit('exit', 2); await vi.advanceTimersByTimeAsync(0); expect(dependencies.rm).not.toHaveBeenCalled();
    child.stderr.emit('data', Buffer.from('原始夹具错误')); child.emit('close', 2);
    expect((await outcome).error?.message).toContain('退出码2\n原始夹具错误');
  });

  it('启动失败等close后保留原始错误', async () => {
    const { outcome } = await start(); const error = new Error('Electron无法启动');
    child.emit('error', error); await vi.advanceTimersByTimeAsync(0); expect(dependencies.rm).not.toHaveBeenCalled();
    child.emit('close', -2); expect((await outcome).error).toBe(error);
  });

  it('taskkill失败同时保留超时与清理诊断，等待关闭后才删除', async () => {
    const { outcome } = await start(); await vi.advanceTimersByTimeAsync(180000);
    termination.emit('error', new Error('taskkill无法启动')); await vi.advanceTimersByTimeAsync(0);
    expect(dependencies.rm).not.toHaveBeenCalled();
    termination.emit('close', -2); child.emit('close', null);
    const error = (await outcome).error;
    expect(error?.message).toContain('超过180秒'); expect(error?.message).toContain('taskkill无法启动');
    expect(error?.processCleanupIncomplete).toBe(true); expect(dependencies.rm).not.toHaveBeenCalled();
  });

  it('树无法关闭时有界失败并保留档案，不在存活进程下递归删除', async () => {
    const { outcome } = await start(); await vi.advanceTimersByTimeAsync(190000);
    expect((await outcome).error?.message).toContain('进程树未在10秒清理期限内关闭');
    expect((await outcome).error?.processCleanupIncomplete).toBe(true); expect(dependencies.rm).not.toHaveBeenCalled();
  });

  it('档案清理失败同时保留原始超时及EBUSY', async () => {
    dependencies.rm.mockRejectedValueOnce(new Error('EBUSY锁')); const { outcome } = await start();
    await vi.advanceTimersByTimeAsync(180000); child.emit('close', null); termination.emit('close', 0);
    expect((await outcome).error?.message).toContain('超过180秒'); expect((await outcome).error?.message).toContain('EBUSY锁');
  });
});
