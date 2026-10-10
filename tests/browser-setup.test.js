// 浏览器配置验证测试
const { test, expect } = require('@playwright/test');
const { createServer } = require('node:http');

test.describe('浏览器配置验证', () => {
  test('使用本地 Chrome 浏览器启动', async ({ page, browserName }) => {
    console.log(`浏览器类型: ${browserName}`);
    console.log(`浏览器版本: ${page.context().browser().version()}`);

    await page.goto('about:blank');
    const title = await page.title();
    expect(title).toBe('');
    console.log('✓ Chrome 浏览器启动成功');
  });

  test('本地HTTP连通性与离线隔离使用真实浏览器验证', async ({ page }) => {
    const requests = [];
    const server = createServer((request, response) => {
      requests.push(request.url);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>RainSoul 本地连通性</title><main>本机预览服务已连接</main>');
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      const response = await page.goto(`${url}/online`);
      expect(response.status()).toBe(200);
      await expect(page).toHaveTitle('RainSoul 本地连通性');
      await expect(page.getByRole('main')).toHaveText('本机预览服务已连接');
      expect(requests).toContain('/online');
      await page.context().setOffline(true);
      await expect(page.goto(`${url}/offline`)).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
      expect(requests).not.toContain('/offline');
    } finally {
      try { await page.context().setOffline(false); }
      finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    }
  });
});
