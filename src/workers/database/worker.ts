import type { AiKnowledgeApproval } from '../../shared/ai-extraction';
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkRepository } from './repository';
import { errorCode } from '../../shared/operation-errors';
import { ensureLearningWork } from './learning-seed';
import type { StructureRequest, WritingDocument } from '../../shared/contracts';
import type { AssetRequest, AssetQuery } from '../../shared/assets';
import type { KnowledgeCopyRequest } from '../../shared/knowledge-scope';
import type { ManuscriptImportRequest } from '../../shared/manuscript-schema';
import type { ParsedProjectArchive } from '../../shared/archive';
import type { AiCandidate } from '../../shared/ai';
import type { SnapshotCreateRequest, SnapshotRestoreRequest } from '../../shared/snapshots';

const directory = (workerData as { directory: string }).directory;
ensureLearningWork(join(directory, 'Projects'), JSON.parse(readFileSync(join(__dirname, 'learning-course.json'), 'utf8')));
const repository = new WorkRepository(directory);
parentPort?.on('message', async ({ requestId, command, payload }: { requestId: string; command: string; payload: Record<string, unknown> }) => {
  try {
    let data: unknown;
    switch (command) {
      case 'listWorks': data = repository.listWorks(); break;
      case 'listDeletedWorks': data = repository.listDeletedWorks(); break;
      case 'manageStructure': data = repository.manageStructure(payload as unknown as StructureRequest); break;
      case 'manageAssets': data = repository.manageAssets(payload as unknown as AssetRequest); break;
      case 'searchWork': data = repository.searchWork(payload.workId as string, payload.query as AssetQuery); break;
      case 'readKnowledgeScope': data = repository.readKnowledgeScope(payload.scopeId as string | null); break;
      case 'searchKnowledgeScope': data = repository.searchKnowledgeScope(payload.scopeId as string | null, payload.query as AssetQuery); break;
      case 'copyKnowledge': data = repository.copyKnowledge(payload as unknown as KnowledgeCopyRequest); break;
      case 'listSnapshots': data = repository.listSnapshots(payload.workId as string); break;
      case 'previewSnapshot': data = repository.previewSnapshot(payload.workId as string, payload.snapshotId as string); break;
      case 'freezeSnapshot': data = repository.freezeSnapshot(payload.workId as string, payload.snapshotId as string); break;
      case 'createSnapshot': data = repository.createSnapshot(payload as unknown as SnapshotCreateRequest); break;
      case 'restoreSnapshot': data = repository.restoreSnapshot(payload as unknown as SnapshotRestoreRequest); break;
      case 'createWork': data = repository.createWork(payload.title as string); break;
      case 'importManuscript': data = repository.importManuscript(payload as unknown as ManuscriptImportRequest); break;
      case 'freezeWork': data = repository.openWork(payload.workId as string); break;
      case 'exportProject': data = await repository.exportProject(payload.workId as string, payload.expectedRevision as number); break;
      case 'importProject': {
        const input = payload.input as ParsedProjectArchive;
        data = repository.importProject({ manifest: input.manifest, database: Buffer.from(input.database) }, payload.operationId as string); break;
      }
      case 'applyAiCandidate': data = repository.applyAi(payload.candidate as AiCandidate, payload.operationId as string); break;
      case 'approveAiKnowledge': data = repository.approveKnowledge(payload.candidate as AiCandidate, payload.items as AiKnowledgeApproval[], payload.operationId as string); break;
      case 'openWork': data = repository.openWork(payload.id as string); break;
      case 'addChapter': data = repository.addChapter(payload.workId as string, payload.title as string, payload.expectedRevision as number, payload.operationId as string, payload.volumeId as string | null | undefined); break;
      case 'saveChapter': data = repository.saveChapter(payload.workId as string, payload.chapterId as string, payload.title as string, payload.document as WritingDocument, payload.expectedRevision as number, payload.operationId as string); break;
      default: throw new Error('未知存储命令');
    }
    parentPort?.postMessage({ requestId, ok: true, data });
  } catch (error) {
    parentPort?.postMessage({ requestId, ok: false, code: errorCode(error), message: error instanceof Error ? error.message : '本机存储失败' });
  }
});
parentPort?.on('close', () => repository.close());
