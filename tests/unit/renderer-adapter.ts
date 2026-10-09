import type { DesktopApi, WorkDetail, WritingDocument } from '../../src/shared/contracts';

export function createAdapter() {
  const works = new Map<string, WorkDetail>();
  let failing = false;
  let closeHandler: (() => Promise<void>) | null = null;
  const emptyDocument = (): WritingDocument => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: crypto.randomUUID() } }] });
  const api: DesktopApi = {
    async listConversations() { return []; },
    async readConversation() { throw new Error('此测试未启用会话'); },
    async manageConversation() { throw new Error('此测试未启用会话'); },
    async prepareConversationAi() { throw new Error('此测试未启用会话云服务'); },
    async executeConversationAi() { throw new Error('此测试未启用会话云服务'); },
    async cancelConversationAi() {},
    async retryConversationReply() { throw new Error('此测试未启用回复恢复'); },
    async readPendingConversationReply() { throw new Error('此测试未启用回复恢复'); },
    async discardConversationReply() {},
    async chooseBookExtraction() { return null; },
    async confirmBookExtraction() { throw new Error('此测试未启用拆书'); },
    async cancelBookExtraction() {},
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
    async confirmManuscript() { throw new Error('此测试未启用手稿导入'); },
    async exportManuscript() { return false; },
    async getAuthorProfile() { return { penName: '', avatarDataUrl: null }; },
    async setPenName(penName) { return { penName, avatarDataUrl: null }; },
    async chooseAvatar() { return { penName: '', avatarDataUrl: null }; },
    async clearAvatar() { return { penName: '', avatarDataUrl: null }; },
    async listWorks() {
      return [...works.values()].map((work) => ({ id: work.id, title: work.title, wordCount: work.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0), chapterCount: work.chapters.length, updatedAt: new Date().toISOString() }));
    },
    async createWork(title) {
      const work: WorkDetail = { id: crypto.randomUUID(), title, revision: 0, volumes: [], deletedItems: [], chapters: [{ id: crypto.randomUUID(), title: '第一章', document: emptyDocument(), wordCount: 0, volumeId: null }] };
      works.set(work.id, work);
      return structuredClone(work);
    },
    async openWork(id) {
      const work = works.get(id);
      if (!work) throw new Error('作品不存在');
      return structuredClone(work);
    },
    async addChapter(workId, title, expectedRevision, _operationId, volumeId = null) {
      const work = works.get(workId)!;
      if (work.revision !== expectedRevision) throw new Error('作品版本已变化');
      work.chapters.push({ id: crypto.randomUUID(), title, document: emptyDocument(), wordCount: 0, volumeId });
      work.revision += 1;
      return structuredClone(work);
    },
    async saveChapter(workId, chapterId, title, document, expectedRevision) {
      if (failing) throw new Error('磁盘空间不足');
      const work = works.get(workId)!;
      if (work.revision !== expectedRevision) throw new Error('作品版本已变化');
      const chapter = work.chapters.find((item) => item.id === chapterId)!;
      chapter.title = title;
      chapter.document = structuredClone(document);
      chapter.wordCount = document.content.flatMap((paragraph) => paragraph.content ?? []).filter((node) => node.type === 'text').map((node) => node.text ?? '').join('').match(/[\p{Script=Han}A-Za-z0-9]/gu)?.length ?? 0;
      work.revision += 1;
      return { revision: work.revision, wordCount: chapter.wordCount };
    },
    async manageStructure() { throw new Error('此测试未启用结构操作'); },
    async manageAssets() { throw new Error('此测试未启用资产操作'); },
    async searchWork() { return []; },
    async readKnowledgeScope() { return { knowledge: [], categories: [], tags: [], entryOwners: {} }; },
    async searchKnowledgeScope() { return []; },
    async copyKnowledge() { throw new Error('此测试未启用知识复制'); },
    async listDeletedWorks() { return []; },
    async listSnapshots() { return []; },
    async previewSnapshot() { throw new Error('此测试未启用快照预览'); },
    async createSnapshot() { throw new Error('此测试未启用快照操作'); },
    async restoreSnapshot() { throw new Error('此测试未启用快照操作'); },
    async getRuntimeInfo() { return { version: '0.1.0', dataDirectory: 'C:\\Local\\RainSoul\\Projects' }; },
    onCloseRequested(handler) { closeHandler = handler; return () => { closeHandler = null; }; },
  };
  return { api, works, failSave: (value: boolean) => { failing = value; }, close: async () => { await closeHandler?.(); } };
}
