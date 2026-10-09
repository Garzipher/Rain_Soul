import { z } from 'zod';
import { extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkDetail } from '../shared/contracts';
import type { ManuscriptDraft, ExportManuscript } from '../shared/manuscript';
import { manuscriptDraftSchema } from '../shared/manuscript-schema';
import { parseTxtManuscript } from './manuscript-text';
import { parseDocxManuscript } from './manuscript-docx';
import { exportDocxManuscript, exportTxtManuscript } from './manuscript-export';

const schemas = {
  chooseManuscript: z.object({ encoding: z.enum(['utf-8', 'gb18030']) }).strict(),
  confirmManuscript: z.object({ token: z.uuid(), operationId: z.uuid(), draft: manuscriptDraftSchema }).strict(),
  exportManuscript: z.object({ workId: z.uuid(), format: z.enum(['txt', 'docx']), snapshotId: z.uuid().optional() }).strict(),
};
interface FileAccess { choose: () => Promise<{ name: string; bytes: Buffer } | null>; save: (name: string, bytes: Buffer) => Promise<boolean> }
interface StoreAccess { execute: (command: string, payload: unknown) => Promise<unknown> }

export function freezeExport(work: WorkDetail): ExportManuscript {
  return structuredClone({ title: work.title, revision: work.revision,
    volumes: work.volumes.map(volume => ({ title: volume.title, chapters: work.chapters.filter(chapter => chapter.volumeId === volume.id) })),
    unvolumedChapters: work.chapters.filter(chapter => chapter.volumeId === null),
    knowledge: work.assets?.knowledge ?? [], foreshadows: work.assets?.foreshadows ?? [], evidence: work.assets?.evidence ?? [],
  });
}

/** 文件路径仅存在于主进程；渲染层拿到受限内容预览，不拥有任意文件读写能力。 */
export class ManuscriptCommands {
  private preview: { token: string; format: ManuscriptDraft['format']; encoding: string | null } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: StoreAccess, private readonly files: FileAccess) {}
  accepts(command: string) { return Object.hasOwn(schemas, command); }
  execute(command: string, payload: unknown): Promise<unknown> {
    const operation = this.queue.then(async () => {
      if (!this.accepts(command)) throw new Error('未知手稿命令');
      if (command === 'chooseManuscript') {
        const { encoding } = schemas.chooseManuscript.parse(payload);
        const file = await this.files.choose(); if (!file) return null;
        this.preview = null;
        const extension = extname(file.name).toLowerCase(), title = basename(file.name, extname(file.name));
        if (!['.txt', '.docx'].includes(extension)) throw new Error('手稿仅支持 TXT 和 DOCX。');
        const draft = extension === '.txt' ? parseTxtManuscript(file.bytes, { title, encoding }) : await parseDocxManuscript(file.bytes, { title });
        manuscriptDraftSchema.parse(draft);
        const token = randomUUID(); this.preview = { token, format: draft.format, encoding: draft.encoding };
        return { token, draft };
      }
      if (command === 'confirmManuscript') {
        const request = schemas.confirmManuscript.parse(payload);
        if (request.token !== this.preview?.token || request.draft.format !== this.preview.format || request.draft.encoding !== this.preview.encoding) throw new Error('导入预览已失效，请重新选择手稿。');
        return this.store.execute('importManuscript', { operationId: request.operationId, draft: request.draft });
      }
      const request = schemas.exportManuscript.parse(payload);
      const frozen = request.snapshotId
        ? await this.store.execute('freezeSnapshot', { workId: request.workId, snapshotId: request.snapshotId }) as ExportManuscript
        : freezeExport(await this.store.execute('freezeWork', { workId: request.workId }) as WorkDetail);
      const bytes = request.format === 'txt' ? exportTxtManuscript(frozen) : await exportDocxManuscript(frozen);
      const name = `${frozen.title}${request.snapshotId ? `—快照版本${frozen.revision}` : ''}`;
      return this.files.save(`${name.replace(/[<>:"/\\|?*]/g, '_')}.${request.format}`, bytes);
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async drain() { await this.queue; }
}
