import { expect, it, vi } from 'vitest';
import { BookExtractionCommands } from '../../src/main/book-extraction-commands';
import type { BookExtractionPreview } from '../../src/shared/book-extraction';
import { Document, Packer, Paragraph } from 'docx';

function setup() {
  const workId = crypto.randomUUID();
  const store = { execute: vi.fn(async (_command: string, _payload: unknown) => ({ id: workId })) };
  const files = { choose: vi.fn(async () => ({ name: '参考.txt', bytes: Buffer.from('第一章 雨夜\n雨落在窗上。\n灯火很暖。') } as { name: string; bytes: Buffer } | null)) };
  return { workId, store, files, commands: new BookExtractionCommands(store, files) };
}
it('只预览不落库，确认只提交已审核段落，出处由冻结文件重建', async () => {
  const { workId, store, commands } = setup();
  const preview = await commands.execute('chooseBookExtraction', { workId, encoding: 'utf-8' }) as BookExtractionPreview;
  expect(store.execute).not.toHaveBeenCalled(); expect(preview.segments).toHaveLength(2);
  const request = { workId, token: preview.token, expectedRevision: 1, operationId: crypto.randomUUID(), sourceTitle: '优秀作品', sourceAuthor: '原作者', permissionConfirmed: true,
    items: [{ segmentId: preview.segments[1].id, body: '审核后的灯火描写', categoryId: crypto.randomUUID(), tagIds: [] }] };
  await commands.execute('confirmBookExtraction', request);
  expect(store.execute).toHaveBeenCalledWith('importBookExtraction', expect.objectContaining({ workId, items: [expect.objectContaining({ body: '审核后的灯火描写', source: expect.stringContaining('第2段') })] }));
  const commit = store.execute.mock.calls[0][1] as { items: { source: string }[] };
  expect(commit.items[0].source).toContain(preview.fileHash); expect(commit.items[0].source).toContain('原作者'); expect(commit.items[0].source).not.toContain('雨落在窗上');
  await expect(commands.execute('confirmBookExtraction', { ...request, source: '伪造来源' })).rejects.toThrow();
  await expect(commands.execute('confirmBookExtraction', { ...request, workId: crypto.randomUUID() })).rejects.toThrow(/预览/);
  await expect(commands.execute('confirmBookExtraction', { ...request, permissionConfirmed: false })).rejects.toThrow();
  await expect(commands.execute('confirmBookExtraction', { ...request, items: [{ ...request.items[0], segmentId: crypto.randomUUID() }] })).rejects.toThrow(/段落/);
});
it('取消使预览失效；文件替换使旧token失效；失败同请求可以重试', async () => {
  const { workId, store, commands, files } = setup();
  const preview = await commands.execute('chooseBookExtraction', { workId, encoding: 'utf-8' }) as BookExtractionPreview;
  const request = { workId, token: preview.token, expectedRevision: 1, operationId: crypto.randomUUID(), sourceTitle: '书名', sourceAuthor: '', permissionConfirmed: true,
    items: [{ segmentId: preview.segments[0].id, body: '雨落在窗上。', categoryId: crypto.randomUUID(), tagIds: [] }] };
  store.execute.mockRejectedValueOnce(new Error('磁盘已满'));
  await expect(commands.execute('confirmBookExtraction', request)).rejects.toThrow('磁盘已满');
  await commands.execute('confirmBookExtraction', request);
  await commands.execute('cancelBookExtraction', { token: preview.token });
  await expect(commands.execute('confirmBookExtraction', request)).rejects.toThrow(/预览/);
  expect(store.execute).toHaveBeenCalledTimes(2);
  files.choose.mockResolvedValueOnce(null);
  expect(await commands.execute('chooseBookExtraction', { workId, encoding: 'utf-8' })).toBeNull();
});
it('DOCX解析真实正文；拒绝任意路径、非支持格式、重复段落和空审核', async () => {
  const { workId, files, commands, store } = setup();
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('景物的光影')] }] }));
  files.choose.mockResolvedValueOnce({ name: '作品.docx', bytes });
  const preview = await commands.execute('chooseBookExtraction', { workId, encoding: 'utf-8' }) as BookExtractionPreview;
  expect(preview.format).toBe('docx'); expect(preview.segments[0].text).toBe('景物的光影');
  const item = { segmentId: preview.segments[0].id, body: '景物的光影', categoryId: crypto.randomUUID(), tagIds: [] };
  const request = { workId, token: preview.token, expectedRevision: 1, operationId: crypto.randomUUID(), sourceTitle: '作品', sourceAuthor: '', permissionConfirmed: true };
  await expect(commands.execute('confirmBookExtraction', { ...request, items: [item, item] })).rejects.toThrow();
  await expect(commands.execute('confirmBookExtraction', { ...request, items: [] })).rejects.toThrow();
  await expect(commands.execute('chooseBookExtraction', { workId, encoding: 'utf-8', path: 'C:/secret' })).rejects.toThrow();
  files.choose.mockResolvedValueOnce({ name: '作品.pdf', bytes });
  await expect(commands.execute('chooseBookExtraction', { workId, encoding: 'utf-8' })).rejects.toThrow(/TXT/);
  await expect(commands.execute('confirmBookExtraction', { ...request, items: [item] })).rejects.toThrow(/预览/);
  await expect(commands.execute('unknown', {})).rejects.toThrow(/未知/);
  expect(store.execute).not.toHaveBeenCalled(); await commands.drain();
});
it('冻结预览不受渲染层修改影响，新文件取代旧预览，取消其他token不影响当前预览', async () => {
  const { workId, commands, store } = setup();
  const old = await commands.execute('chooseBookExtraction', { workId, encoding: 'utf-8' }) as BookExtractionPreview;
  const current = await commands.execute('chooseBookExtraction', { workId, encoding: 'utf-8' }) as BookExtractionPreview;
  current.filename = '伪造.txt'; current.segments[0].text = '替换原文';
  const request = { workId, token: current.token, expectedRevision: 1, operationId: crypto.randomUUID(), sourceTitle: '书名', sourceAuthor: '', permissionConfirmed: true,
    items: [{ segmentId: current.segments[0].id, body: '摘选内容', categoryId: crypto.randomUUID(), tagIds: [] }] };
  await expect(commands.execute('confirmBookExtraction', { ...request, token: old.token })).rejects.toThrow(/预览/);
  await commands.execute('cancelBookExtraction', { token: old.token });
  await commands.execute('confirmBookExtraction', request);
  expect(store.execute).toHaveBeenCalledWith('importBookExtraction', expect.objectContaining({ items: [expect.objectContaining({ source: expect.stringContaining('参考.txt') })] }));
});
it('AI只读取主进程冻结预览，拒绝跨作品及过期token，调用方不能改动真实来源', async () => {
  const { commands, workId } = setup();
  expect(() => commands.getPreview(workId, crypto.randomUUID())).toThrow(/预览/);
  const preview = await commands.execute('chooseBookExtraction', { workId, encoding: 'utf-8' }) as BookExtractionPreview;
  const frozen = commands.getPreview(workId, preview.token);
  frozen.filename = '伪造.txt'; frozen.segments[0].text = '伪造摘录';
  expect(commands.getPreview(workId, preview.token)).toEqual(preview);
  expect(() => commands.getPreview(crypto.randomUUID(), preview.token)).toThrow(/预览/);
  await commands.execute('cancelBookExtraction', { token: preview.token });
  expect(() => commands.getPreview(workId, preview.token)).toThrow(/预览/);
});
