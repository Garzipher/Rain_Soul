import { expect, it, vi } from 'vitest';
import { ManuscriptCommands, freezeExport } from '../../src/main/manuscript-commands';
import type { WorkDetail } from '../../src/shared/contracts';
import { emptyDocument } from '../../src/shared/document';
const work: WorkDetail = { id: crypto.randomUUID(), title: '雨夜', revision: 3, volumes: [], deletedItems: [], chapters: [{ id: crypto.randomUUID(), title: '开篇', volumeId: null, document: emptyDocument(), wordCount: 0 }] };
function setup() {
  const store = { execute: vi.fn<(command: string, payload: unknown) => Promise<unknown>>(async () => structuredClone(work)) };
  const files = { choose: vi.fn(async () => ({ name: '旧稿.txt', bytes: Buffer.from('第一章 雨夜\n正文内容') } as { name: string; bytes: Buffer } | null)), save: vi.fn(async (_name: string, _bytes: Buffer) => true) };
  return { store, files, service: new ManuscriptCommands(store, files) };
}
it('选择只解析预览，确认后创建新作品；未知token拒绝且草稿不执行HTML', async () => {
  const { service, store } = setup();
  const preview = await service.execute('chooseManuscript', { encoding: 'utf-8' }) as { token: string; draft: { title: string; chapters: unknown[] } };
  expect(preview.draft.chapters).toHaveLength(1); expect(store.execute).not.toHaveBeenCalled();
  await expect(service.execute('confirmManuscript', { token: crypto.randomUUID(), operationId: crypto.randomUUID(), draft: preview.draft })).rejects.toThrow(/预览/);
  await service.execute('confirmManuscript', { token: preview.token, operationId: crypto.randomUUID(), draft: { ...preview.draft, title: '新作品' } });
  expect(store.execute).toHaveBeenCalledWith('importManuscript', expect.objectContaining({ draft: expect.objectContaining({ title: '新作品' }) }));
});
it('取消选择、导出取消不写入作品；导出冻结当前卷章一次且未混入私密配置', async () => {
  const { service, store, files } = setup(); files.choose.mockResolvedValueOnce(null);
  expect(await service.execute('chooseManuscript', { encoding: 'utf-8' })).toBeNull();
  expect(store.execute).not.toHaveBeenCalled();
  files.save.mockResolvedValueOnce(false);
  expect(await service.execute('exportManuscript', { workId: work.id, format: 'txt' })).toBe(false);
  expect(store.execute).toHaveBeenCalledTimes(1);
  expect(files.save).toHaveBeenCalledWith('雨夜.txt', expect.any(Buffer));
  expect(files.save.mock.calls[0][1].toString()).toContain('开篇');
});
it('正文净稿通过受限命令导出且文件名明确标注净稿模式', async () => {
  const { service, files } = setup();
  expect(await service.execute('exportManuscript', { workId: work.id, format: 'txt', mode: 'clean' })).toBe(true);
  expect(files.save).toHaveBeenCalledWith('雨夜—正文净稿.txt', expect.any(Buffer));
  await expect(service.execute('exportManuscript', { workId: work.id, format: 'txt', mode: 'sidecar' })).rejects.toThrow();
});
it('拒绝任意文件路径/格式和过期预览，保存失败保持可重试', async () => {
  const { service, files } = setup();
  await expect(service.execute('chooseManuscript', { path: 'C:/secret', encoding: 'utf-8' })).rejects.toThrow();
  await expect(service.execute('exportManuscript', { workId: work.id, format: 'html' })).rejects.toThrow();
  files.save.mockRejectedValueOnce(new Error('磁盘空间不足'));
  await expect(service.execute('exportManuscript', { workId: work.id, format: 'txt' })).rejects.toThrow('磁盘空间不足');
  expect(await service.execute('exportManuscript', { workId: work.id, format: 'txt' })).toBe(true);
});
it.each(['txt', 'docx'] as const)('历史快照%s导出仅请求指定只读快照，不读取当前稿', async format => {
  const { service, store, files } = setup(), snapshotId = crypto.randomUUID();
  const historic = freezeExport(work); historic.title = '旧稿'; historic.revision = 1;
  store.execute.mockImplementation(async command => {
    if (command !== 'freezeSnapshot') throw new Error('历史导出不得读取当前稿或恢复');
    return historic;
  });
  expect(await service.execute('exportManuscript', { workId: work.id, snapshotId, format })).toBe(true);
  expect(store.execute).toHaveBeenCalledExactlyOnceWith('freezeSnapshot', { workId: work.id, snapshotId });
  expect(files.save.mock.calls[0][0]).toContain('旧稿');
  expect(files.save.mock.calls[0][1].length).toBeGreaterThan(0);
});
it('历史快照导出白名单拒绝任意路径、无效ID/格式，校验失败不调用文件保存', async () => {
  const { service, store, files } = setup();
  await expect(service.execute('exportManuscript', { workId: work.id, snapshotId: '../outside', format: 'txt' })).rejects.toThrow();
  await expect(service.execute('exportManuscript', { workId: work.id, snapshotId: crypto.randomUUID(), format: 'txt', path: 'C:/private' })).rejects.toThrow();
  expect(store.execute).not.toHaveBeenCalled();
  store.execute.mockRejectedValueOnce(new Error('快照校验失败'));
  await expect(service.execute('exportManuscript', { workId: work.id, snapshotId: crypto.randomUUID(), format: 'txt' })).rejects.toThrow('快照校验失败');
  expect(files.save).not.toHaveBeenCalled();
});
