const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { mkdir, mkdtemp, rm, writeFile, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { _electron } = require('@playwright/test');

async function runCleanup(directory, confirmed) {
  const env = { ...process.env, LOCALAPPDATA: directory, APPDATA: directory, RAINSOUL_TEST_DIRECTORY: path.join(directory, 'ElectronProfile') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const executable = process.env.RAINSOUL_TEST_EXECUTABLE || require('electron');
  const args = process.env.RAINSOUL_TEST_EXECUTABLE ? [] : [path.resolve('dist/desktop/main.cjs')];
  args.push('--rainsoul-uninstall-cleanup'); if (confirmed) args.push('--confirm-delete-local-data');
  const child = spawn(executable, args, { env, windowsHide: true, stdio: 'ignore' });
  const timeout = setTimeout(() => child.kill(), 10000);
  try { const [code] = await once(child, 'exit'); return code; } finally { clearTimeout(timeout); }
}

test('真实 Electron 清理模式只删除临时本机作品，不初始化新库', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rainsoul-cleanup-e2e-'));
  try {
    const data = path.join(directory, 'RainSoul'); await mkdir(path.join(data, 'Projects'), { recursive: true });
    await writeFile(path.join(data, 'Projects', 'draft.sqlite'), '作者原稿'); await writeFile(path.join(directory, 'outside.txt'), '目录外保留');
    expect(await runCleanup(directory, true)).toBe(0);
    expect(existsSync(data)).toBe(false);
    expect(await readFile(path.join(directory, 'outside.txt'), 'utf8')).toBe('目录外保留');
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('真实 Electron 未确认清理模式退出并保留临时作品', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rainsoul-cleanup-e2e-'));
  try {
    const data = path.join(directory, 'RainSoul'); await mkdir(data); await writeFile(path.join(data, 'draft.sqlite'), '保留');
    expect(await runCleanup(directory, false)).toBe(3);
    expect(await readFile(path.join(data, 'draft.sqlite'), 'utf8')).toBe('保留');
    expect(existsSync(path.join(data, 'catalog.sqlite'))).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('同一用户档案的 RainSoul 仍运行时拒绝清理，不删除作品', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rainsoul-cleanup-lock-'));
  const env = { ...process.env, LOCALAPPDATA: directory, APPDATA: directory, RAINSOUL_TEST_DIRECTORY: path.join(directory, 'ElectronProfile') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  let application;
  try {
    const executablePath = process.env.RAINSOUL_TEST_EXECUTABLE;
    application = await _electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: [path.resolve('dist/desktop/main.cjs')] }), env });
    const page = await application.firstWindow(); await page.waitForURL('rainsoul://app/');
    await expect(page.getByRole('heading', { name: '作品集', exact: true })).toBeVisible();
    const data = path.join(directory, 'RainSoul'); await mkdir(data, { recursive: true });
    await writeFile(path.join(data, 'cleanup-sentinel.txt'), '运行中原稿保留');
    expect(await runCleanup(directory, true)).toBe(2);
    expect(await readFile(path.join(data, 'cleanup-sentinel.txt'), 'utf8')).toBe('运行中原稿保留');
    await expect(page.getByRole('heading', { name: '作品集', exact: true })).toBeVisible();
  } finally {
    if (application) await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
