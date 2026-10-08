import { z } from 'zod';
import { writingDocumentSchema } from '../shared/document';

type Transport = (command: string, payload: unknown) => Promise<unknown>;
const id = z.uuid();
const title = z.string().refine(value => value.trim().length > 0, '名称不能为空');
const mutation = { workId: id, expectedRevision: z.number().int().positive(), operationId: id };
const schemas = {
  listWorks: z.object({}).strict(),
  createWork: z.object({ title }).strict(),
  openWork: z.object({ id }).strict(),
  addChapter: z.object({ ...mutation, title }).strict(),
  saveChapter: z.object({ ...mutation, chapterId: id, title, document: writingDocumentSchema }).strict(),
};
export type StoreCommand = keyof typeof schemas;
export class StoreService {
  private activeWork: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly transport: Transport) {}
  execute(command: string, payload: unknown): Promise<unknown> {
    const operation = this.queue.then(async () => {
      if (!Object.hasOwn(schemas, command)) throw new Error('未知存储命令');
      const parsed = schemas[command as StoreCommand].parse(payload);
      if ('workId' in parsed && parsed.workId !== this.activeWork) throw new Error('仅允许修改当前作品');
      const result = await this.transport(command, parsed);
      if (command === 'openWork' || command === 'createWork') this.activeWork = (result as { id: string }).id;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async drain(): Promise<void> { await this.queue; }
}
