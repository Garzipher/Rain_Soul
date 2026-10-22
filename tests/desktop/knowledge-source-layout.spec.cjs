const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup } = require('./structure-helper.cjs');

test.setTimeout(90000);
test('来源校验详情展开后完整哈希在默认及窄窗口内换行且不越出知识卡', async () => {
  const directory = await temporaryDirectory(); let application;
  try {
    application = await launch(directory); let page = await offlineWindow(application);
    const hash = createHash('sha256').update('test α来源布局夹具').digest('hex');
    await page.evaluate(async hash => {
      let work = await window.rainSoul.createWork('test α来源布局核验');
      for (const suffix of ['甲', '乙']) work = await window.rainSoul.manageAssets({ workId: work.id, expectedRevision: work.revision, operationId: crypto.randomUUID(),
        action: { type: 'createKnowledge', body: 'test 来源布局' + suffix, source: '《test来源布局》／作者：test；test.txt；第1章 第1段；文件 SHA-256：' + hash + '；段落 SHA-256：' + hash, categoryId: work.assets.categories[0].id, tagIds: [] } });
    }, hash);
    await closeNormally(application); application = await launch(directory); page = await offlineWindow(application);
    await activate(page.getByRole('button', { name: '打开作品：test α来源布局核验', exact: true }));
    await activate(page.getByRole('button', { name: '知识库', exact: true }));
    await activate(page.getByRole('button', { name: /^作品知识库/ }));
    const card = page.getByRole('article', { name: '知识：test 来源布局甲', exact: true });
    await activate(card.getByRole('button', { name: /^展开知识：/ }));
    await expect(card).not.toContainText('SHA-256');
    const verification = card.getByText('来源校验详情', { exact: true });
    await verification.press('Enter');
    await expect(card).toContainText('文件 SHA-256：' + hash); await expect(card).toContainText('段落 SHA-256：' + hash);
    const measure = async label => {
      await card.scrollIntoViewIfNeeded();
      const geometry = await card.evaluate(card => {
        const paragraph = card.querySelector('.bookmark-fulltext'), textNode = paragraph.firstChild;
        const box = card.getBoundingClientRect(), style = window.getComputedStyle(paragraph);
        const hashRects = [...paragraph.textContent.matchAll(/[a-f0-9]{64}/g)].map(match => {
          const range = document.createRange(); range.setStart(textNode, match.index); range.setEnd(textNode, match.index + match[0].length);
          return [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right }));
        });
        return { viewportWidth: innerWidth, card: { left: box.left, right: box.right, clientWidth: card.clientWidth, scrollWidth: card.scrollWidth },
          paragraph: { clientWidth: paragraph.clientWidth, scrollWidth: paragraph.scrollWidth, whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap }, hashRects };
      });
      await page.screenshot({ path: test.info().outputPath(label + '.png'), fullPage: true });
      return { label, ...geometry };
    };
    const measurements = [await measure('source-layout-default')];
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 540));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(720);
    const collapse = page.getByRole('button', { name: '收起侧栏', exact: true }); if (await collapse.isVisible()) await activate(collapse);
    measurements.push(await measure('source-layout-720'));
    await writeFile(test.info().outputPath('source-layout-geometry.json'), JSON.stringify(measurements, null, 2));
    for (const item of measurements) {
      expect(item.hashRects, item.label + '应保留两条完整哈希').toHaveLength(2);
      const overflow = item.hashRects.flat().filter(rect => rect.left < item.card.left - 1 || rect.right > item.card.right + 1);
      expect(overflow, item.label + '完整哈希文字不应横向越出知识卡').toEqual([]);
      expect(item.paragraph.scrollWidth, item.label + '详情不应产生横向溢出').toBeLessThanOrEqual(item.paragraph.clientWidth + 1);
      expect(item.card.scrollWidth, item.label + '卡片不应产生横向溢出').toBeLessThanOrEqual(item.card.clientWidth + 1);
    }
    await verification.press('Enter'); await expect(card).not.toContainText('SHA-256');
  } finally { await cleanup(application, directory); }
});
