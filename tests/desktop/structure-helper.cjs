const { expect, _electron } = require('@playwright/test');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const processes = new WeakMap();
const runFile = promisify(execFile);

async function activate(button) {
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.press('Enter');
}

async function temporaryDirectory() {
  return mkdtemp(path.join(tmpdir(), 'rainsoul-structure-'));
}

function dataDirectory(directory) {
  return process.env.RAINSOUL_TEST_EXECUTABLE ? path.join(directory, 'RainSoul') : directory;
}

async function launch(directory, extraArgs = []) {
  const env = { ...process.env, RAINSOUL_TEST_DIRECTORY: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const executablePath = process.env.RAINSOUL_TEST_EXECUTABLE;
  let application;
  if (executablePath) {
    // 目录包与开发入口共用验收；作品与 Electron 档案均隔离在本次临时目录。
    env.LOCALAPPDATA = directory;
    env.APPDATA = directory;
    application = await _electron.launch({ executablePath, args: [`--user-data-dir=${path.join(directory, 'ElectronProfile')}`, ...extraArgs], env });
  } else {
    // Playwright 在最前注入自己的 loader；测试 -r 必须随后预加载，并排在主入口之前。
    application = await _electron.launch({ args: [...extraArgs, path.resolve('dist/desktop/main.cjs')], env });
  }
  processes.set(application, application.process());
  return application;
}

async function offlineWindow(application) {
  const page = await application.firstWindow();
  await page.waitForURL('rainsoul://app/');
  // 开发入口的后台验收必须隐藏；正式包安装矩阵另有前台运行约定。
  if (!process.env.RAINSOUL_TEST_EXECUTABLE) {
    expect(await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true);
  }
  await page.context().setOffline(true);
  await expect(page.getByRole('heading', { name: '作品集', exact: true })).toBeVisible();
  return page;
}

async function closeNormally(application) {
  const page = application.windows()[0];
  await Promise.all([
    page.waitForEvent('close'),
    application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close()),
  ]);
  // 先验证真实窗口通过保存门禁关闭，再释放调试器，允许主进程退出。
  await application.close();
}

async function cleanup(application, directory) {
  // 只清理本次创建的 PID 及子进程，不能结束其他工作区或用户打开的 Electron。
  const child = application && processes.get(application);
  if (child?.exitCode === null) {
    const exited = once(child, 'exit');
    if (process.platform === 'win32') await runFile('taskkill', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
    else child.kill('SIGKILL');
    await exited;
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function createWork(page, title) {
  await activate(page.getByRole('button', { name: '新建作品', exact: true }));
  await page.getByRole('textbox', { name: '作品名称', exact: true }).fill(title);
  await activate(page.getByRole('button', { name: '创建作品', exact: true }));
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  // 创建弹窗使用退出动画；标题输入必须等原生 dialog 完全卸载，否则隐藏窗口下
  // 仍在 top layer 的 inert dialog 会吞掉 Playwright 的 fill/input 事件。
  await expect(page.getByRole('dialog', { name: '新建作品', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toBeEnabled();
}

async function writeChapter(page, title, body) {
  const titleInput = page.getByRole('textbox', { name: '章节标题', exact: true });
  const editor = page.getByRole('textbox', { name: '章节正文', exact: true });
  await expect(titleInput).toBeEnabled();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await titleInput.fill(title);
  await expect(titleInput).toHaveValue(title);
  await editor.fill(body);
  await expect(editor).toHaveText(body);
  // 结构操作自身也必须 flush；此处刻意不等 500ms 自动保存。
}

module.exports = { activate, temporaryDirectory, dataDirectory, launch, offlineWindow, closeNormally, cleanup, createWork, writeChapter };
