const { test, expect } = require('@playwright/test');
const { activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup } = require('./structure-helper.cjs');
const course = require('../../learning/项目全流程开发学习/course.json');
const chapterCount = course.volumes.reduce((count, volume) => count + volume.chapters.length, 0);

test('首次离线启动显示完整学习卷章，作者笔记重启后保留且不重复', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    application = await launch(directory);
    let page = await offlineWindow(application);
    const learningCard = () => page.getByRole('button', { name: '打开作品：项目全流程开发学习', exact: true });
    await expect(learningCard()).toHaveCount(1);
    await activate(page.getByRole('button', { name: '展开侧栏', exact: true }));
    await expect(page.locator('.brand-mark')).toBeVisible();
    await expect(page.locator('.brand-copy')).toHaveText('RainSoul');
    await page.screenshot({ path: test.info().outputPath('default-learning-shelf.png'), fullPage: true });
    await activate(learningCard());
    await expect(page.getByRole('group', { name: /^分卷：/ })).toHaveCount(8);
    await expect(page.getByRole('button', { name: /^打开章节：/ })).toHaveCount(chapterCount);
    await expect(page.getByRole('article', { name: '教材正文' })).toContainText('读完之后，你能做什么');
    await expect(page.getByRole('navigation', { name: '本章目录' })).toBeVisible();
    const image = page.getByRole('article', { name: '教材正文' }).getByRole('img').first();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
    await activate(page.getByRole('button', { name: 'Markdown 源文', exact: true }));
    await expect(page.getByRole('textbox', { name: '教材 Markdown 源文', exact: true })).toHaveAttribute('readonly', '');
    await activate(page.getByRole('button', { name: '作者笔记', exact: true }));
    const title = page.getByRole('textbox', { name: '章节标题', exact: true });
    const editor = page.getByRole('textbox', { name: '章节正文', exact: true });
    await expect(title).toHaveValue('从写作问题开始');
    await expect(editor).toContainText('读完之后，你能做什么');
    await page.screenshot({ path: test.info().outputPath('learning-manuscript.png'), fullPage: true });
    await expect(title).toBeEnabled();
    await editor.press('Control+End');
    await editor.press('Enter');
    await page.keyboard.insertText('我的练习记录：明天继续梳理数据流。');
    await expect(editor).toContainText('我的练习记录');
    await closeNormally(application);
    application = await launch(directory);
    page = await offlineWindow(application);
    await expect(learningCard()).toHaveCount(1);
    await activate(learningCard());
    await expect(page.getByRole('article', { name: '教材正文' })).toBeVisible();
    await activate(page.getByRole('button', { name: '作者笔记', exact: true }));
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toContainText('我的练习记录：明天继续梳理数据流。');
    await expect(page.getByRole('button', { name: /^打开章节：/ })).toHaveCount(chapterCount);
  } finally { await cleanup(application, directory); }
});
