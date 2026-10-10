import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DesktopApi, WorkDetail } from '../../src/shared/contracts';
import { WorkRepository } from '../../src/workers/database/repository';
import { StoreService } from '../../src/main/store-service';

/** 在 UI 集成测试中使用真实 SQLite 和主进程白名单，只隔离窗口及磁盘失败注入。 */
export function createStructureAdapter() {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-renderer-structure-'));
  const repository = new WorkRepository(directory);
  const works = new Map<string, WorkDetail>();
  let failing = false;
  let closeHandler: (() => Promise<void>) | null = null;
  const store = new StoreService(async (command, payload) => {
    const input = payload as Record<string, unknown>;
    if (command === 'listWorks') return repository.listWorks();
    if (command === 'listConversations') return repository.listConversations(input.workId as string);
    if (command === 'readConversation') return repository.readConversation(input.workId as string, input.conversationId as string, input.beforeMessageId as string | undefined);
    if (command === 'manageConversation') return repository.manageConversation(input as unknown as Parameters<WorkRepository['manageConversation']>[0]);
    if (command === 'listDeletedWorks') return repository.listDeletedWorks();
    if (command === 'listSnapshots') return repository.listSnapshots(input.workId as string);
    if (command === 'previewSnapshot') return repository.previewSnapshot(input.workId as string, input.snapshotId as string);
    if (command === 'createSnapshot') return repository.createSnapshot(input as unknown as Parameters<WorkRepository['createSnapshot']>[0]);
    if (command === 'restoreSnapshot') return repository.restoreSnapshot(input as unknown as Parameters<WorkRepository['restoreSnapshot']>[0]);
    if (command === 'createWork') return repository.createWork(input.title as string);
    if (command === 'importManuscript') return repository.importManuscript(input as unknown as Parameters<WorkRepository['importManuscript']>[0]);
    if (command === 'openWork') return repository.openWork(input.id as string);
    if (command === 'manageStructure') return repository.manageStructure(input as unknown as Parameters<WorkRepository['manageStructure']>[0]);
    if (command === 'manageAssets') return repository.manageAssets(input as unknown as Parameters<WorkRepository['manageAssets']>[0]);
    if (command === 'searchWork') return repository.searchWork(input.workId as string, input.query as Parameters<WorkRepository['searchWork']>[1]);
    if (command === 'readKnowledgeScope') return repository.readKnowledgeScope(input.scopeId as string | null);
    if (command === 'searchKnowledgeScope') return repository.searchKnowledgeScope(input.scopeId as string | null, input.query as Parameters<WorkRepository['searchWork']>[1]);
    if (command === 'copyKnowledge') return repository.copyKnowledge(input as unknown as Parameters<WorkRepository['copyKnowledge']>[0]);
    if (command === 'addChapter') return repository.addChapter(input.workId as string, input.title as string, input.expectedRevision as number, input.operationId as string, input.volumeId as string | null | undefined);
    if (command === 'saveChapter') {
      if (failing) throw new Error('磁盘空间不足');
      return repository.saveChapter(input.workId as string, input.chapterId as string, input.title as string, input.document as Parameters<WorkRepository['saveChapter']>[3], input.expectedRevision as number, input.operationId as string);
    }
    throw new Error('未支持的测试命令');
  });
  function remember(detail: WorkDetail) { works.set(detail.id, structuredClone(detail)); return detail; }
  const api: DesktopApi = {
    async listConversations(workId) { return await store.execute('listConversations', { workId }) as Awaited<ReturnType<DesktopApi['listConversations']>>; },
    async readConversation(workId, conversationId, beforeMessageId) { return await store.execute('readConversation', { workId, conversationId, ...(beforeMessageId ? { beforeMessageId } : {}) }) as Awaited<ReturnType<DesktopApi['readConversation']>>; },
    async manageConversation(request) { return await store.execute('manageConversation', request) as Awaited<ReturnType<DesktopApi['manageConversation']>>; },
    async prepareConversationAi() { throw new Error('此测试未启用会话云服务'); },
    async executeConversationAi() { throw new Error('此测试未启用会话云服务'); },
    async cancelConversationAi() {},
    async retryConversationReply() { throw new Error('此测试未启用回复恢复'); },
    async readPendingConversationReply() { throw new Error('此测试未启用回复恢复'); },
    async discardConversationReply() {},
    async chooseBookExtraction() { return null; },
    async confirmBookExtraction() { throw new Error('此测试未启用拆书'); },
    async cancelBookExtraction() {},
    async prepareBookExtractionAi() { throw new Error('此测试未启用拆书云服务'); },
    async executeBookExtractionAi() { throw new Error('此测试未启用拆书云服务'); },
    async getBookExtractionAiResult() { return { status: 'missing' }; },
    async cancelBookExtractionAi() {},
    async getAiSettings() { return { provider: null, hasCredential: false }; },
    async saveAiSettings(provider) { return { provider, hasCredential: true }; },
    async clearAiSettings() { return { provider: null, hasCredential: false }; },
    async prepareAi() { throw new Error('此测试未启用 AI'); },
    async executeAi() { throw new Error('此测试未启用 AI'); },
    async cancelAi() {},
    async applyAiCandidate() { throw new Error('此测试未启用 AI'); },
    async approveAiKnowledge() { throw new Error('此测试未启用 AI'); },
    async chooseProjectArchive() { return null; },
    async confirmProjectArchive() { throw new Error('此测试未启用归档'); },
    async exportProjectArchive() { return false; },
    async chooseManuscript() { return null; },
    async confirmManuscript(request) { return remember(await store.execute('importManuscript', { operationId: request.operationId, draft: request.draft }) as WorkDetail); },
    async exportManuscript() { return false; },
    async listSnapshots(workId) { return await store.execute('listSnapshots', { workId }) as Awaited<ReturnType<DesktopApi['listSnapshots']>>; },
    async previewSnapshot(workId, snapshotId) { return await store.execute('previewSnapshot', { workId, snapshotId }) as Awaited<ReturnType<DesktopApi['previewSnapshot']>>; },
    async createSnapshot(request) { return remember(await store.execute('createSnapshot', request) as WorkDetail); },
    async restoreSnapshot(request) { return remember(await store.execute('restoreSnapshot', request) as WorkDetail); },
    async manageAssets(request) { return remember(await store.execute('manageAssets', request) as WorkDetail); },
    async searchWork(workId, query) { return await store.execute('searchWork', { workId, query }) as Awaited<ReturnType<DesktopApi['searchWork']>>; },
    async readKnowledgeScope(scopeId) { return await store.execute('readKnowledgeScope', { scopeId }) as Awaited<ReturnType<DesktopApi['readKnowledgeScope']>>; },
    async searchKnowledgeScope(scopeId, query) { return await store.execute('searchKnowledgeScope', { scopeId, query }) as Awaited<ReturnType<DesktopApi['searchKnowledgeScope']>>; },
    async copyKnowledge(request) { return remember(await store.execute('copyKnowledge', request) as WorkDetail); },
    async getAuthorProfile() { return { penName: '', avatarDataUrl: null }; },
    async setPenName(penName) { return { penName, avatarDataUrl: null }; },
    async chooseAvatar() { return { penName: '', avatarDataUrl: null }; },
    async clearAvatar() { return { penName: '', avatarDataUrl: null }; },
    async listWorks() { return await store.execute('listWorks', {}) as Awaited<ReturnType<DesktopApi['listWorks']>>; },
    async listDeletedWorks() { return await store.execute('listDeletedWorks', {}) as Awaited<ReturnType<DesktopApi['listDeletedWorks']>>; },
    async createWork(title) { return remember(await store.execute('createWork', { title }) as WorkDetail); },
    async openWork(id) { return remember(await store.execute('openWork', { id }) as WorkDetail); },
    async addChapter(workId, title, expectedRevision, operationId, volumeId) { return remember(await store.execute('addChapter', { workId, title, expectedRevision, operationId, volumeId }) as WorkDetail); },
    async saveChapter(workId, chapterId, title, document, expectedRevision, operationId) {
      const result = await store.execute('saveChapter', { workId, chapterId, title, document, expectedRevision, operationId }) as Awaited<ReturnType<DesktopApi['saveChapter']>>;
      remember(repository.openWork(workId));
      return result;
    },
    async manageStructure(request) {
      const result = await store.execute('manageStructure', request) as WorkDetail | null;
      if (result) remember(result); else works.delete(request.workId);
      return result;
    },
    async getRuntimeInfo() { return { version: '1.0.0', dataDirectory: directory }; },
    onCloseRequested(handler) { closeHandler = handler; return () => { closeHandler = null; }; },
  };
  return { api, works, failSave: (value: boolean) => { failing = value; }, close: async () => { await closeHandler?.(); }, dispose: () => { repository.close(); rmSync(directory, { recursive: true, force: true }); } };
}
