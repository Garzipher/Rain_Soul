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
    if (command === 'listDeletedWorks') return repository.listDeletedWorks();
    if (command === 'createWork') return repository.createWork(input.title as string);
    if (command === 'openWork') return repository.openWork(input.id as string);
    if (command === 'manageStructure') return repository.manageStructure(input as unknown as Parameters<WorkRepository['manageStructure']>[0]);
    if (command === 'addChapter') return repository.addChapter(input.workId as string, input.title as string, input.expectedRevision as number, input.operationId as string, input.volumeId as string | null | undefined);
    if (command === 'saveChapter') {
      if (failing) throw new Error('磁盘空间不足');
      return repository.saveChapter(input.workId as string, input.chapterId as string, input.title as string, input.document as Parameters<WorkRepository['saveChapter']>[3], input.expectedRevision as number, input.operationId as string);
    }
    throw new Error('未支持的测试命令');
  });
  function remember(detail: WorkDetail) { works.set(detail.id, structuredClone(detail)); return detail; }
  const api: DesktopApi = {
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
