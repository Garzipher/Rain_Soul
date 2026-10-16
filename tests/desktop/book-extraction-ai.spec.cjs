const { test, expect } = require('@playwright/test');
const { writeFile, mkdir } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup, createWork, writeChapter } = require('./structure-helper.cjs');

test.setTimeout(120000);
const original = '细雨落在窗上，灯光被揉成柔软的金色。';
const unselected = '未授权的第三段不应进入云端请求。';
const privateBody = '当前作品正文哨兵，不属于拆书发送范围。';
const fakeKey = 'book-ai-isolated-fake-key';

async function sidebar(page, name) {
  const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
  if (await expand.isVisible()) await activate(expand);
  await activate(page.getByRole('button', { name, exact: true }));
}
async function capture(page, name) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
  if (process.env.RAINSOUL_CAPTURE_LEARNING === '1') {
    const directory = path.resolve('learning/项目全流程开发学习/images');
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
  }
}
async function installTransport(application) {
  await application.evaluate(() => {
    const { EventEmitter } = process.getBuiltinModule('node:events');
    const { setImmediate } = process.getBuiltinModule('node:timers');
    // 拦截全部 HTTPS 请求，绝不调用真实 request；渲染层仍使用真实 IPC。
    globalThis.bookAiStub = { count: 0, bodies: [], mode: 'valid' };
    process.getBuiltinModule('node:https').request = (_url, options, callback) => {
      const outgoing = new EventEmitter();
      const abort = () => { options.signal.removeEventListener('abort', abort); outgoing.emit('error', new Error('隔离测试取消')); };
      outgoing.end = body => {
        const state = globalThis.bookAiStub;
        state.count++;
        const request = JSON.parse(body);
        const material = JSON.parse(request.messages.find(message => message.role === 'user').content);
        state.bodies.push(material);
        if (state.mode === 'hold') return;
        const suggestions = material.segments.map(segment => ({
          segmentId: segment.id, excerpt: state.mode === 'invalid' ? '伪造且不存在的摘录' : segment.text,
          categoryId: material.categories.find(category => category.name === '景物描写').id,
          tagIds: [], technique: '用具体光影和比喻营造场景。', usage: '适合舒缓的雨夜场景。', exercise: '用声音描写改写一个合成场景。',
        }));
        setImmediate(() => {
          if (options.signal.aborted) return;
          const response = new EventEmitter();
          response.statusCode = 200;
          response.destroy = reason => response.emit('error', reason);
          callback(response);
          response.emit('data', Buffer.from(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ suggestions }) } }] })));
          response.emit('end');
          options.signal.removeEventListener('abort', abort);
        });
      };
      options.signal.addEventListener('abort', abort, { once: true });
      return outgoing;
    };
  });
}
async function count(application) { return application.evaluate(() => globalThis.bookAiStub.count); }
async function configure(page) {
  // 虚构凭据经真实主进程 DPAPI 存入隔离目录；不通过截图记录凭据。
  await page.evaluate(key => window.rainSoul.saveAiSettings({ id: 'cloud-default', name: '隔离演练服务', baseUrl: 'https://8.8.8.8/v1', model: 'book-study-stub', billingHint: '云请求可能产生费用；本次演练由本机替身响应。' }, key), fakeKey);
}
async function openSource(page, application, filename) {
  await sidebar(page, '知识库');
  await activate(page.getByRole('button', { name: /^作品知识库/ }));
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, filename);
  await activate(page.getByRole('button', { name: '拆书工具', exact: true }));
  await activate(page.getByRole('button', { name: '选择 TXT / DOCX', exact: true }));
  await expect(page.getByRole('textbox', { name: '摘选内容 1', exact: true })).toHaveValue(original);
  await page.getByRole('checkbox', { name: '确认有权使用摘选内容', exact: true }).check();
}
async function prepare(page) {
  await activate(page.getByRole('button', { name: '准备 AI 推荐', exact: true }));
  const dialog = page.getByRole('dialog', { name: '确认 AI 辅助拆书', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function readWork(page, id) { return page.evaluate(id => window.rainSoul.openWork(id), id); }

test('AI拆书真实IPC逐次授权、独立原文范围、审核后原子入库与重启保留出处', async () => {
  const directory = await temporaryDirectory(); let application;
  const filename = path.join(directory, '雨夜合成素材.txt');
  const source = `第一章 雨夜\n${original}\n她把旧信折好，像把一个季节藏入口袋。\n${unselected}`;
  await writeFile(filename, source, 'utf8');
  try {
    application = await launch(directory); let page = await offlineWindow(application);
    await installTransport(application);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await createWork(page, 'AI拆书学习练习'); await writeChapter(page, '第一章', privateBody);
    const id = await page.evaluate(async () => (await window.rainSoul.listWorks()).find(work => work.title === 'AI拆书学习练习').id);
    await configure(page); await openSource(page, application, filename);
    const before = await readWork(page, id);
    const snapshotBefore = await page.evaluate(id => window.rainSoul.listSnapshots(id), id);
    await page.getByRole('textbox', { name: '来源作者', exact: true }).fill('合成测试作者');
    await page.getByRole('checkbox', { name: 'AI 分析段落 1', exact: true }).check();
    await expect(page.getByRole('checkbox', { name: '审核通过段落 1', exact: true })).not.toBeChecked();
    let dialog = await prepare(page);
    await expect(dialog).toContainText(original); await expect(dialog).toContainText('景物描写');
    await expect(dialog).toContainText('所选1段'); await expect(dialog).toContainText('可能产生费用');
    await expect(dialog).not.toContainText(unselected); await expect(dialog).not.toContainText(privateBody);
    await expect(dialog).not.toContainText(fakeKey);
    const sendButton = dialog.getByRole('button', { name: '确认发送', exact: true });
    await sendButton.focus(); await page.keyboard.press('Tab');
    await expect(dialog.locator('summary')).toBeFocused();
    await page.keyboard.press('Tab');
    const material = dialog.locator('pre[aria-label="完整发送内容"]');
    await expect(material).toBeFocused();
    await material.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.keyboard.press('Home');
    await expect(material).toBeFocused();
    await capture(page, 'book-ai-authorization');
    expect(await count(application)).toBe(0);
    await activate(dialog.getByRole('button', { name: '取消', exact: true }));
    await expect(dialog).toHaveCount(0); expect(await count(application)).toBe(0);
    expect(await readWork(page, id)).toEqual(before);

    dialog = await prepare(page);
    await activate(dialog.getByRole('button', { name: '确认发送', exact: true }));
    const results = page.locator('[aria-label="AI 推荐结果"]');
    await expect(results).toContainText('第 1 段推荐'); expect(await count(application)).toBe(1);
    const sent = await application.evaluate(() => globalThis.bookAiStub.bodies);
    expect(sent).toHaveLength(1); expect(sent[0].segments).toHaveLength(1);
    expect(sent[0].segments[0].text).toBe(original);
    expect(JSON.stringify(sent)).not.toContain(privateBody); expect(JSON.stringify(sent)).not.toContain(unselected);
    expect(await readWork(page, id)).toEqual(before);
    expect(await page.evaluate(id => window.rainSoul.listSnapshots(id), id)).toEqual(snapshotBefore);
    await results.evaluate(node => node.scrollIntoView({ block: 'start' }));
    await capture(page, 'book-ai-results');

    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 540));
    const collapse = page.getByRole('button', { name: '收起侧栏', exact: true });
    if (await collapse.isVisible()) await activate(collapse);
    await page.locator('.book-extraction-ai').evaluate(node => node.scrollIntoView({ block: 'start' }));
    const geometry = await page.locator('.book-extraction-ai').evaluate(panel => ({
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      controls: [...panel.querySelectorAll('button,input')].map(node => {
        const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width };
      }),
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    for (const box of geometry.controls) { expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(geometry.width + 1); expect(box.width).toBeGreaterThan(0); }
    await capture(page, 'book-ai-narrow');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 840));

    // 父组件的脏状态必须阻止真实窗口关闭，素材不会因退出请求被清掉。
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect(page.getByRole('alert').filter({ hasText: '资产编辑尚未保存' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '摘选内容 1', exact: true })).toHaveValue(original);
    await activate(results.getByRole('button', { name: '带入审核', exact: true }));
    const review = page.getByRole('textbox', { name: '摘选内容 1', exact: true });
    await expect(review).toHaveValue(original);
    await expect(page.getByRole('textbox', { name: '写作手法 1', exact: true })).toHaveValue('用具体光影和比喻营造场景。');
    const approved = page.getByRole('checkbox', { name: '审核通过段落 1', exact: true });
    await expect(approved).not.toBeChecked(); expect((await readWork(page, id)).assets.knowledge).toHaveLength(0);
    await approved.check(); await review.fill('作者手工整理的学习笔记。'); await expect(approved).not.toBeChecked();
    await activate(results.getByRole('button', { name: '带入审核', exact: true }));
    const replacement = page.getByRole('dialog', { name: '替换本段审核内容？', exact: true });
    await expect(replacement).toBeVisible();
    await activate(replacement.getByRole('button', { name: '取消', exact: true }));
    await expect(review).toHaveValue('作者手工整理的学习笔记。');
    await activate(results.getByRole('button', { name: '带入审核', exact: true }));
    await activate(replacement.getByRole('button', { name: '替换并重新审核', exact: true }));
    await expect(review).toHaveValue(original);
    await expect(approved).not.toBeChecked(); await approved.check();
    await expect(page.getByRole('checkbox', { name: '审核通过段落 2', exact: true })).not.toBeChecked();
    await activate(page.getByRole('button', { name: '确认入库（1）', exact: true }));
    await expect(page.getByRole('checkbox', { name: '审核通过段落 1', exact: true })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: '摘选内容 2', exact: true })).toBeEnabled();
    const committed = await readWork(page, id), entry = committed.assets.knowledge[0];
    expect(entry.body).toBe(original); expect(entry.body).not.toContain('仿写练习');
    const draft = await page.evaluate(id => window.rainSoul.readExtractionDraft(id), id);
    expect(draft.draft.reviews[0].annotation.exercise).toBe('用声音描写改写一个合成场景。');
    expect(entry.source).toContain('合成测试作者'); expect(entry.source).toContain('雨夜合成素材.txt');
    expect(entry.source).toContain('第1段');
    expect(entry.source).toContain(createHash('sha256').update(source).digest('hex'));
    expect(entry.source).toContain(createHash('sha256').update(original).digest('hex'));
    expect(await count(application)).toBe(1); expect(errors).toEqual([]);
    await activate(page.getByRole('button', { name: '返回知识库', exact: true }));
    await activate(page.getByRole('button', { name: '保存草稿并返回', exact: true }));
    await expect(page.getByRole('article', { name: /^知识：/ })).toHaveCount(1);
    await closeNormally(application); application = await launch(directory); page = await offlineWindow(application);
    await installTransport(application);
    await activate(page.getByRole('button', { name: '打开作品：AI拆书学习练习', exact: true })); await sidebar(page, '知识库');
    await activate(page.getByRole('button', { name: /^作品知识库/ }));
    await expect(page.getByRole('article', { name: /^知识：/ })).toHaveCount(1);
    expect((await readWork(page, id)).assets.knowledge).toEqual(committed.assets.knowledge);
    expect(await count(application)).toBe(0);
    await closeNormally(application);
  } finally { await cleanup(application, directory); }
});

test('无云配置仍可手工摘选，坏模型摘录整批禁止应用且请求中可取消', async () => {
  const directory = await temporaryDirectory(); let application;
  const filename = path.join(directory, '异常响应演练.txt');
  await writeFile(filename, `第一章 雨夜\n${original}\n第二段是另一次授权素材。`, 'utf8');
  try {
    application = await launch(directory); const page = await offlineWindow(application);
    await installTransport(application); await createWork(page, 'AI拆书异常练习');
    await openSource(page, application, filename);
    await page.getByRole('checkbox', { name: 'AI 分析段落 1', exact: true }).check();
    await activate(page.getByRole('button', { name: '准备 AI 推荐', exact: true }));
    await expect(page.getByRole('alert').filter({ hasText: '配置云端模型及凭据' })).toBeVisible();
    expect(await count(application)).toBe(0);
    await page.getByRole('textbox', { name: '摘选内容 1', exact: true }).fill('手工审核继续可编辑。');
    await page.getByRole('checkbox', { name: '审核通过段落 1', exact: true }).check();
    await expect(page.getByRole('button', { name: '确认入库（1）', exact: true })).toBeEnabled();
    await configure(page);
    await application.evaluate(() => { globalThis.bookAiStub.mode = 'invalid'; });
    let dialog = await prepare(page); await activate(dialog.getByRole('button', { name: '确认发送', exact: true }));
    const raw = page.locator('[aria-label="未通过校验的 AI 响应"]');
    await expect(raw).toContainText('伪造且不存在的摘录'); await expect(raw).toContainText('整批不能应用');
    await expect(page.getByRole('button', { name: '带入审核', exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '摘选内容 1', exact: true })).toHaveValue('手工审核继续可编辑。');
    expect(await count(application)).toBe(1);
    await page.getByRole('checkbox', { name: 'AI 分析段落 2', exact: true }).check();
    await application.evaluate(() => { globalThis.bookAiStub.mode = 'hold'; });
    dialog = await prepare(page); await activate(dialog.getByRole('button', { name: '确认发送', exact: true }));
    await expect(page.getByText('正在生成 AI 推荐…', { exact: true })).toBeVisible();
    await expect.poll(() => count(application)).toBe(2);
    await expect(page.getByRole('button', { name: '返回知识库', exact: true })).toBeDisabled();
    await activate(page.getByRole('button', { name: '取消本次 AI 请求', exact: true }));
    await expect(page.getByRole('button', { name: '准备 AI 推荐', exact: true })).toBeEnabled();
    expect(await count(application)).toBe(2); await expect(raw).toContainText('伪造且不存在的摘录');
    await activate(page.getByRole('button', { name: '返回知识库', exact: true }));
    await activate(page.getByRole('button', { name: '保存草稿并返回', exact: true }));
    await expect(page.getByRole('button', { name: '拆书工具', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('article', { name: /^知识：/ })).toHaveCount(0);
    await closeNormally(application);
  } finally { await cleanup(application, directory); }
});

test('已完成但未采用的AI拆书批次重启可恢复，零云重发且须重新审核', async () => {
  const directory = await temporaryDirectory(); let application;
  const filename = path.join(directory, '批次恢复演练.txt');
  await writeFile(filename, `第一章 雨夜\n${original}\n第二章 重逢\n${original}`, 'utf8');
  try {
    application = await launch(directory); let page = await offlineWindow(application);
    await installTransport(application); await createWork(page, 'AI批次重启恢复');
    const id = await page.evaluate(async () => (await window.rainSoul.listWorks()).find(work => work.title === 'AI批次重启恢复').id);
    await configure(page); await openSource(page, application, filename);
    await page.getByRole('checkbox', { name: 'AI 分析段落 2', exact: true }).check();
    const dialog = await prepare(page); await activate(dialog.getByRole('button', { name: '确认发送', exact: true }));
    await expect(page.locator('dialog[aria-label="确认 AI 辅助拆书"]')).toHaveCount(0);
    await expect(page.locator('[aria-label="AI 推荐结果"]')).toContainText('用具体光影和比喻营造场景。');
    expect(await count(application)).toBe(1); expect((await readWork(page, id)).assets.knowledge).toHaveLength(0);
    await activate(page.getByRole('button', { name: '返回知识库', exact: true }));
    await activate(page.getByRole('button', { name: '保存草稿并返回', exact: true }));
    await expect(page.getByRole('button', { name: '拆书工具', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await closeNormally(application); application = await launch(directory); page = await offlineWindow(application);
    await installTransport(application);
    await activate(page.getByRole('button', { name: '打开作品：AI批次重启恢复', exact: true }));
    await sidebar(page, '知识库');
    await activate(page.getByRole('button', { name: /^作品知识库/ })); await activate(page.getByRole('button', { name: '拆书工具', exact: true }));
    await activate(page.getByRole('button', { name: '查看已保存 AI 批次 1', exact: true }));
    const results = page.locator('[aria-label="AI 推荐结果"]');
    await expect(results).toContainText('用具体光影和比喻营造场景。');
    await expect(results.getByRole('button', { name: '带入审核', exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'AI 分析段落 1', exact: true })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: '审核通过段落 2', exact: true })).not.toBeChecked();
    expect(await count(application)).toBe(0);
    await page.getByRole('checkbox', { name: '确认有权使用摘选内容', exact: true }).check();
    await activate(results.getByRole('button', { name: '带入审核', exact: true }));
    await expect(page.getByRole('textbox', { name: '写作手法 2', exact: true })).toHaveValue('用具体光影和比喻营造场景。');
    await expect(page.getByRole('checkbox', { name: '审核通过段落 2', exact: true })).not.toBeChecked();
    expect((await readWork(page, id)).assets.knowledge).toHaveLength(0); expect(await count(application)).toBe(0);
    const recovered = await page.evaluate(id => window.rainSoul.readExtractionDraft(id), id);
    expect(recovered.preview.segments[1]).toMatchObject({ chapterIndex: 2, paragraphIndex: 1 });
    await page.getByRole('checkbox', { name: '审核通过段落 2', exact: true }).check();
    await activate(page.getByRole('button', { name: '确认入库（1）', exact: true }));
    await expect.poll(async () => (await readWork(page, id)).assets.knowledge.length).toBe(1);
    expect((await readWork(page, id)).assets.knowledge[0].source).toContain('第2章 第二章 重逢 第1段');
    await activate(page.getByRole('button', { name: '返回知识库', exact: true }));
    await activate(page.getByRole('button', { name: '保存草稿并返回', exact: true }));
    await expect(page.getByRole('button', { name: '拆书工具', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await closeNormally(application);
  } finally { await cleanup(application, directory); }
});
