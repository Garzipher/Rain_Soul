// Playwright 配置文件
// 配置使用本地 Chrome 浏览器

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chrome',
      use: {
        // 使用系统已安装的 Chrome 浏览器
        channel: 'chrome',
        // 如果 channel 不生效，可以直接指定 Chrome 可执行文件路径
        // executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        launchOptions: {
          // 以有头模式运行（可看到浏览器窗口）
          headless: false,
          // 启动参数
          args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
          ],
        },
      },
    },
    {
      name: 'chrome-headless',
      use: {
        channel: 'chrome',
        launchOptions: {
          headless: true,
        },
      },
    },
  ],

  // Web 服务器配置（按需修改）
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
