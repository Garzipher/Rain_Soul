import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveCoordinator, SaveValidationError } from '../../src/renderer/lib/save-coordinator';

describe('自动保存协调器', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('停顿500ms才提交最新草稿', async () => {
    const saved: string[] = [];
    const coordinator = new SaveCoordinator<string>({ save: async value => { saved.push(value); }, onStatusChange: () => {} });
    coordinator.update('旧');
    await vi.advanceTimersByTimeAsync(300);
    coordinator.update('新');
    await vi.advanceTimersByTimeAsync(499);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual(['新']);
    expect(coordinator.status.phase).toBe('clean');
    coordinator.dispose();
  });
  it('持续输入不重置最长提交时限', async () => {
    const saved: number[] = [];
    const coordinator = new SaveCoordinator<number>({ save: async value => { saved.push(value); }, onStatusChange: () => {} });
    coordinator.update(0);
    for (let index = 1; index <= 12; index++) {
      await vi.advanceTimersByTimeAsync(400);
      coordinator.update(index);
    }
    expect(saved).toEqual([11]);
    coordinator.dispose();
  });
  it('旧回执不能把正在写的新内容标为已保存，flush等完新批次', async () => {
    let resolveFirst!: () => void;
    const saved: string[] = [];
    const coordinator = new SaveCoordinator<string>({
      save: async value => { saved.push(value); if (value === '旧') await new Promise<void>(resolve => { resolveFirst = resolve; }); },
      onStatusChange: () => {},
    });
    coordinator.update('旧');
    await vi.advanceTimersByTimeAsync(500);
    coordinator.update('新');
    resolveFirst();
    await coordinator.flush();
    expect(saved).toEqual(['旧', '新']);
    expect(coordinator.status.phase).toBe('clean');
    coordinator.dispose();
  });
  it('失败保留草稿，flush不擅自重试，显式retry提交最新草稿', async () => {
    let fail = true;
    const saved: string[] = [];
    const coordinator = new SaveCoordinator<string>({
      save: async value => { saved.push(value); if (fail) throw new Error('磁盘满'); }, onStatusChange: () => {},
    });
    coordinator.update('原');
    await vi.advanceTimersByTimeAsync(500);
    expect(coordinator.status).toEqual({ phase: 'failed', error: '磁盘满' });
    coordinator.update('最新');
    await vi.advanceTimersByTimeAsync(6000);
    await expect(coordinator.flush()).rejects.toThrow('磁盘满');
    expect(saved).toEqual(['原']);
    fail = false;
    await coordinator.retry();
    expect(saved).toEqual(['原', '原', '最新']);
    coordinator.dispose();
  });
  it('离开前立即保存，释放后不再触发定时写入', async () => {
    const saved: string[] = [];
    const coordinator = new SaveCoordinator<string>({ save: async value => { saved.push(value); }, onStatusChange: () => {} });
    coordinator.update('离开前');
    await coordinator.flush();
    coordinator.dispose();
    await vi.advanceTimersByTimeAsync(6000);
    expect(saved).toEqual(['离开前']);
  });
  it('提交成功但回执丢失时先重取原操作回执，再保存期间的新草稿', async () => {
    let remoteRevision = 1;
    let knownRevision = 1;
    const operations = new Map<string, number>();
    const saved: string[] = [];
    const coordinator = new SaveCoordinator<string>({
      save: async value => {
        if (operations.has(value)) { knownRevision = operations.get(value)!; return; }
        if (knownRevision !== remoteRevision) throw new Error('版本冲突');
        operations.set(value, ++remoteRevision);
        saved.push(value);
        if (value === '旧操作') throw new Error('回执丢失');
        knownRevision = remoteRevision;
      }, onStatusChange: () => {},
    });
    coordinator.update('旧操作');
    await vi.advanceTimersByTimeAsync(500);
    coordinator.update('新草稿');
    await coordinator.retry();
    expect(saved).toEqual(['旧操作', '新草稿']);
    expect(coordinator.status.phase).toBe('clean');
    coordinator.dispose();
  });
  it('确定未提交的校验失败允许改正后重试最新草稿', async () => {
    const attempted: string[] = [];
    const coordinator = new SaveCoordinator<string>({
      save: async title => { attempted.push(title); if (!title.trim()) throw new SaveValidationError('标题不能为空'); },
      onStatusChange: () => {},
    });
    coordinator.update('');
    await vi.advanceTimersByTimeAsync(500);
    coordinator.update('改正后的标题');
    await coordinator.retry();
    expect(attempted).toEqual(['', '改正后的标题']);
    expect(coordinator.status.phase).toBe('clean');
    coordinator.dispose();
  });
});
