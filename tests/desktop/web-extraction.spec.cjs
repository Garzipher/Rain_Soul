const { test, expect } = require('@playwright/test');
const { activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup, createWork } = require('./structure-helper.cjs');

test.setTimeout(120000);
async function openBook(page) {
  const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
  if (await expand.isVisible()) await activate(expand);
  await activate(page.getByRole('button', { name: '知识库', exact: true }));
  await activate(page.getByRole('button', { name: '拆书工具', exact: true }));
}
async function returnSaved(page) {
  await activate(page.getByRole('button', { name: '返回知识库', exact: true }));
  await activate(page.getByRole('button', { name: '保存草稿并返回', exact: true }));
  await expect(page.getByRole('region', { name: '拆书工作区', exact: true })).toHaveCount(0);
}
test('粘贴来源真实IPC、双栏独立滚动与20段分页、重启恢复及更换素材', async () => {
  const directory = await temporaryDirectory(); let application;
  try {
    application = await launch(directory); let page = await offlineWindow(application);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await createWork(page, '网页拆文验收作品'); await openBook(page);
    await activate(page.getByRole('button', { name: '粘贴正文', exact: true }));
    await page.getByRole('textbox', { name: '素材标题', exact: true }).fill('雨夜合成素材');
    const text = Array.from({ length: 45 }, (_, index) => `第${index + 1}段：${'雨落在窗上，码头灯火映入水面。'.repeat(6)}`).join('\n');
    await page.getByRole('textbox', { name: '粘贴原文', exact: true }).fill(text);
    await activate(page.getByRole('button', { name: '预览粘贴内容', exact: true }));
    await expect(page.getByRole('region', { name: '原文阅读', exact: true })).toBeVisible({ timeout: 20000 });
    const reader = page.locator('.book-extraction-reader-scroll'), review = page.locator('.book-extraction-review-scroll');
    await expect.poll(() => reader.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await expect.poll(() => review.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    const before = await review.evaluate(node => node.scrollTop);
    await reader.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await reader.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    expect(await review.evaluate(node => node.scrollTop)).toBe(before);
    await activate(page.getByRole('button', { name: '原文下一页', exact: true }));
    await expect(page.getByRole('region', { name: '原文阅读', exact: true })).toContainText('第21段：');
    await expect(page.getByRole('textbox', { name: '摘选内容 1', exact: true })).toHaveValue(/第1段：/);
    await page.getByRole('textbox', { name: '摘选内容 1', exact: true }).fill('重启后必须保留的手工摘录');
    await page.getByRole('textbox', { name: '写作手法 1', exact: true }).fill('以具体感官细节描写雨夜');
    await page.getByRole('checkbox', { name: '审核通过段落 1', exact: true }).check();
    await activate(page.getByRole('button', { name: '下一页', exact: true }));
    await expect(page.getByRole('textbox', { name: '摘选内容 21', exact: true })).toHaveValue(/第21段：/);
    await activate(page.getByRole('button', { name: '上一页', exact: true }));
    await expect(page.getByRole('checkbox', { name: '审核通过段落 1', exact: true })).toBeChecked();
    await reader.evaluate(node => { node.scrollTop = 0; }); await review.evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: test.info().outputPath('source-double-column.png'), fullPage: true });
    await returnSaved(page); await closeNormally(application);
    application = await launch(directory); page = await offlineWindow(application);
    await activate(page.getByRole('button', { name: '打开作品：网页拆文验收作品', exact: true })); await openBook(page);
    await expect(page.getByRole('textbox', { name: '摘选内容 1', exact: true })).toHaveValue('重启后必须保留的手工摘录');
    await expect(page.getByRole('textbox', { name: '写作手法 1', exact: true })).toHaveValue('以具体感官细节描写雨夜');
    await expect(page.getByRole('checkbox', { name: '审核通过段落 1', exact: true })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: '确认有权使用摘选内容', exact: true })).not.toBeChecked();
    await page.screenshot({ path: test.info().outputPath('source-draft-recovered.png'), fullPage: true });
    await activate(page.getByRole('button', { name: '更换素材', exact: true }));
    await activate(page.getByRole('button', { name: '放弃草稿并更换', exact: true }));
    await expect(page.getByRole('region', { name: '原文阅读', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
    await activate(page.getByRole('button', { name: '返回知识库', exact: true })); await closeNormally(application);
  } finally { await cleanup(application, directory); }
});
