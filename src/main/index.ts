import { app, BrowserWindow, ipcMain, protocol, net, Menu, dialog, nativeImage, safeStorage } from 'electron';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseClient } from './database-client';
import { StoreService } from './store-service';
import { ProfileService } from './profile-service';
import { ProfileCommands } from './profile-commands';
import { selectAuthorAvatar } from './avatar-selection';
import { ManuscriptCommands } from './manuscript-commands';
import { chooseLocalManuscript, saveLocalExport } from './manuscript-files';
import { ArchiveCommands } from './archive-commands';
import { AiCommands } from './ai-commands';
import { AiSettingsStore } from './ai-settings';
import { AiService } from './ai-service';
import { errorCode } from '../shared/operation-errors';
import { cleanupLocalData } from './uninstall-cleanup';
import { assertPublicP1Command } from './p1-command-policy';
import { BookExtractionCommands } from './book-extraction-commands';
import { ConversationAiCommands } from './conversation-ai-commands';
import { ConversationAiService } from './conversation-ai-service';
import { BookExtractionAiCommands } from './book-extraction-ai-commands';
import { BookExtractionAiService } from './book-extraction-ai-service';
import { ExtractionDraftStore } from './extraction-draft-store';
import { ExtractionDraftCoordinator } from './extraction-draft-coordinator';

protocol.registerSchemesAsPrivileged([{ scheme: 'rainsoul', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const testDirectory = !app.isPackaged ? process.env.RAINSOUL_TEST_DIRECTORY : undefined;
if (testDirectory) app.setPath('userData', resolve(testDirectory));
const cleanupMode = process.argv.includes('--rainsoul-uninstall-cleanup');
const hasLock = app.requestSingleInstanceLock({ cleanupMode });
let window: BrowserWindow | null = null;
let database: DatabaseClient | null = null;
let allowClose = false;
let closeToken: string | null = null;
if (!hasLock) { if (cleanupMode) app.exit(2); else app.quit(); }
else if (cleanupMode) {
  // 卸载模式不初始化数据库、窗口或教材；授权标志只允许清理当前用户固定本机目录。
  if (!process.argv.includes('--confirm-delete-local-data')) app.exit(3);
  else void app.whenReady().then(() => {
    try { cleanupLocalData({ localAppData: process.env.LOCALAPPDATA, confirmed: true }); app.exit(0); }
    catch (error) {
      dialog.showErrorBox('本机数据未完成清理', error instanceof Error ? error.message : '清理失败，安装程序已保留。');
      app.exit(4);
    }
  });
}
else {
  app.on('second-instance', (_event, _argv, _directory, additionalData) => {
    if (additionalData && typeof additionalData === 'object' && 'cleanupMode' in additionalData && additionalData.cleanupMode === true) return;
    if (window?.isMinimized()) window.restore(); window?.show(); window?.focus();
  });
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const directory = testDirectory ?? join(process.env.LOCALAPPDATA ?? app.getPath('userData'), 'RainSoul');
    database = new DatabaseClient(directory);
    const store = new StoreService((command, payload) => database!.request(command, payload));
    const manuscripts = new ManuscriptCommands(store, {
      choose: () => chooseLocalManuscript(() => dialog.showOpenDialog(window!, { title: '导入手稿', properties: ['openFile'], filters: [{ name: 'TXT / DOCX 手稿', extensions: ['txt', 'docx'] }] })),
      save: (name, bytes) => saveLocalExport(() => dialog.showSaveDialog(window!, { title: '导出手稿', defaultPath: name, filters: [{ name: '手稿', extensions: [name.endsWith('.docx') ? 'docx' : 'txt'] }] }), bytes),
    });
    const archives = new ArchiveCommands(store, {
      choose: () => chooseLocalManuscript(() => dialog.showOpenDialog(window!, { title: '导入项目归档', properties: ['openFile'], filters: [{ name: 'RainSoul 项目归档', extensions: ['rainsoul'] }] }), 257 * 1024 * 1024),
      save: (name, bytes) => saveLocalExport(() => dialog.showSaveDialog(window!, { title: '备份项目', defaultPath: name, filters: [{ name: 'RainSoul 项目归档', extensions: ['rainsoul'] }] }), bytes),
    });
    const authorService = new ProfileService(directory);
    const aiSettings = new AiSettingsStore(directory, safeStorage);
    const aiService = new AiService({ credentials: aiSettings });
    const ai = new AiCommands(store, aiSettings, aiService);
    const conversationAi = new ConversationAiCommands(store, aiSettings, new ConversationAiService({ credentials: aiSettings }));
    const extractionDrafts = new ExtractionDraftCoordinator(new ExtractionDraftStore(join(directory, 'ExtractionDrafts')), store);
    const books = new BookExtractionCommands(store, { choose: () => chooseLocalManuscript(() => dialog.showOpenDialog(window!, { title: '选择拆书素材', properties: ['openFile'], filters: [{ name: 'TXT / DOCX 素材', extensions: ['txt', 'docx'] }] })) }, undefined, extractionDrafts);
    const bookAi = new BookExtractionAiCommands(store, aiSettings, books, new BookExtractionAiService({ credentials: aiSettings }), extractionDrafts);
    const profiles = new ProfileCommands(authorService, () => selectAuthorAvatar(authorService,
      () => dialog.showOpenDialog(window!, { title: '选择本地头像', properties: ['openFile'], filters: [{ name: 'PNG / JPEG 图片', extensions: ['png', 'jpg', 'jpeg'] }] }),
      bytes => nativeImage.createFromBuffer(bytes)));
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
        assertPublicP1Command(command, payload);
        if (profiles.accepts(command)) return { ok: true, data: await profiles.execute(command, payload) };
        if (manuscripts.accepts(command)) return { ok: true, data: await manuscripts.execute(command, payload) };
        if (archives.accepts(command)) return { ok: true, data: await archives.execute(command, payload) };
        if (ai.accepts(command)) return { ok: true, data: await ai.execute(command, payload) };
        if (conversationAi.accepts(command)) return { ok: true, data: await conversationAi.execute(command, payload) };
        if (books.accepts(command)) return { ok: true, data: await books.execute(command, payload) };
        if (bookAi.accepts(command)) return { ok: true, data: await bookAi.execute(command, payload) };
        return { ok: true, data: await store.execute(command, payload) };
      } catch (error) { return { ok: false, code: errorCode(error), message: error instanceof Error ? error.message : '本机操作失败' }; }
    });
    ipcMain.on('rainsoul:close-confirm', (event, token: unknown) => {
      if (!trusted(event) || typeof token !== 'string' || token !== closeToken) return;
      void Promise.all([store.drain(), profiles.drain(), manuscripts.drain(), archives.drain(), ai.drain(), conversationAi.drain(), books.drain(), bookAi.drain()]).then(() => { if (token === closeToken) { allowClose = true; window?.close(); } });
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
