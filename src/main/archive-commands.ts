import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { WorkDetail } from '../shared/contracts';
import type { ParsedProjectArchive } from '../shared/archive';
import { createProjectArchive, parseProjectArchive } from './project-archive';
const schemas = {
  chooseProjectArchive: z.object({}).strict(),
  confirmProjectArchive: z.object({ token: z.uuid(), operationId: z.uuid() }).strict(),
  exportProjectArchive: z.object({ workId: z.uuid() }).strict(),
};
export class ArchiveCommands {
  private preview: { token: string; input: ParsedProjectArchive } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: { execute: (command: string, payload: unknown) => Promise<unknown> }, private readonly files: { choose: () => Promise<{ name: string; bytes: Buffer } | null>; save: (name: string, bytes: Buffer) => Promise<boolean> }) {}
  accepts(command: string) { return Object.hasOwn(schemas, command); }
  execute(command: string, payload: unknown): Promise<unknown> {
    const operation = this.queue.then(async () => {
      if (!this.accepts(command)) throw new Error('未知归档命令。');
      if (command === 'chooseProjectArchive') {
        schemas.chooseProjectArchive.parse(payload);
        const file = await this.files.choose(); if (!file) return null;
        this.preview = null;
        if (!file.name.toLowerCase().endsWith('.rainsoul')) throw new Error('请选择 .rainsoul 项目归档。');
        const input = await parseProjectArchive(file.bytes), token = randomUUID(); this.preview = { token, input };
        return { token, filename: file.name, schemaVersion: input.manifest.schemaVersion };
      }
      if (command === 'confirmProjectArchive') {
        const request = schemas.confirmProjectArchive.parse(payload);
        if (request.token !== this.preview?.token) throw new Error('归档预览已失效，请重新选择文件。');
        return this.store.execute('importProject', { operationId: request.operationId, input: this.preview.input });
      }
      const request = schemas.exportProjectArchive.parse(payload);
      const work = await this.store.execute('freezeWork', request) as WorkDetail;
      const database = Buffer.from(await this.store.execute('exportProject', { workId: work.id, expectedRevision: work.revision }) as Uint8Array);
      const bytes = await createProjectArchive(database, { projectId: work.id, schemaVersion: 6 });
      return this.files.save(`${work.title.replace(/[<>:"/\\|?*]/g, '_')}.rainsoul`, bytes);
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async drain() { await this.queue; }
}
