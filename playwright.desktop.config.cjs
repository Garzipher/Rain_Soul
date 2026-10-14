const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/desktop', timeout: 45000, workers: 1,
  outputDir: './.artifacts/tests/desktop',
  reporter: 'line', use: { trace: 'retain-on-failure' },
});
