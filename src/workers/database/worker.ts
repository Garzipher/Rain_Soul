import { parentPort, workerData } from 'node:worker_threads';
import { WorkRepository } from './repository';
import type { WritingDocument } from '../../shared/contracts';

const repository = new WorkRepository((workerData as { directory: string }).directory);
parentPort?.on('message', ({ requestId, command, payload }: { requestId: string; command: string; payload: Record<string, unknown> }) => {
  try {
    let data: unknown;
    switch (command) {
      case 'listWorks': data = repository.listWorks(); break;
      case 'createWork': data = repository.createWork(payload.title as string); break;
      case 'openWork': data = repository.openWork(payload.id as string); break;
      case 'addChapter': data = repository.addChapter(payload.workId as string, payload.title as string, payload.expectedRevision as number, payload.operationId as string); break;
      case 'saveChapter': data = repository.saveChapter(payload.workId as string, payload.chapterId as string, payload.title as string, payload.document as WritingDocument, payload.expectedRevision as number, payload.operationId as string); break;
      default: throw new Error('未知存储命令');
    }
    parentPort?.postMessage({ requestId, ok: true, data });
  } catch (error) {
    parentPort?.postMessage({ requestId, ok: false, message: error instanceof Error ? error.message : '本机存储失败' });
  }
});
parentPort?.on('close', () => repository.close());
