import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkRepository } from './repository';
import { ensureLearningWork } from './learning-seed';
import type { StructureRequest, WritingDocument } from '../../shared/contracts';
import type { AssetRequest, AssetQuery } from '../../shared/assets';

const directory = (workerData as { directory: string }).directory;
ensureLearningWork(join(directory, 'Projects'), JSON.parse(readFileSync(join(__dirname, 'learning-course.json'), 'utf8')));
const repository = new WorkRepository(directory);
parentPort?.on('message', ({ requestId, command, payload }: { requestId: string; command: string; payload: Record<string, unknown> }) => {
  try {
    let data: unknown;
    switch (command) {
      case 'listWorks': data = repository.listWorks(); break;
      case 'listDeletedWorks': data = repository.listDeletedWorks(); break;
      case 'manageStructure': data = repository.manageStructure(payload as unknown as StructureRequest); break;
      case 'manageAssets': data = repository.manageAssets(payload as unknown as AssetRequest); break;
      case 'searchWork': data = repository.searchWork(payload.workId as string, payload.query as AssetQuery); break;
      case 'createWork': data = repository.createWork(payload.title as string); break;
      case 'openWork': data = repository.openWork(payload.id as string); break;
      case 'addChapter': data = repository.addChapter(payload.workId as string, payload.title as string, payload.expectedRevision as number, payload.operationId as string, payload.volumeId as string | null | undefined); break;
      case 'saveChapter': data = repository.saveChapter(payload.workId as string, payload.chapterId as string, payload.title as string, payload.document as WritingDocument, payload.expectedRevision as number, payload.operationId as string); break;
      default: throw new Error('未知存储命令');
    }
    parentPort?.postMessage({ requestId, ok: true, data });
  } catch (error) {
    parentPort?.postMessage({ requestId, ok: false, message: error instanceof Error ? error.message : '本机存储失败' });
  }
});
parentPort?.on('close', () => repository.close());
