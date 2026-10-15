import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Document, Packer, Paragraph } from 'docx';
import { GlobalBookExtractionCommands } from '../../src/main/global-book-extraction-commands';
import type { GlobalExtractionPreview, GlobalExtractionRecovery } from '../../src/shared/global-book-extraction';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'test-global-lifecycle-')); roots.push(root);
  const choose = vi.fn<() => Promise<{ name: string; bytes: Buffer } | null>>().mockResolvedValue(null);
  const global = { request: vi.fn().mockResolvedValue({ revision: 2 }) };
  const dependencies = {
    fetch: vi.fn(async () => ({ bytes: Buffer.from('test网页正文'), finalUrl: 'https://example.com/chapter', contentType: 'text/html', deadline: Date.now() + 30000 })),
    parse: vi.fn(async () => ({ title: 'test网页', paragraphs: ['test网页第一段', 'test网页第二段'] })),
  };
  const commands = new GlobalBookExtractionCommands({ choose }, global, root, dependencies);
  const paste = () => commands.execute('previewGlobalPastedExtraction', { title: 'test原创', text: 'test雨落窗边\ntest灯映书页' }) as Promise<GlobalExtractionPreview>;
  return { root, choose, global, dependencies, commands, paste };
}

it('本地选择取消和错误格式不创建草稿；TXT/DOCX保留文件名与原文坐标', async () => {
  const f = await fixture();
  expect(await f.commands.execute('chooseGlobalBookExtraction', { encoding: 'utf-8' })).toBeNull();
  expect(await f.commands.execute('readGlobalExtractionDraft', undefined)).toBeNull();
  f.choose.mockResolvedValueOnce({ name: 'test.exe', bytes: Buffer.from('test') });
  await expect(f.commands.execute('chooseGlobalBookExtraction', { encoding: 'utf-8' })).rejects.toThrow(/TXT 和 DOCX/);
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('test原创段落')] }] }));
  for (const file of [{ name: 'test.txt', bytes: Buffer.from('第一章 雨夜\ntest第一段\ntest第二段') }, { name: 'test.docx', bytes: docx }]) {
    f.choose.mockResolvedValueOnce(file);
    const preview = await f.commands.execute('chooseGlobalBookExtraction', { encoding: 'utf-8' }) as GlobalExtractionPreview;
    expect(preview.filename).toBe(file.name);
    expect(preview.segments[0]).toMatchObject({ chapterIndex: 1, paragraphIndex: 1 });
    await expect(f.commands.execute('chooseGlobalBookExtraction', { encoding: 'utf-8' })).rejects.toThrow(/更换/);
    await f.commands.execute('discardGlobalExtractionDraft', { token: preview.token });
  }
  expect(f.global.request).not.toHaveBeenCalled();
});

it('网页预览只写本机草稿且正常可取消；取消请求不被悬挂获取队列阻塞', async () => {
  const f = await fixture();
  const request = { operationId: randomUUID(), url: 'https://example.com/article' };
  const preview = await f.commands.execute('fetchGlobalWebExtraction', request) as GlobalExtractionPreview;
  expect(preview.source?.finalUrl).toBe('https://example.com/chapter');
  expect(f.global.request).not.toHaveBeenCalled();
  await f.commands.execute('discardGlobalExtractionDraft', { token: preview.token });
  f.dependencies.fetch.mockImplementationOnce(() => new Promise(() => {}));
  const nextOperationId = randomUUID();
  const waiting = f.commands.execute('fetchGlobalWebExtraction', { ...request, operationId: nextOperationId });
  const rejected = expect(waiting).rejects.toThrow(/取消/);
  await vi.waitFor(() => expect(f.dependencies.fetch).toHaveBeenCalledTimes(2));
  await f.commands.execute('cancelGlobalWebExtraction', { operationId: request.operationId });
  // 只有当前操作身份能够取消，旧身份不影响在途任务。
  expect(f.dependencies.parse).toHaveBeenCalledTimes(1);
  await f.commands.execute('cancelGlobalWebExtraction', { operationId: nextOperationId });
  await rejected;
  await f.commands.drain();
  expect(await f.commands.execute('readGlobalExtractionDraft', undefined)).toBeNull();
});

it('AI批次可恢复及同请求替换，非法令牌不会留下忙碌锁，草稿放弃后不可再用', async () => {
  const f = await fixture(), preview = await f.paste();
  await expect(f.commands.setAiBusy(randomUUID(), true)).rejects.toThrow(/失效/);
  await f.commands.setAiBusy(preview.token, true);
  await expect(f.commands.execute('cancelGlobalBookExtraction', { token: preview.token })).rejects.toThrow(/AI/);
  await expect(f.commands.execute('discardGlobalExtractionDraft', { token: preview.token })).rejects.toThrow(/AI/);
  await f.commands.setAiBusy(preview.token, false);
  const context = await f.commands.getAiContext(preview.token);
  expect(context.preview.token).toBe(preview.token);
  const batch = { id: randomUUID(), requestHash: 'a'.repeat(64), segmentIds: [preview.segments[0].id],
    status: 'running' as const, categoryIds: [], tagIds: [], suggestions: [] };
  await f.commands.recordAiBatch(preview.token, batch);
  await f.commands.recordAiBatch(preview.token, { ...batch, status: 'failed' });
  const recovered = await f.commands.execute('readGlobalExtractionDraft', undefined) as GlobalExtractionRecovery;
  expect(recovered.draft.batches).toEqual([{ ...batch, status: 'failed' }]);
  await f.commands.execute('discardGlobalExtractionDraft', { token: preview.token });
  await expect(f.commands.getAiContext(preview.token)).rejects.toThrow(/失效/);
  await expect(f.commands.recordAiBatch(preview.token, batch)).rejects.toThrow(/失效/);
  await f.commands.drain();
  await expect(f.commands.execute('testUnknown', {})).rejects.toThrow(/未知/);
});

it('不能伪造已入库状态；公开摘录超限不入库且保留原草稿', async () => {
  const f = await fixture(), preview = await f.paste(), segment = preview.segments[0];
  const review = { segmentId: segment.id, body: segment.text, categoryId: randomUUID(), tagIds: [] };
  await expect(f.commands.execute('saveGlobalExtractionReview', { token: preview.token, reviews: [{ ...review, status: 'committed' }] })).rejects.toThrow(/伪造/);
  const request = { token: preview.token, operationId: randomUUID(), expectedRevision: 1, sourceTitle: 'test原创', sourceAuthor: 'test作者',
    chapter: 'test第一章', rightsBasis: 'owned', permissionConfirmed: true, items: [review] };
  await f.commands.execute('confirmGlobalBookExtraction', request);
  await f.commands.execute('saveGlobalExtractionReview', { token: preview.token, reviews: [{ ...review, status: 'pending' }] });
  const saved = await f.commands.execute('readGlobalExtractionDraft', undefined) as GlobalExtractionRecovery;
  expect(saved.draft.reviews[0].status).toBe('committed');
  await f.commands.execute('discardGlobalExtractionDraft', { token: preview.token });
  const long = await f.commands.execute('previewGlobalPastedExtraction', { title: 'test长文', text: '雨'.repeat(301) }) as GlobalExtractionPreview;
  await expect(f.commands.execute('confirmGlobalBookExtraction', { ...request, token: long.token, rightsBasis: 'public-excerpt',
    items: [{ ...review, segmentId: long.segments[0].id, body: long.segments[0].text }] })).rejects.toThrow(/三百字/);
  expect(f.global.request).toHaveBeenCalledTimes(1);
});
