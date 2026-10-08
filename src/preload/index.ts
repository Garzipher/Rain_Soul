import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/contracts';

const invoke = async <T>(command: string, payload: unknown): Promise<T> => {
  const reply = await ipcRenderer.invoke('rainsoul:command', command, payload) as { ok: boolean; data: T; message?: string };
  if (!reply.ok) throw new Error(reply.message ?? '本机操作失败');
  return reply.data;
};
const api: DesktopApi = {
  listWorks: () => invoke('listWorks', {}),
  createWork: title => invoke('createWork', { title }),
  openWork: id => invoke('openWork', { id }),
  addChapter: (workId, title, expectedRevision, operationId) => invoke('addChapter', { workId, title, expectedRevision, operationId }),
  saveChapter: (workId, chapterId, title, document, expectedRevision, operationId) => invoke('saveChapter', { workId, chapterId, title, document, expectedRevision, operationId }),
  getRuntimeInfo: () => invoke('runtimeInfo', {}),
  onCloseRequested: handler => {
    const listener = (_event: Electron.IpcRendererEvent, token: string) => { void handler().then(() => ipcRenderer.send('rainsoul:close-confirm', token)).catch(() => {}); };
    ipcRenderer.on('rainsoul:close-request', listener);
    return () => { ipcRenderer.removeListener('rainsoul:close-request', listener); };
  },
};
contextBridge.exposeInMainWorld('rainSoul', api);
