import { describe, expect, it } from 'vitest';
import { StoreService } from '../../src/main/store-service';
import { emptyDocument } from '../../src/shared/document';

describe('主进程作品权限', () => {
  it('知识更新审核协议穿过存储边界保留目标与空标签，异作和无目标更新不进入Worker', async () => {
    const workId = crypto.randomUUID(), calls: unknown[] = [];
    const service = new StoreService(async (command, payload) => {
      calls.push({ command, payload }); return command === 'openWork' ? { id: workId } : '成功';
    });
    await service.execute('openWork', { id: workId });
    const request = { workId, candidate: {}, operationId: crypto.randomUUID(), items: [{ mode: 'update', targetId: crypto.randomUUID(), body: '审核内容', source: '', tagIds: [] }] };
    await expect(service.execute('approveAiKnowledge', request)).resolves.toBe('成功');
    expect(calls.at(-1)).toEqual({ command: 'approveAiKnowledge', payload: request });
    const before = calls.length;
    await expect(service.execute('approveAiKnowledge', { ...request, workId: crypto.randomUUID() })).rejects.toThrow(/当前作品/);
    await expect(service.execute('approveAiKnowledge', { ...request, items: [{ ...request.items[0], targetId: undefined }] })).rejects.toThrow();
    expect(calls).toHaveLength(before);
  });
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
  it('结构修改只写当前作品，恢复作品是明确的全局例外', async () => {
    const workId = crypto.randomUUID();
    const other = crypto.randomUUID();
    const service = new StoreService(async (command) => command === 'openWork' ? { id: workId } : '成功');
    const request = { workId: other, expectedRevision: 1, operationId: crypto.randomUUID(), action: { type: 'renameWork', title: '改名' } };
    await service.execute('openWork', { id: workId });
    await expect(service.execute('manageStructure', request)).rejects.toThrow('当前作品');
    await expect(service.execute('manageStructure', { ...request, action: { type: 'restoreWork' } })).resolves.toBe('成功');
  });
  it('删除当前作品成功后撤销写入权限，失败不撤销', async () => {
    const id = crypto.randomUUID();
    let failing = true;
    const service = new StoreService(async command => {
      if (command === 'openWork') return { id };
      if (command === 'manageStructure' && failing) throw new Error('磁盘忙');
      return null;
    });
    const request = { workId: id, expectedRevision: 1, operationId: crypto.randomUUID(), action: { type: 'deleteWork' } };
    await service.execute('openWork', { id });
    await expect(service.execute('manageStructure', request)).rejects.toThrow('磁盘忙');
    await expect(service.execute('addChapter', { workId: id, title: '章', expectedRevision: 1, operationId: crypto.randomUUID() })).resolves.toBeNull();
    failing = false;
    await service.execute('manageStructure', request);
    await expect(service.execute('manageStructure', request)).resolves.toBeNull();
    await expect(service.execute('manageStructure', { ...request, operationId: crypto.randomUUID() })).rejects.toThrow('当前作品');
    await expect(service.execute('addChapter', { workId: id, title: '章', expectedRevision: 2, operationId: crypto.randomUUID() })).rejects.toThrow('当前作品');
  });
  it('未知结构动作、外来字段或路径不得进入 Worker；已删除列表是只读命令', async () => {
    const calls: string[] = [];
    const service = new StoreService(async command => { calls.push(command); return []; });
    const request = { workId: crypto.randomUUID(), expectedRevision: 1, operationId: crypto.randomUUID() };
    await expect(service.execute('manageStructure', { ...request, action: { type: 'deleteAll' } })).rejects.toThrow();
    await expect(service.execute('manageStructure', { ...request, action: { type: 'restoreWork', file: '../' } })).rejects.toThrow();
    await expect(service.execute('manageStructure', { ...request, action: { type: 'setChapterVolume', chapterId: '../', volumeId: null } })).rejects.toThrow();
    await expect(service.execute('listDeletedWorks', {})).resolves.toEqual([]);
    expect(calls).toEqual(['listDeletedWorks']);
  });
  it('作品已恢复时旧删除回执不能撤销当前作品权限', async () => {
    const id = crypto.randomUUID();
    let deleted = false;
    const service = new StoreService(async (command, payload) => {
      if (command === 'manageStructure') {
        const type = (payload as { action: { type: string } }).action.type;
        if (type === 'restoreWork') deleted = false;
        else if (!deleted) return { id };
        return null;
      }
      return { id };
    });
    await service.execute('openWork', { id });
    const request = { workId: id, expectedRevision: 1, operationId: crypto.randomUUID(), action: { type: 'deleteWork' } };
    deleted = true;
    await service.execute('manageStructure', request);
    await service.execute('manageStructure', { ...request, operationId: crypto.randomUUID(), action: { type: 'restoreWork' } });
    await service.execute('openWork', { id });
    await service.execute('manageStructure', request);
    await expect(service.execute('addChapter', { workId: id, title: '新章', expectedRevision: 3, operationId: crypto.randomUUID() })).resolves.toEqual({ id });
  });
});
