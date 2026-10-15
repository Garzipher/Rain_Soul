import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/contracts';
import { bridgeOperationError } from '../shared/operation-errors';

const invoke = async <T>(command: string, payload: unknown): Promise<T> => {
  const reply = await ipcRenderer.invoke('rainsoul:command', command, payload) as { ok: boolean; data: T; message?: string; code?: string };
  if (!reply.ok) throw bridgeOperationError(reply.message ?? '本机操作失败', reply.code);
  return reply.data;
};
const api: DesktopApi = {
  readGlobalKnowledge: query => invoke('readGlobalKnowledge', query ?? {}),
  manageGlobalKnowledge: request => invoke('manageGlobalKnowledge', request),
  getGlobalKnowledgeStatus: () => invoke('getGlobalKnowledgeStatus', {}),
  exportGlobalKnowledgeArchive: () => invoke('exportGlobalKnowledgeArchive', {}),
  chooseGlobalKnowledgeArchive: () => invoke('chooseGlobalKnowledgeArchive', {}),
  confirmGlobalKnowledgeArchive: request => invoke('confirmGlobalKnowledgeArchive', request),
  freezeGlobalKnowledge: request => invoke('freezeGlobalKnowledge', request),
  chooseGlobalBookExtraction: encoding => invoke('chooseGlobalBookExtraction', { encoding }),
  fetchGlobalWebExtraction: request => invoke('fetchGlobalWebExtraction', request),
  previewGlobalPastedExtraction: request => invoke('previewGlobalPastedExtraction', request),
  confirmGlobalBookExtraction: request => invoke('confirmGlobalBookExtraction', request),
  readGlobalExtractionDraft: () => invoke('readGlobalExtractionDraft', undefined),
  saveGlobalExtractionReview: request => invoke('saveGlobalExtractionReview', request),
  discardGlobalExtractionDraft: token => invoke('discardGlobalExtractionDraft', { token }),
  cancelGlobalBookExtraction: token => invoke('cancelGlobalBookExtraction', { token }),
  cancelGlobalWebExtraction: operationId => invoke('cancelGlobalWebExtraction', { operationId }),
  prepareGlobalBookExtractionAi: request => invoke('prepareGlobalBookExtractionAi', request),
  executeGlobalBookExtractionAi: request => invoke('executeGlobalBookExtractionAi', request),
  getGlobalBookExtractionAiResult: request => invoke('getGlobalBookExtractionAiResult', request),
  cancelGlobalBookExtractionAi: confirmationToken => invoke('cancelGlobalBookExtractionAi', { confirmationToken }),
  queryKnowledge: request => invoke('queryKnowledge', request),
  cancelKnowledgeQuery: queryId => invoke('cancelKnowledgeQuery', { queryId }),
  getRetrievalModelStatus: () => invoke('getRetrievalModelStatus', {}),
  importRetrievalModel: request => invoke('importRetrievalModel', request ?? {}),
  downloadRetrievalModel: request => invoke('downloadRetrievalModel', request),
  cancelRetrievalModelInstall: request => invoke('cancelRetrievalModelInstall', request),
  setRetrievalModelEnabled: enabled => invoke('setRetrievalModelEnabled', { enabled }),
  selectRetrievalModelSource: request => invoke('selectRetrievalModelSource', request),
  rebuildKnowledgeIndex: workId => invoke('rebuildKnowledgeIndex', { workId }),
  readExtractionDraft: workId => invoke('readExtractionDraft', { workId }),
  discardExtractionDraft: (workId, token) => invoke('discardExtractionDraft', { workId, token }),
  saveExtractionReview: request => invoke('saveExtractionReview', request),
  listConversations: workId => invoke('listConversations', { workId }),
  readConversation: (workId, conversationId, beforeMessageId) => invoke('readConversation', { workId, conversationId, ...(beforeMessageId ? { beforeMessageId } : {}) }),
  manageConversation: request => invoke('manageConversation', request),
  prepareConversationAi: request => invoke('prepareConversationAi', request),
  executeConversationAi: request => invoke('executeConversationAi', request),
  cancelConversationAi: confirmationToken => invoke('cancelConversationAi', { confirmationToken }),
  retryConversationReply: requestHash => invoke('retryConversationReply', { requestHash }),
  readPendingConversationReply: requestHash => invoke('readPendingConversationReply', { requestHash }),
  discardConversationReply: requestHash => invoke('discardConversationReply', { requestHash }),
  chooseBookExtraction: (workId, encoding) => invoke('chooseBookExtraction', { workId, encoding }),
  confirmBookExtraction: request => invoke('confirmBookExtraction', request),
  cancelBookExtraction: token => invoke('cancelBookExtraction', { token }),
  fetchWebExtraction: request => invoke('fetchWebExtraction', request),
  getWebRenderCapability: () => invoke('getWebRenderCapability', undefined),
  cancelWebExtraction: operationId => invoke('cancelWebExtraction', { operationId }),
  previewPastedExtraction: request => invoke('previewPastedExtraction', request),
  prepareBookExtractionAi: request => invoke('prepareBookExtractionAi', request),
  executeBookExtractionAi: request => invoke('executeBookExtractionAi', request),
  getBookExtractionAiResult: request => invoke('getBookExtractionAiResult', request),
  cancelBookExtractionAi: confirmationToken => invoke('cancelBookExtractionAi', { confirmationToken }),
  getAiSettings: () => invoke('getAiSettings', {}),
  saveAiSettings: (provider, key) => invoke('saveAiSettings', { provider, ...(key !== undefined ? { key } : {}) }),
  clearAiSettings: () => invoke('clearAiSettings', {}),
  prepareAi: request => invoke('prepareAi', request),
  executeAi: request => invoke('executeAi', request),
  cancelAi: confirmationToken => invoke('cancelAi', { confirmationToken }),
  applyAiCandidate: request => invoke('applyAiCandidate', request),
  approveAiKnowledge: request => invoke('approveAiKnowledge', request),
  chooseProjectArchive: () => invoke('chooseProjectArchive', {}),
  confirmProjectArchive: request => invoke('confirmProjectArchive', request),
  exportProjectArchive: workId => invoke('exportProjectArchive', { workId }),
  chooseManuscript: encoding => invoke('chooseManuscript', { encoding }),
  confirmManuscript: request => invoke('confirmManuscript', request),
  exportManuscript: (workId, format, snapshotId) => invoke('exportManuscript', { workId, format, ...(snapshotId ? { snapshotId } : {}) }),
  getAuthorProfile: () => invoke('getAuthorProfile', {}),
  setPenName: penName => invoke('setPenName', { penName }),
  chooseAvatar: () => invoke('chooseAvatar', {}),
  clearAvatar: () => invoke('clearAvatar', {}),
  listWorks: () => invoke('listWorks', {}),
  createWork: title => invoke('createWork', { title }),
  openWork: id => invoke('openWork', { id }),
  addChapter: (workId, title, expectedRevision, operationId, volumeId = null) => invoke('addChapter', { workId, title, expectedRevision, operationId, volumeId }),
  saveChapter: (workId, chapterId, title, document, expectedRevision, operationId) => invoke('saveChapter', { workId, chapterId, title, document, expectedRevision, operationId }),
  getRuntimeInfo: () => invoke('runtimeInfo', {}),
  manageStructure: request => invoke('manageStructure', request),
  manageAssets: request => invoke('manageAssets', request),
  searchWork: (workId, query) => invoke('searchWork', { workId, query }),
  readKnowledgeScope: scopeId => invoke('readKnowledgeScope', { scopeId }),
  searchKnowledgeScope: (scopeId, query) => invoke('searchKnowledgeScope', { scopeId, query }),
  copyKnowledge: request => invoke('copyKnowledge', request),
  listSnapshots: workId => invoke('listSnapshots', { workId }),
  previewSnapshot: (workId, snapshotId) => invoke('previewSnapshot', { workId, snapshotId }),
  createSnapshot: request => invoke('createSnapshot', request),
  restoreSnapshot: request => invoke('restoreSnapshot', request),
  listDeletedWorks: () => invoke('listDeletedWorks', {}),
  onCloseRequested: handler => {
    const listener = (_event: Electron.IpcRendererEvent, token: string) => { void handler().then(() => ipcRenderer.send('rainsoul:close-confirm', token)).catch(() => {}); };
    ipcRenderer.on('rainsoul:close-request', listener);
    return () => { ipcRenderer.removeListener('rainsoul:close-request', listener); };
  },
  onCloseFailed: handler => {
    const listener = (_event: Electron.IpcRendererEvent, message: unknown) => {
      if (typeof message === 'string') handler(message);
    };
    ipcRenderer.on('rainsoul:close-failed', listener);
    return () => { ipcRenderer.removeListener('rainsoul:close-failed', listener); };
  },
};
contextBridge.exposeInMainWorld('rainSoul', api);
