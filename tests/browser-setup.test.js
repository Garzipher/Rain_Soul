// 浏览器配置验证测试
const { test, expect } = require('@playwright/test');

test.describe('浏览器配置验证', () => {
  test('使用本地 Chrome 浏览器启动', async ({ page, browserName }) => {
    console.log(`浏览器类型: ${browserName}`);
    console.log(`浏览器版本: ${page.context().browser().version()}`);

    await page.goto('about:blank');
    const title = await page.title();
    expect(title).toBe('');
    console.log('✓ Chrome 浏览器启动成功');
  });

  test('访问百度验证网络连通性', async ({ page }) => {
    await page.goto('https://www.baidu.com');
    const title = await page.title();
    expect(title).toContain('百度');
    console.log('✓ 网络连通性验证通过');
  });
});
