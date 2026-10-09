const { test, expect } = require('@playwright/test');
const { activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup } = require('./structure-helper.cjs');
const course = require('../../learning/项目全流程开发学习/course.json');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const chapterCount = course.volumes.reduce((count, volume) => count + volume.chapters.length, 0);

test('首次离线启动显示完整学习卷章，隐藏作者笔记入口但重启保留历史作者数据且不重复', async () => {
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
    await expect(page.getByRole('group', { name: /^分卷：/ })).toHaveCount(course.volumes.length);
    await expect(page.getByRole('button', { name: /^打开章节：/ })).toHaveCount(chapterCount);
    await expect(page.getByRole('article', { name: '教材正文' })).toContainText('读完之后，你能做什么');
    await expect(page.getByRole('navigation', { name: '本章目录' })).toBeVisible();
    const image = page.getByRole('article', { name: '教材正文' }).getByRole('img').first();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
    if (process.env.RAINSOUL_CAPTURE_LEARNING === '1') {
      const images = path.resolve('learning/项目全流程开发学习/images');
      await mkdir(images, { recursive: true });
      await page.screenshot({ path: path.join(images, 'textbook.png'), fullPage: true });
      const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 540));
      await page.screenshot({ path: path.join(images, 'textbook-narrow.png'), fullPage: true });
      await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), bounds);
    }
    await activate(page.getByRole('button', { name: 'Markdown 源文', exact: true }));
    await expect(page.getByRole('textbox', { name: '教材 Markdown 源文', exact: true })).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: '作者笔记', exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toHaveCount(0);
    const preserved = await page.evaluate(async () => {
      const summary = (await window.rainSoul.listWorks()).find(work => work.title === '项目全流程开发学习');
      const work = await window.rainSoul.openWork(summary.id), chapter = work.chapters[0];
      chapter.document.content.push({ type: 'paragraph', attrs: { id: crypto.randomUUID() }, content: [{ type: 'text', text: '原作者练习仍须保留。' }] });
      await window.rainSoul.saveChapter(work.id, chapter.id, chapter.title, chapter.document, work.revision, crypto.randomUUID());
      return { workId: work.id, chapterId: chapter.id };
    });
    await closeNormally(application);
    application = await launch(directory);
    page = await offlineWindow(application);
    await expect(learningCard()).toHaveCount(1);
    await activate(learningCard());
    await expect(page.getByRole('article', { name: '教材正文' })).toBeVisible();
    await expect(page.getByRole('button', { name: '作者笔记', exact: true })).toHaveCount(0);
    const retained = await page.evaluate(async identity => (await window.rainSoul.openWork(identity.workId)).chapters.find(chapter => chapter.id === identity.chapterId).document, preserved);
    expect(JSON.stringify(retained)).toContain('原作者练习仍须保留。');
    await expect(page.getByRole('button', { name: /^打开章节：/ })).toHaveCount(chapterCount);
  } finally { await cleanup(application, directory); }
});
