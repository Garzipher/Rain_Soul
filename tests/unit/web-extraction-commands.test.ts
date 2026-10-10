import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { BookExtractionCommands } from '../../src/main/book-extraction-commands';
import type { BookExtractionPreview } from '../../src/shared/book-extraction';

function setup() {
  const workId = randomUUID(), operationId = randomUUID();
  const store = { execute: vi.fn(async () => ({ id: workId })) };
  const files = { choose: vi.fn(async () => null) };
  const web = {
    fetch: vi.fn(async (_url: string, _signal: AbortSignal) => ({ bytes: Buffer.from('<p>雨落在岸边。</p>'), finalUrl: 'https://article.example.com/read', contentType: 'text/html', deadline: Date.now()+30000 })),
    parse: vi.fn(async () => ({ title: '雨夜码头', paragraphs: ['雨落在岸边。', '船鸣从远方传来。'] })),
  };
  const commands = new BookExtractionCommands(store, files, web);
  return { commands, store, web, workId, operationId };
}
it('网页预览冻结原始来源与正文，不落库，不允许调用方替换证据', async () => {
  const { commands, store, web, workId, operationId } = setup();
  const preview = await commands.execute('fetchWebExtraction', { workId, operationId, url: 'https://article.example.com/start' }) as BookExtractionPreview;
  expect(preview.format).toBe('web'); expect(preview.segments).toHaveLength(2);
  expect(preview.source?.originalUrl).toBe('https://article.example.com/start');
  expect(preview.source?.finalUrl).toBe('https://article.example.com/read');
  expect(web.parse).toHaveBeenCalledWith(expect.any(Buffer), 'text/html', expect.any(AbortSignal), expect.objectContaining({ deadline: expect.any(Number), maxNodes: 20000 }));
  preview.segments[0].text='伪造'; preview.source!.title='伪造';
  expect(commands.getPreview(workId, preview.token).segments[0].text).toBe('雨落在岸边。');
  expect(commands.getPreview(workId, preview.token).source!.title).toBe('雨夜码头');
  expect(store.execute).not.toHaveBeenCalled();
});
it('网页取消不等待文件队列或悬挂网络，晚返回不生成可用预览', async () => {
  const { commands, web, workId, operationId } = setup();
  let release!: (result: Awaited<ReturnType<typeof web.fetch>>) => void;
  web.fetch.mockImplementationOnce(() => new Promise(resolve => { release=resolve; }));
  const pending = commands.execute('fetchWebExtraction', { workId, operationId, url: 'https://article.example.com/start' });
  const rejected = expect(pending).rejects.toThrow(/取消/);
  await commands.execute('cancelWebExtraction', { operationId }); await rejected;
  release({ bytes: Buffer.from('late'), finalUrl:'https://article.example.com/read', contentType:'text/html', deadline:Date.now()+30000 });
  await Promise.resolve(); expect(web.parse).not.toHaveBeenCalled();
});
it('解析期间取消并作废晚结果，替换任务不串作品', async () => {
  const { commands, web, workId, operationId } = setup();
  let release!: (result: Awaited<ReturnType<typeof web.parse>>) => void;
  web.parse.mockImplementationOnce(() => new Promise(resolve => { release=resolve; }));
  const pending = commands.execute('fetchWebExtraction', { workId, operationId, url: 'https://article.example.com/start' });
  const rejected=expect(pending).rejects.toThrow(/取消/);
  await vi.waitFor(() => expect(web.parse).toHaveBeenCalled());
  const next = await commands.execute('previewPastedExtraction', { workId:randomUUID(), text:'新作品正文', title:'粘贴素材' }) as BookExtractionPreview;
  await rejected; release({ title:'旧素材', paragraphs:['旧材料'] }); await Promise.resolve();
  expect(() => commands.getPreview(workId, next.token)).toThrow(/预览/);
  expect(commands.getPreview(next.workId,next.token).segments[0].text).toBe('新作品正文');
});
it('粘贴正文规范换行和空段，限定输入与作品身份', async () => {
  const { commands, store, workId }=setup();
  const preview=await commands.execute('previewPastedExtraction',{workId,title:'学习素材',text:'  第一段  \r\n\r\n第二段\r第三段'}) as BookExtractionPreview;
  expect(preview.format).toBe('paste'); expect(preview.source?.segments.map(s=>s.text)).toEqual(['  第一段  ','第二段','第三段']);
  expect(preview.source?.originalUrl).toBeNull(); expect(store.execute).not.toHaveBeenCalled();
  await expect(commands.execute('previewPastedExtraction',{workId,title:'x',text:'x'.repeat(200001)})).rejects.toThrow();
  await expect(commands.execute('previewPastedExtraction',{workId,title:'x',text:'x',path:'C:/secret'})).rejects.toThrow();
});
it('安全传输失败不保留旧预览，原文只能由主进程构造', async () => {
  const { commands, web, workId, operationId }=setup();
  const old=await commands.execute('previewPastedExtraction',{workId,title:'旧稿',text:'旧稿正文'}) as BookExtractionPreview;
  web.fetch.mockRejectedValueOnce(new Error('获取失败'));
  await expect(commands.execute('fetchWebExtraction',{workId,operationId,url:'https://article.example.com/read'})).rejects.toThrow('获取失败');
  expect(()=>commands.getPreview(workId,old.token)).toThrow(/预览/);
  await expect(commands.execute('fetchWebExtraction',{workId,operationId,url:'https://article.example.com/read',segments:[]})).rejects.toThrow();
});
it('旧文件选择晚返回不能覆盖新作品的粘贴预览', async () => {
  let release!: (file: { name: string; bytes: Buffer }) => void;
  const files = { choose: () => new Promise<{name: string;bytes:Buffer}>(resolve => { release=resolve; }) };
  const commands=new BookExtractionCommands({execute:async()=>null},files);
  const old=commands.execute('chooseBookExtraction',{workId:randomUUID(),encoding:'utf-8'});
  const rejected=expect(old).rejects.toThrow(/失效|替换/);
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  const current=await commands.execute('previewPastedExtraction',{workId:randomUUID(),title:'新素材',text:'新的作品资料'}) as BookExtractionPreview;
  release({name:'旧文件.txt',bytes:Buffer.from('旧正文')}); await rejected;
  expect(commands.getPreview(current.workId,current.token)).toEqual(current);
});
it('网页确认仅绑定冻结来源，出处保留原始与最终网址，调用方不能伪造', async () => {
  const { commands, store, workId, operationId } = setup();
  const preview = await commands.execute('fetchWebExtraction', { workId, operationId, url: 'https://article.example.com/start' }) as BookExtractionPreview;
  const request = { workId, token: preview.token, expectedRevision: 1, operationId: randomUUID(), sourceTitle: '原文', sourceAuthor: '', permissionConfirmed: true,
    items: [{ segmentId: preview.segments[0].id, body: '雨落在岸边。', categoryId: randomUUID(), tagIds: [] }] };
  await commands.execute('confirmBookExtraction', request);
  expect(store.execute).toHaveBeenCalledWith('importBookExtraction', expect.objectContaining({ sourceDocument: preview.source,
    items: [expect.objectContaining({ segmentId: preview.segments[0].id, source: expect.stringContaining('https://article.example.com/start') })] }));
  const commit = store.execute.mock.calls.at(-1) as unknown as [string, { items: { source: string }[] }];
  expect(commit[1].items[0].source).toContain('https://article.example.com/read');
  await expect(commands.execute('confirmBookExtraction', { ...request, sourceDocument: preview.source })).rejects.toThrow();
});
