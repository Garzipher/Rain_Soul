const { test, expect, _electron } = require('@playwright/test');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const processes = new WeakMap();
const runFile = promisify(execFile);

async function launch(directory) {
  const env = { ...process.env, RAINSOUL_TEST_DIRECTORY: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const executablePath = process.env.RAINSOUL_TEST_EXECUTABLE;
  let application;
  if (executablePath) {
    // 目录包使用真实发布入口，同时把 Windows 作品与 Electron 档案隔离在本次临时目录。
    env.LOCALAPPDATA = directory;
    env.APPDATA = directory;
    application = await _electron.launch({ executablePath, args: [`--user-data-dir=${path.join(directory, 'ElectronProfile')}`], env });
  } else {
    application = await _electron.launch({ args: [path.resolve('dist/desktop/main.cjs')], env });
  }
  processes.set(application, application.process());
  return application;
}

async function closeNormally(application) {
  if (!application || processes.get(application)?.exitCode !== null) return;
  const page = application.windows()[0];
  await Promise.all([
    page.waitForEvent('close'),
    application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close()),
  ]);
  // 页面已通过保存门禁关闭，再释放调试连接，避免 Node inspector 持续等待 debugger disconnect。
  await application.close();
}

async function cleanup(application, directory) {
  // 正常关闭在重启验收中单独断言；收尾只结束本次测试进程，避免 Playwright 先释放渲染器导致关窗确认悬挂。
  const child = application && processes.get(application);
  if (child?.exitCode === null) {
    const exited = once(child, 'exit');
    if (process.platform === 'win32') await runFile('taskkill', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
    else child.kill('SIGKILL');
    await exited;
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
test('真实 Electron 创建、离线写作、关闭保存和重启恢复', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rainsoul-desktop-'));
  let application;
  try {
    application = await launch(directory);
    let page = await application.firstWindow();
    await page.waitForURL('rainsoul://app/');
    await page.context().setOffline(true);
    await expect(page.getByRole('heading', { name: '作品集', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('shelf.png'), fullPage: true });
    await page.getByRole('button', { name: '新建作品' }).click();
    await page.getByRole('textbox', { name: '作品名称' }).fill('离线写作验收');
    await page.getByRole('button', { name: '创建作品', exact: true }).click();
    await page.getByRole('textbox', { name: '章节标题' }).fill('雨落时分');
    const editor = page.getByRole('textbox', { name: '章节正文' });
    await editor.fill('雨A1， B2');
    await expect(page.getByText('本章 5 字', { exact: true })).toBeVisible();
    await expect(page.getByText('已保存', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('writing.png'), fullPage: true });
    await editor.press('End');
    await editor.press('Enter');
    await page.keyboard.insertText('重启仍在');
    // 未等停顿保存，正常关闭必须先完成最新草稿落盘。
    await closeNormally(application);
    application = await launch(directory);
    page = await application.firstWindow();
    await page.waitForURL('rainsoul://app/');
    await page.context().setOffline(true);
    await page.getByRole('button', { name: '打开作品：离线写作验收' }).click();
    await expect(page.getByRole('textbox', { name: '章节标题' })).toHaveValue('雨落时分');
    await expect(page.getByRole('textbox', { name: '章节正文' })).toContainText('重启仍在');
    await page.getByRole('button', { name: '添加章节' }).click();
    await expect(page.getByRole('textbox', { name: '章节标题' })).toHaveValue('第2章');
    await page.getByRole('button', { name: '打开章节：雨落时分', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '章节正文' })).toContainText('雨A1， B2');
    const isolation = await page.evaluate(() => ({ node: typeof window.require, bridge: typeof window.rainSoul.saveChapter }));
    expect(isolation).toEqual({ node: 'undefined', bridge: 'function' });
  } finally {
    await cleanup(application, directory);
  }
});

test('未保存稿件不能通过菜单或快捷键重载窗口', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rainsoul-reload-'));
  let application;
  try {
    application = await launch(directory);
    const page = await application.firstWindow();
    await page.waitForURL('rainsoul://app/');
    await expect(page.getByRole('heading', { name: '作品集', exact: true })).toBeVisible();
    const reloadRoles = await application.evaluate(({ Menu }) => {
      const roles = [];
      const inspect = menu => {
        for (const item of menu?.items ?? []) {
          if (item.role === 'reload' || item.role === 'forcereload') roles.push(item.role);
          inspect(item.submenu);
        }
      };
      inspect(Menu.getApplicationMenu());
      return roles;
    });
    expect(reloadRoles).toEqual([]);
    await page.getByRole('button', { name: '新建作品' }).click();
    await page.getByRole('textbox', { name: '作品名称' }).fill('快捷键保护');
    await page.getByRole('button', { name: '创建作品', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '章节正文' });
    await application.evaluate(({ BrowserWindow }) => {
      globalThis.rainsoulReloads = [];
      BrowserWindow.getAllWindows()[0].webContents.on('did-start-navigation', (_event, url, _inPlace, mainFrame) => {
        if (mainFrame) globalThis.rainsoulReloads.push(url);
      });
    });
    for (const key of ['Control+r', 'Control+Shift+r', 'F5']) {
      await editor.fill(`保留这份草稿：${key}`);
      await editor.press(key);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      expect(await application.evaluate(() => globalThis.rainsoulReloads)).toEqual([]);
      await expect(editor).toContainText(`保留这份草稿：${key}`);
    }
  } finally { await cleanup(application, directory); }
});
