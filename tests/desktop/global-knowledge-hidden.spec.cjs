const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { launch, temporaryDirectory, cleanup } = require('./structure-helper.cjs');

// 本用例只通过隐藏窗口的 preload 调用真实 IPC，不操作系统焦点或原生文件对话框。
test('后台全局库：待审不入库、审批持久化、重复提交不增量、重启可检索', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    application = await launch(directory);
    const hiddenPage = async () => {
      const page = await application.firstWindow();
      await page.waitForURL('rainsoul://app/');
      await page.context().setOffline(true);
      expect(await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
      return page;
    };
    const page = await hiddenPage();
    const before = await page.evaluate(() => window.rainSoul.readGlobalKnowledge());
    expect(before.total).toBe(0);
    const preview = await page.evaluate(() => window.rainSoul.previewGlobalPastedExtraction({
      title: 'test原创后台素材', text: 'test雨水轻轻敲打窗沿。\ntest灯下的人合上了书。',
    }));
    expect((await page.evaluate(() => window.rainSoul.readGlobalKnowledge())).total).toBe(0);
    const items = preview.segments.map(segment => ({ segmentId: segment.id, body: segment.text,
      categoryId: before.categories[0].id, tagIds: [], annotation: {
        technique: 'test借声音建立场景', usage: 'test安静的室内场景', exercise: 'test改用温度写一句原创描述',
      } }));
    await page.evaluate(({ token, reviews }) => window.rainSoul.saveGlobalExtractionReview({
      token, reviews: reviews.map(item => ({ ...item, status: 'approved' })),
      metadata: { sourceTitle: 'test原创后台素材', sourceAuthor: 'test作者', chapter: 'test第一章', rightsBasis: 'owned', metrics: [] },
    }), { token: preview.token, reviews: items });
    expect((await page.evaluate(() => window.rainSoul.readGlobalKnowledge())).total).toBe(0);
    const request = { token: preview.token, operationId: randomUUID(), expectedRevision: before.revision,
      permissionConfirmed: true, sourceTitle: 'test原创后台素材', sourceAuthor: 'test作者',
      chapter: 'test第一章', rightsBasis: 'owned', metrics: [], items };
    const after = await page.evaluate(input => window.rainSoul.confirmGlobalBookExtraction(input), request);
    expect(after.total).toBe(2);
    expect(after.annotations).toHaveLength(2);
    await expect(page.evaluate(input => window.rainSoul.confirmGlobalBookExtraction(input), request)).rejects.toThrow();
    expect((await page.evaluate(() => window.rainSoul.readGlobalKnowledge())).total).toBe(2);
    expect(await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    // 已完成的写入全部有回执；只退出本次隔离测试进程，随后用同一隔离目录验证持久化。
    await application.evaluate(({ app }) => app.exit(0));
    application = await launch(directory);
    const reopened = await hiddenPage();
    const found = await reopened.evaluate(() => window.rainSoul.readGlobalKnowledge({ text: '雨', limit: 1 }));
    expect(found.total).toBe(1);
    expect(found.entries[0].body).toBe('test雨水轻轻敲打窗沿。');
    expect(found.entries[0].reviewed).toBe(true);
    const recovery = await reopened.evaluate(() => window.rainSoul.readGlobalExtractionDraft());
    expect(recovery.draft.reviews.every(item => item.status === 'committed')).toBe(true);
    expect(await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
    await application.evaluate(({ app }) => app.exit(0));
  } finally {
    await cleanup(application, directory);
  }
});

test('后台真实界面：首批段号和学习卡预填保留，逐条确认后才入正式库', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    application = await launch(directory);
    const page = await application.firstWindow();
    await page.waitForURL('rainsoul://app/');
    await page.context().setOffline(true);
    const remainsHidden = () => application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()));
    expect(await remainsHidden()).toBe(true);
    await page.getByRole('button', { name: '知识库', exact: true }).click();
    await page.getByRole('button', { name: '全局知识库', exact: true }).click();
    await page.getByRole('button', { name: '拆书工具', exact: true }).click();
    const starter = page.getByRole('region', { name: '首批核实素材' }).getByRole('article')
      .filter({ has: page.getByRole('heading', { name: '从小妾到翻译官[年代]', exact: true }) });
    await starter.getByRole('button', { name: '载入预览' }).click();
    const review = page.getByRole('region', { name: '全局摘选审核' });
    await expect(review.getByRole('textbox', { name: '写作手法' }).first()).not.toHaveValue('');
    await expect(review.getByRole('textbox', { name: '写作手法' }).nth(1)).not.toHaveValue('');
    await expect(page.getByRole('region', { name: '原文阅读' })).toContainText('原文第 4 段');
    await expect(review.getByRole('combobox', { name: '分类' }).first()).toContainText('叙事');
    await expect(review.getByRole('combobox', { name: '分类' }).nth(1)).toContainText('人物');
    expect((await page.evaluate(() => window.rainSoul.readGlobalKnowledge())).total).toBe(0);
    await expect(page.getByRole('button', { name: '确认加入全局库（0）' })).toBeDisabled();
    await page.getByRole('checkbox', { name: /我已核对作者/ }).check();
    const approvals = review.getByRole('checkbox', { name: '已逐字核对，审核入库' });
    await approvals.nth(0).check(); await approvals.nth(1).check();
    expect((await page.evaluate(() => window.rainSoul.readGlobalKnowledge())).total).toBe(0);
    await page.getByRole('button', { name: '确认加入全局库（2）' }).click();
    await expect(page.getByRole('status').filter({ hasText: '已将 2 条审核短摘录加入全局库' })).toBeVisible();
    const saved = await page.evaluate(() => window.rainSoul.readGlobalKnowledge());
    expect(saved.total).toBe(2); expect(saved.annotations).toHaveLength(2);
    expect(saved.entries.find(entry => entry.body.startsWith('酷暑炎夏')).source).toContain('原文第4段');
    expect(saved.annotations.every(annotation => annotation.technique && annotation.usage && annotation.exercise)).toBe(true);
    expect(await remainsHidden()).toBe(true);
    await application.evaluate(({ app }) => app.exit(0));
  } finally {
    await cleanup(application, directory);
  }
});
