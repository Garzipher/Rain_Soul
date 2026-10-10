const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const demoUrl = pathToFileURL(path.resolve(__dirname, '../docs/demos/rainsoul-source-intelligence.html')).href;
test.beforeEach(async ({ page }) => { await page.goto(demoUrl); });

test('拆文只为实际所选原段生成示例建议，审核入库后能选为写作参考', async ({ page }) => {
  await page.locator('.segment input').nth(0).uncheck();
  await page.locator('.segment input').nth(1).uncheck();
  await page.locator('.segment input').nth(2).check();
  await expect(page.getByRole('button', { name: '预览 AI 拆书建议' })).toBeDisabled();
  await page.locator('#rights').check();
  await page.getByRole('button', { name: '预览 AI 拆书建议' }).click();
  await expect(page.getByRole('dialog')).toContainText('第 09 段');
  await expect(page.getByRole('dialog')).not.toContainText('第 03 段');
  await page.getByRole('button', { name: '确认分析本批', exact: true }).click();
  await expect(page.locator('.source-preview')).toHaveText('远处的船鸣响了三次，第三次之后，整个港口忽然安静下来。');
  await page.getByRole('checkbox', { name: '审核通过第09段' }).check();
  await page.getByRole('button', { name: '确认入库（1）', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '停用模型' }).click();
  await page.getByRole('tab', { name: '知识检索' }).click();
  await page.getByLabel('检索知识').fill('船鸣');
  await page.getByRole('button', { name: '检索', exact: true }).click();
  const imported = page.locator('.result').filter({ hasText: '网页示例 · 第 09 段' });
  await expect(imported).toContainText('第三次之后');
  await imported.getByRole('button', { name: '用于当前写作参考', exact: true }).click();
  await page.getByRole('button', { name: '带参考返回写作' }).click();
  await expect(page.locator('#writingReferences')).toContainText('网页示例 · 第 09 段');
});

test('正文变化后旧示例候选过期，确认前取消复制不增加参考', async ({ page }) => {
  await page.getByRole('tab', { name: '知识检索' }).click();
  await page.getByRole('button', { name: '复制后用于写作' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('#refCount')).toHaveText('0 / 5');
  await page.getByRole('tab', { name: '写作参考' }).click();
  await page.getByRole('button', { name: '预览 AI 润色请求' }).click();
  await page.getByRole('button', { name: '生成示例候选' }).click();
  const editor = page.getByRole('textbox', { name: '正文编辑' });
  const original = await editor.innerText();
  await editor.fill(`${original}\n新增的作者句子必须保留。`);
  await expect(page.getByRole('button', { name: '确认写入正文', exact: true })).toBeDisabled();
  await expect(editor).toContainText('新增的作者句子必须保留。');
});

test('模型停用时回退关键词，无相关查询显示空态，窄窗侧栏真实展开', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '停用模型' }).click();
  await page.getByRole('tab', { name: '知识检索' }).click();
  await expect(page.locator('#retrieve-view .panel-head .chip').first()).toHaveText('关键词回退 · 模型已停用');
  await page.getByLabel('检索知识').fill('雨水');
  await page.getByRole('button', { name: '检索', exact: true }).click();
  await expect(page.locator('.result:visible')).toHaveCount(1);
  await page.getByLabel('检索知识').fill('星际不存在');
  await page.getByRole('button', { name: '检索', exact: true }).click();
  await expect(page.locator('#searchEmpty')).toBeVisible();
  await page.setViewportSize({ width: 720, height: 540 });
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await expect(page.locator('.brand')).toBeVisible();
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await page.setViewportSize({ width: 390, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('原文分页保留跨页勾选，知识结果分页可用，短窗口可滚动', async ({ page }) => {
  await expect(page.locator('#sourcePageInfo')).toContainText('第 1 / 4 页');
  await page.getByRole('button', { name: '下一页原文' }).click();
  await expect(page.locator('.segment:visible')).toHaveCount(3);
  await page.locator('.segment:visible input').first().check();
  await page.getByRole('button', { name: '上一页原文' }).click();
  await expect(page.locator('.segment:visible input').first()).toBeChecked();
  await expect(page.locator('.batch')).toContainText('本批 3');
  await page.getByRole('tab', { name: '知识检索' }).click();
  await page.getByRole('button', { name: '下一页参考' }).click();
  await expect(page.locator('#resultPageInfo')).toContainText('第 2 / 2 页');
  await expect(page.locator('.result:visible')).toHaveCount(3);
  await page.setViewportSize({ width: 900, height: 450 });
  await page.getByRole('tab', { name: '拆书工具' }).click();
  const scrolled = await page.locator('.content').evaluate(el => { el.scrollTop=300; return el.scrollTop>0; });
  expect(scrolled).toBe(true);
});


test('部分入库后下一批清空旧审核，保留尚未入库的段落', async ({ page }) => {
  await page.locator('#rights').check();
  await page.getByRole('button', { name: '预览 AI 拆书建议' }).click();
  await page.getByRole('button', { name: '确认分析本批' }).click();
  await page.getByRole('checkbox', { name: '审核通过第03段' }).check();
  await page.getByRole('button', { name: '确认入库（1）' }).click();
  await page.getByRole('button', { name: '继续下一批' }).click();
  await expect(page.locator('.review-item')).toHaveCount(0);
  await expect(page.locator('#commit')).toBeDisabled();
  await expect(page.locator('.segment input').nth(0)).not.toBeChecked();
  await expect(page.locator('.segment input').nth(1)).toBeChecked();
});
