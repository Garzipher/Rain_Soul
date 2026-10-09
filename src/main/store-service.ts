import { z } from 'zod';
import { writingDocumentSchema } from '../shared/document';
import { structureRequestSchema } from '../shared/structure-schema';
import { assetRequestSchema, assetQuerySchema } from '../shared/assets-schema';
import { knowledgeCopyRequestSchema } from '../shared/knowledge-scope';
import { manuscriptImportRequestSchema } from '../shared/manuscript-schema';
import { archiveManifestSchema } from '../shared/archive';
import { snapshotCreateRequestSchema, snapshotRestoreRequestSchema } from '../shared/snapshots';

type Transport = (command: string, payload: unknown) => Promise<unknown>;
const id = z.uuid();
const title = z.string().refine(value => value.trim().length > 0, '名称不能为空');
const mutation = { workId: id, expectedRevision: z.number().int().positive(), operationId: id };
const schemas = {
  listWorks: z.object({}).strict(),
  listDeletedWorks: z.object({}).strict(),
  createWork: z.object({ title }).strict(),
  importManuscript: manuscriptImportRequestSchema,
  freezeWork: z.object({ workId: id }).strict(),
  exportProject: z.object({ workId: id, expectedRevision: z.number().int().positive() }).strict(),
  importProject: z.object({ operationId: id, input: z.object({ manifest: archiveManifestSchema, database: z.instanceof(Uint8Array) }).strict() }).strict(),
  applyAiCandidate: z.object({ workId: id, operationId: id, candidate: z.unknown() }).strict(),
  approveAiKnowledge: z.object({ workId: id, operationId: id, candidate: z.unknown(), items: z.array(z.object({ body: z.string(), source: z.string(), categoryId: id.optional(), tagIds: z.array(id).max(100).optional() }).strict()).min(1).max(100) }).strict(),
  openWork: z.object({ id }).strict(),
  addChapter: z.object({ ...mutation, title, volumeId: id.nullable().optional() }).strict(),
  saveChapter: z.object({ ...mutation, chapterId: id, title, document: writingDocumentSchema }).strict(),
  manageStructure: structureRequestSchema,
  manageAssets: assetRequestSchema,
  searchWork: z.object({ workId: id, query: assetQuerySchema }).strict(),
  readKnowledgeScope: z.object({ scopeId: id.nullable() }).strict(),
  searchKnowledgeScope: z.object({ scopeId: id.nullable(), query: assetQuerySchema }).strict(),
  copyKnowledge: knowledgeCopyRequestSchema,
  listSnapshots: z.object({ workId: id }).strict(),
  previewSnapshot: z.object({ workId: id, snapshotId: id }).strict(),
  freezeSnapshot: z.object({ workId: id, snapshotId: id }).strict(),
  createSnapshot: snapshotCreateRequestSchema,
  restoreSnapshot: snapshotRestoreRequestSchema,
};
export type StoreCommand = keyof typeof schemas;
function readActionType(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('action' in value)) return null;
  const action = value.action;
  return action && typeof action === 'object' && 'type' in action && typeof action.type === 'string' ? action.type : null;
}
export class StoreService {
  private activeWork: string | null = null;
  private lastDeletion: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly transport: Transport) {}
  execute(command: string, payload: unknown): Promise<unknown> {
    const operation = this.queue.then(async () => {
      if (!Object.hasOwn(schemas, command)) throw new Error('未知存储命令');
      const parsed = schemas[command as StoreCommand].parse(payload);
      const actionType = readActionType(parsed);
      const restoringWork = actionType === 'restoreWork';
      const deletionReplay = actionType === 'deleteWork' && JSON.stringify(parsed) === this.lastDeletion;
      if ('workId' in parsed && parsed.workId !== this.activeWork && !restoringWork && !deletionReplay) throw new Error('仅允许修改当前作品');
      const result = await this.transport(command, parsed);
      if (command === 'openWork' || command === 'createWork' || command === 'importManuscript' || command === 'importProject') this.activeWork = (result as { id: string }).id;
      if ('workId' in parsed && actionType === 'deleteWork') {
        this.lastDeletion = JSON.stringify(parsed);
        if (result === null && parsed.workId === this.activeWork) this.activeWork = null;
      }
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async drain(): Promise<void> { await this.queue; }
}
