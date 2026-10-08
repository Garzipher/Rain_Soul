const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const demoUrl = pathToFileURL(path.resolve(__dirname, '../docs/demos/rainsoul-writing-style.html')).href;

test.beforeEach(async ({ page }) => {
  await page.goto(demoUrl);
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('[data-work-tab="plot"]').click();
});

test('知识下拉可连续多选，取消和移除同步更新关联区', async ({ page }) => {
  const trigger = page.getByRole('button', { name: '关联知识条目', exact: true });
  const menu = page.locator('#outline-knowledge-options');
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByText('关联知识条目', { exact: true })).toHaveCount(0);
  await expect(menu.locator('[value="entry-platform"]')).toHaveCount(0);
  await menu.locator('[value="entry-linwan"]').check();
  await expect(page.locator('[data-open-knowledge="entry-linwan"]')).toBeVisible();
  await menu.locator('[value="entry-letter"]').check();
  await expect(page.locator('#outline-knowledge-links .architecture-link')).toHaveCount(2);
  await expect(menu).toBeVisible();
  await expect(menu.locator('[value="entry-linwan"]')).toBeChecked();
  await menu.locator('[value="entry-linwan"]').uncheck();
  await expect(page.locator('[data-open-knowledge="entry-linwan"]')).toHaveCount(0);
  await trigger.click();
  await page.locator('[data-remove-knowledge="entry-letter"]').click();
  await trigger.click();
  await expect(menu.locator('[value="entry-letter"]')).not.toBeChecked();
  await expect(page.locator('#outline-knowledge-links .architecture-link')).toHaveCount(0);
});

test('伏笔下拉多选保留状态，转移关联后原节点不再持有', async ({ page }) => {
  await page.locator('[data-work-tab="foreshadow"]').click();
  await page.locator('#foreshadow-add-name').fill('旧信邮戳');
  await page.locator('#foreshadow-add').click();
  await page.locator('[data-work-tab="plot"]').click();
  const trigger = page.getByRole('button', { name: '关联伏笔', exact: true });
  const menu = page.locator('#outline-foreshadow-options');
  await trigger.click();
  await expect(menu.getByText('关联伏笔', { exact: true })).toHaveCount(0);
  await expect(menu).toContainText('当前关联：灯塔刻痕');
  await menu.getByRole('checkbox', { name: /灯塔刻痕/ }).check();
  await menu.getByRole('checkbox', { name: /旧信邮戳/ }).check();
  await expect(page.locator('#outline-foreshadow-links .architecture-link')).toHaveCount(2);
  await expect(menu).toBeVisible();
  await menu.getByRole('checkbox', { name: /旧信邮戳/ }).uncheck();
  await expect(page.locator('#outline-foreshadow-links')).not.toContainText('旧信邮戳');
  await page.locator('#outline-title').click();
  await trigger.click();
  await expect(menu.locator('[value="foreshadow-lighthouse"]')).toBeChecked();
  await page.locator('[data-select-node="outline-lighthouse"]').click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#outline-foreshadow-links .architecture-link')).toHaveCount(0);
  await page.locator('[data-work-tab="foreshadow"]').click();
  await page.locator('#foreshadow-list [data-foreshadow-id="foreshadow-lighthouse"]').click();
  await expect(page.locator('#foreshadow-outline')).toHaveValue('outline-harbor-volume');
});

test('多选下拉支持键盘连续勾选，Escape 返回按钮，离开时关闭', async ({ page }) => {
  const trigger = page.locator('#outline-knowledge-link');
  const menu = page.locator('#outline-knowledge-options');
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const first = menu.getByRole('checkbox').nth(0);
  const second = menu.getByRole('checkbox').nth(1);
  await expect(first).toBeFocused();
  await page.keyboard.press('Space');
  await expect(first).toBeChecked();
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(second).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#outline-knowledge-links .architecture-link')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page.locator('#outline-title').click();
  await expect(menu).toBeHidden();
  await trigger.click();
  await menu.getByRole('checkbox').last().focus();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  await expect(page.locator('[data-open-knowledge="entry-lighthouse"]')).toBeFocused();
});

test('选择切换节点和作品时保持隔离，打开另一种下拉会关闭前一个', async ({ page }) => {
  await page.locator('#outline-knowledge-link').click();
  await page.locator('#outline-knowledge-options [value="entry-letter"]').check();
  await page.locator('#outline-foreshadow-link').click();
  await expect(page.locator('#outline-knowledge-options')).toBeHidden();
  await page.locator('[data-select-node="outline-harbor-chapter"]').click();
  await expect(page.locator('#outline-foreshadow-options')).toBeHidden();
  await expect(page.locator('#outline-knowledge-links .architecture-link')).toHaveCount(0);
  await page.locator('[data-select-node="outline-harbor-volume"]').click();
  await expect(page.locator('[data-open-knowledge="entry-letter"]')).toBeVisible();
  await page.locator('#outline-knowledge-link').click();
  await page.locator('#back-shelf').click();
  await page.locator('.book[data-work="长夜列车"]').click();
  await page.locator('[data-work-tab="plot"]').click();
  await page.locator('#outline-knowledge-link').click();
  await expect(page.locator('#outline-knowledge-options [value="entry-letter"]')).toHaveCount(0);
  await expect(page.locator('#outline-knowledge-options [value="entry-platform"]')).toHaveCount(1);
  await expect(page.locator('#outline-knowledge-links .architecture-link')).toHaveCount(0);
});

test('空作品的多选下拉显示空状态，无可勾选的占位项', async ({ page }) => {
  await page.locator('#back-shelf').click();
  await page.locator('#new-work').click();
  await page.locator('#work-name').fill('空关联作品');
  await page.locator('#dialog-confirm').click();
  await page.locator('[data-work-tab="plot"]').click();
  await page.locator('#outline-add').click();
  await page.locator('#outline-knowledge-link').click();
  await expect(page.locator('#outline-knowledge-options')).toContainText('暂无可关联的知识条目');
  await expect(page.locator('#outline-knowledge-options input')).toHaveCount(0);
  await page.locator('#outline-foreshadow-link').click();
  await expect(page.locator('#outline-foreshadow-options')).toContainText('暂无可关联的伏笔');
  await expect(page.locator('#outline-foreshadow-options input')).toHaveCount(0);
});

test('窄屏下拉完整可操作，复选框位于条目右侧且不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.locator('#outline-knowledge-link').click();
  const menu = page.locator('#outline-knowledge-options');
  const checkbox = menu.locator('[value="entry-linwan"]');
  const row = menu.locator('label:has(input[value="entry-linwan"])');
  const bounds = await menu.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  const text = await row.locator('span').first().boundingBox();
  const box = await checkbox.boundingBox();
  expect(box.x).toBeGreaterThan(text.x + text.width);
  await checkbox.check();
  await expect(page.locator('[data-open-knowledge="entry-linwan"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('滚动使触发按钮离开视口时关闭多选下拉', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.locator('#outline-knowledge-link').click();
  await expect(page.locator('#outline-knowledge-options')).toBeVisible();
  await page.locator('#plot-panel .architecture-main').evaluate((element) => element.scrollTo(0, 0));
  await expect(page.locator('#outline-knowledge-options')).toBeHidden();
  await expect(page.locator('#outline-knowledge-link')).toHaveAttribute('aria-expanded', 'false');
});
