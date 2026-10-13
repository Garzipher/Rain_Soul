const { test, expect } = require('@playwright/test');
const { mkdir, writeFile } = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { activate, temporaryDirectory, dataDirectory, launch, offlineWindow, closeNormally, cleanup, createWork } = require('./structure-helper.cjs');

test.setTimeout(120000);
const hash = value => createHash('sha256').update(value).digest('hex');
async function openBook(page) {
  // 作品打开是异步业务操作；正文就绪后再导航，避免请求被操作门禁拒绝。
  await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toBeEnabled();
  const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
  if (await expand.isVisible()) await activate(expand);
  await activate(page.getByRole('button', { name: '知识库', exact: true }));
  await activate(page.getByRole('button', { name: '拆书工具', exact: true }));
}
async function captureDisabled(page) {
  await page.screenshot({ path: test.info().outputPath('restricted-render-disabled.png'), fullPage: true });
  if (process.env.RAINSOUL_CAPTURE_LEARNING === '1') {
    const images = path.resolve('learning/项目全流程开发学习/images');
    await mkdir(images, { recursive: true });
    await page.screenshot({ path: path.join(images, 'restricted-render-disabled.png'), fullPage: true });
  }
}
test('生产资格缺失明确禁用受限渲染，静态入口保留；真实拆书页截图', async () => {
  const directory = await temporaryDirectory(); let application;
  try {
    application = await launch(directory); const page = await offlineWindow(application), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await createWork(page, '受限网页入口练习'); await openBook(page);
    expect(await page.evaluate(() => window.rainSoul.getWebRenderCapability())).toMatchObject({ enabled: false, policyVersion: 1 });
    await activate(page.getByRole('button', { name: '网页文章', exact: true }));
    await page.getByRole('textbox', { name: '公开网页地址', exact: true }).fill('https://article.example.com/learning');
    await expect(page.locator('#web-render-capability')).toContainText('未通过受限渲染验收');
    const restricted = page.getByRole('button', { name: '受限渲染并预览', exact: true });
    await expect(restricted).toBeDisabled(); await expect(restricted).toHaveAttribute('aria-describedby', 'web-render-capability');
    await expect(page.getByRole('button', { name: '获取并预览', exact: true })).toBeEnabled();
    await restricted.press('Enter');
    await expect(page.getByRole('dialog', { name: '确认受限网页渲染', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '原文阅读', exact: true })).toHaveCount(0);
    await captureDisabled(page); expect(errors).toEqual([]);
    await activate(page.getByRole('button', { name: '返回知识库', exact: true })); await closeNormally(application);
  } finally { await cleanup(application, directory); }
});

// 仅在隔离目录写入已捕获的合成历史草稿，不发网络请求、不改变运行资格。
function historicalDraft(work, method) {
  const id = randomUUID(), segmentId = randomUUID(), text = '雨水沿窗落下，灯火留在岸边。', capturedAt = '2026-10-13T00:00:00Z';
  const capture = method === 'legacy' ? undefined : { sourceId: id, captureMethod: method, capturedAt, policyVersion: 1,
    ...(method === 'restricted-browser' ? { renderedDomHash: hash('<html><body><p>合成历史正文</p></body></html>') } : {}) };
  return { schemaVersion: 1, taskId: randomUUID(), workId: work.id, previewToken: randomUUID(), batches: [], committing: null,
    source: { id, kind: 'web', hashVersion: 1, title: '合成网页来源', originalUrl: 'https://article.example.com/original', finalUrl: 'https://article.example.com/final',
      fetchedAt: '2026-10-10T00:00:00Z', rawHash: hash('<html><body>合成原页</body></html>'), bodyHash: hash(JSON.stringify([text])), ...(capture ? { capture } : {}),
      segments: [{ id: segmentId, ordinal: 1, chapterTitle: '', text, textHash: hash(text) }] },
    reviews: [{ segmentId, body: '需要继续审核的本机笔记', categoryId: work.assets.categories[0].id, tagIds: [], status: 'pending' }] };
}
for (const method of ['static', 'restricted-browser', 'legacy']) {
  test(`历史网页${method}来源详情兼容，取消更换与重启保留审核草稿`, async () => {
    const directory = await temporaryDirectory(); let application;
    try {
      application = await launch(directory); let page = await offlineWindow(application);
      await createWork(page, '网页来源证据练习');
      const work = await page.evaluate(async () => {
        const listed = (await window.rainSoul.listWorks()).find(item => item.title === '网页来源证据练习');
        return window.rainSoul.openWork(listed.id);
      });
      await closeNormally(application);
      const draft = historicalDraft(work, method), drafts = path.join(dataDirectory(directory), 'ExtractionDrafts');
      await mkdir(drafts, { recursive: true }); await writeFile(path.join(drafts, `${work.id}.json`), JSON.stringify(draft), 'utf8');
      application = await launch(directory); page = await offlineWindow(application);
      await activate(page.getByRole('button', { name: '打开作品：网页来源证据练习', exact: true })); await openBook(page);
      const body = page.getByRole('textbox', { name: '摘选内容 1', exact: true });
      await expect(body).toHaveValue('需要继续审核的本机笔记');
      await activate(page.getByText('网页来源记录', { exact: true }));
      const audit = page.locator('.book-extraction-source details');
      await expect(audit).toContainText(method === 'legacy' ? '捕获方式：未知（旧记录）' : method === 'static' ? '捕获方式：静态获取' : '捕获方式：受限浏览器');
      await expect(audit).toContainText(draft.source.bodyHash);
      if (method === 'legacy') { await expect(audit).not.toContainText('捕获时间：'); await expect(audit).not.toContainText('政策版本：'); }
      else { await expect(audit).toContainText(draft.source.capture.capturedAt); await expect(audit).toContainText('政策版本：1'); }
      if (method === 'restricted-browser') await expect(audit).toContainText(draft.source.capture.renderedDomHash);
      await expect(page.getByRole('button', { name: '网页文章', exact: true })).toBeDisabled();
      await body.fill('重启后仍需保留的手工修改');
      await activate(page.getByRole('button', { name: '更换素材', exact: true }));
      await activate(page.getByRole('button', { name: '取消', exact: true })); await expect(body).toHaveValue('重启后仍需保留的手工修改');
      await activate(page.getByRole('button', { name: '返回知识库', exact: true }));
      await activate(page.getByRole('button', { name: '保存草稿并返回', exact: true }));
      // Enter仅表示事件已发送；等异步保存完成并卸载工作区，再触发真正的关闭门禁。
      await expect(page.getByRole('region', { name: '拆书工作区', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '拆书工具', exact: true })).toBeEnabled();
      await closeNormally(application);
      application = await launch(directory); page = await offlineWindow(application);
      await activate(page.getByRole('button', { name: '打开作品：网页来源证据练习', exact: true })); await openBook(page);
      await expect(page.getByRole('textbox', { name: '摘选内容 1', exact: true })).toHaveValue('重启后仍需保留的手工修改');
      const recovered = await page.evaluate(id => window.rainSoul.readExtractionDraft(id), work.id);
      expect(recovered.draft.source).toEqual(draft.source);
      await expect(page.getByRole('checkbox', { name: '确认有权使用摘选内容', exact: true })).not.toBeChecked();
      await activate(page.getByRole('button', { name: '返回知识库', exact: true }));
      await activate(page.getByRole('button', { name: '保存草稿并返回', exact: true }));
      await expect(page.getByRole('region', { name: '拆书工作区', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '拆书工具', exact: true })).toBeEnabled();
      await closeNormally(application);
    } finally { await cleanup(application, directory); }
  });
}
