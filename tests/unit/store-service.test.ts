import { describe, expect, it } from 'vitest';
import { StoreService } from '../../src/main/store-service';
import { emptyDocument } from '../../src/shared/document';

describe('主进程作品权限', () => {
  it('没有打开作品时不能提交章节', async () => {
    const service = new StoreService(async () => ({}));
    await expect(service.execute('saveChapter', { workId: crypto.randomUUID(), chapterId: crypto.randomUUID(), title: '第一章', document: emptyDocument(), expectedRevision: 1, operationId: crypto.randomUUID() })).rejects.toThrow('当前作品');
  });
  it('只允许当前作品写入，切换后原作品命令被拒绝', async () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const writes: string[] = [];
    const service = new StoreService(async (command, value) => {
      if (command === 'openWork') return { id: (value as { id: string }).id, title: '作品', revision: 1, chapters: [] };
      writes.push(command);
      return { revision: 2, wordCount: 0 };
    });
    await service.execute('openWork', { id: first });
    await service.execute('addChapter', { workId: first, title: '章', expectedRevision: 1, operationId: crypto.randomUUID() });
    await service.execute('openWork', { id: second });
    await expect(service.execute('addChapter', { workId: first, title: '章', expectedRevision: 1, operationId: crypto.randomUUID() })).rejects.toThrow('当前作品');
    expect(writes).toEqual(['addChapter']);
  });
  it('拒绝未知命令、路径伪装和未知字段，不发送到Worker', async () => {
    let calls = 0;
    const service = new StoreService(async () => { calls++; });
    await expect(service.execute('sql', { sql: 'DROP TABLE chapter' })).rejects.toThrow();
    await expect(service.execute('openWork', { id: '../project.sqlite' })).rejects.toThrow();
    await expect(service.execute('createWork', { title: '雨', path: 'E:\\' })).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it('打开失败不改变当前作品权限', async () => {
    const id = crypto.randomUUID();
    const service = new StoreService(async (command, value) => {
      if (command === 'openWork') {
        if ((value as { id: string }).id !== id) throw new Error('读失败');
        return { id };
      }
      return '成功';
    });
    await service.execute('openWork', { id });
    await expect(service.execute('openWork', { id: crypto.randomUUID() })).rejects.toThrow('读失败');
    await expect(service.execute('addChapter', { workId: id, title: '章', expectedRevision: 1, operationId: crypto.randomUUID() })).resolves.toBe('成功');
  });
});
