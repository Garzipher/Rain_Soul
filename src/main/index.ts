import { app, BrowserWindow, ipcMain, protocol, net, Menu } from 'electron';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseClient } from './database-client';
import { StoreService } from './store-service';

protocol.registerSchemesAsPrivileged([{ scheme: 'rainsoul', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const testDirectory = !app.isPackaged ? process.env.RAINSOUL_TEST_DIRECTORY : undefined;
if (testDirectory) app.setPath('userData', resolve(testDirectory));
const hasLock = app.requestSingleInstanceLock();
let window: BrowserWindow | null = null;
let database: DatabaseClient | null = null;
let allowClose = false;
let closeToken: string | null = null;
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const directory = testDirectory ?? join(process.env.LOCALAPPDATA ?? app.getPath('userData'), 'RainSoul');
    database = new DatabaseClient(directory);
    const store = new StoreService((command, payload) => database!.request(command, payload));
    const rendererRoot = resolve(__dirname, '../renderer');
    protocol.handle('rainsoul', request => {
      const url = new URL(request.url);
      const file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (url.host !== 'app' || !file.startsWith(rendererRoot + sep)) return new Response('拒绝访问', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    window = new BrowserWindow({
      title: 'RainSoul', icon: join(__dirname, 'rainsoul.png'), width: 1280, height: 840, minWidth: 720, minHeight: 540,
      show: !testDirectory, backgroundColor: '#ffffff', autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
    });
    const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame;
    ipcMain.handle('rainsoul:command', async (event, command: unknown, payload: unknown) => {
      if (!trusted(event)) return { ok: false, message: '拒绝来源不明的命令' };
      try {
        if (command === 'runtimeInfo') return { ok: true, data: { version: app.getVersion(), dataDirectory: join(directory, 'Projects') } };
        if (typeof command !== 'string') throw new Error('存储命令无效');
        return { ok: true, data: await store.execute(command, payload) };
      } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '本机操作失败' }; }
    });
    ipcMain.on('rainsoul:close-confirm', (event, token: unknown) => {
      if (!trusted(event) || typeof token !== 'string' || token !== closeToken) return;
      void store.drain().then(() => { if (token === closeToken) { allowClose = true; window?.close(); } });
    });
    window.on('close', event => {
      if (allowClose) return;
      event.preventDefault(); closeToken = randomUUID();
      window?.webContents.send('rainsoul:close-request', closeToken);
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r')) event.preventDefault();
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    await window.loadURL('rainsoul://app/');
  }).catch(error => { console.error('桌面初始化失败', error instanceof Error ? error.name : 'Unknown'); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (allowClose) database?.close(); });
}
