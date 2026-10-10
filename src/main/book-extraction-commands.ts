import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { z } from 'zod';
import { bookExtractionConfirmationSchema, type BookExtractionPreview } from '../shared/book-extraction';
import { manuscriptDraftSchema } from '../shared/manuscript-schema';
import { parseTxtManuscript } from './manuscript-text';
import { parseDocxManuscript } from './manuscript-docx';

const chooseSchema = z.object({ workId: z.uuid(), encoding: z.enum(['utf-8', 'gb18030']) }).strict();
const cancelSchema = z.object({ token: z.uuid() }).strict();
interface StoreAccess { execute(command: string, payload: unknown): Promise<unknown> }
interface Files { choose(): Promise<{ name: string; bytes: Buffer } | null> }

/** 冻结真实文件与段落；确认请求不能提供文件路径、原文或伪造出处。 */
export class BookExtractionCommands {
  private preview: BookExtractionPreview | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: StoreAccess, private readonly files: Files) {}
  /** AI仅能读取有效预览的副本，不能由渲染层提供原文、路径或出处。 */
  getPreview(workId: string, token: string): BookExtractionPreview {
    if (!this.preview || this.preview.workId !== workId || this.preview.token !== token) throw new Error('拆书预览已失效，请重新选择文件。');
    return structuredClone(this.preview);
  }
  accepts(command: string) { return ['chooseBookExtraction', 'confirmBookExtraction', 'cancelBookExtraction'].includes(command); }
  execute(command: string, payload: unknown): Promise<unknown> {
    const operation = this.queue.then(async () => {
      if (!this.accepts(command)) throw new Error('未知拆书命令。');
      if (command === 'cancelBookExtraction') {
        const { token } = cancelSchema.parse(payload);
        if (this.preview?.token === token) this.preview = null;
        return;
      }
      if (command === 'chooseBookExtraction') {
        const { workId, encoding } = chooseSchema.parse(payload);
        const file = await this.files.choose(); if (!file) return null;
        this.preview = null;
        const filename = basename(file.name), extension = extname(filename).toLowerCase();
        if (!['.txt', '.docx'].includes(extension)) throw new Error('拆书仅支持 TXT 和 DOCX。');
        const options = { title: basename(filename, extension), encoding };
        const draft = extension === '.txt' ? parseTxtManuscript(file.bytes, options) : await parseDocxManuscript(file.bytes, options);
        manuscriptDraftSchema.parse(draft);
        const segments = draft.chapters.flatMap((chapter, chapterIndex) => chapter.paragraphs.map((text, paragraphIndex) => ({
          id: randomUUID(), chapterTitle: chapter.title, chapterIndex: chapterIndex + 1, paragraphIndex: paragraphIndex + 1, text,
        }))).filter(segment => segment.text.trim());
        if (!segments.length) throw new Error('文件没有可摘选的正文段落。');
        this.preview = { token: randomUUID(), workId, filename, fileHash: createHash('sha256').update(file.bytes).digest('hex'), format: draft.format, warnings: draft.warnings, segments };
        return structuredClone(this.preview);
      }
      const request = bookExtractionConfirmationSchema.parse(payload), preview = this.preview;
      if (!preview || request.token !== preview.token || request.workId !== preview.workId) throw new Error('拆书预览已失效，请重新选择文件。');
      const items = request.items.map(item => {
        const segment = preview.segments.find(value => value.id === item.segmentId);
        if (!segment) throw new Error('摘选段落已失效，不能写入知识库。');
        const source = `《${request.sourceTitle}》${request.sourceAuthor ? `／作者：${request.sourceAuthor}` : ''}；${preview.filename}；第${segment.chapterIndex}章 ${segment.chapterTitle} 第${segment.paragraphIndex}段；文件 SHA-256：${preview.fileHash}；段落 SHA-256：${createHash('sha256').update(segment.text).digest('hex')}`;
        return { body: item.body, categoryId: item.categoryId, tagIds: item.tagIds, source };
      });
      return this.store.execute('importBookExtraction', { workId: request.workId, expectedRevision: request.expectedRevision, operationId: request.operationId, items });
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async drain() { await this.queue; }
}
