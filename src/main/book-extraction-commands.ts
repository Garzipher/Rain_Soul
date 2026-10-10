import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { z } from 'zod';
import { bookExtractionConfirmationSchema, type BookExtractionPreview } from '../shared/book-extraction';
import { manuscriptDraftSchema } from '../shared/manuscript-schema';
import { parseTxtManuscript } from './manuscript-text';
import { parseDocxManuscript } from './manuscript-docx';
import { WebExtractionCommands, sourcePreview, type WebExtractionDependencies } from './web-extraction-commands';
import { freezeSource } from './freeze-source';
import type { ExtractionDraftCoordinator } from './extraction-draft-coordinator';
import { extractionDraftSchema } from '../shared/extraction-draft';

const chooseSchema = z.object({ workId: z.uuid(), encoding: z.enum(['utf-8', 'gb18030']) }).strict();
const cancelSchema = z.object({ token: z.uuid() }).strict();
interface StoreAccess { execute(command: string, payload: unknown): Promise<unknown> }
interface Files { choose(): Promise<{ name: string; bytes: Buffer } | null> }

/** 冻结真实文件与段落；确认请求不能提供文件路径、原文或伪造出处。 */
export class BookExtractionCommands {
  private preview: BookExtractionPreview | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private previewGeneration = 0;
  private readonly web: WebExtractionCommands;
  constructor(private readonly store: StoreAccess, private readonly files: Files, webDependencies?: WebExtractionDependencies, private readonly drafts?: ExtractionDraftCoordinator) {
    this.web = new WebExtractionCommands(preview => { this.previewGeneration++; this.preview = preview; }, webDependencies);
  }
  /** AI仅能读取有效预览的副本，不能由渲染层提供原文、路径或出处。 */
  getPreview(workId: string, token: string): BookExtractionPreview {
    if (!this.preview || this.preview.workId !== workId || this.preview.token !== token) throw new Error('拆书预览已失效，请重新选择文件。');
    return structuredClone(this.preview);
  }
  accepts(command: string) { return this.web.accepts(command) || ['chooseBookExtraction', 'confirmBookExtraction', 'cancelBookExtraction', 'readExtractionDraft', 'saveExtractionReview', 'discardExtractionDraft'].includes(command); }
  execute(command: string, payload: unknown): Promise<unknown> {
    if (this.web.accepts(command)) return this.web.execute(command, payload).then(async result => {
      if (result && this.drafts) {
        const preview = result as BookExtractionPreview;
        await this.drafts.begin(preview, () => this.preview?.token === preview.token);
        if (this.preview?.token !== preview.token) throw new Error('素材预览已被替换。');
      }
      return result;
    });
    const operation = this.queue.then(async () => {
      if (!this.accepts(command)) throw new Error('未知拆书命令。');
      if (command === 'discardExtractionDraft') {
        const { workId, token } = z.object({ workId: z.uuid(), token: z.uuid() }).strict().parse(payload);
        this.getPreview(workId, token); await this.store.execute('freezeWork', { workId });
        const draft = await this.drafts?.read(workId);
        if (draft && draft.previewToken !== token) throw new Error('本机拆书任务已被替换。');
        if (draft) await this.drafts!.discard(workId, draft.taskId);
        this.web.reset(); return;
      }
      if (command === 'saveExtractionReview') {
        const request = z.object({ workId: z.uuid(), token: z.uuid(), reviews: extractionDraftSchema.shape.reviews }).strict().parse(payload);
        this.getPreview(request.workId, request.token);
        await this.store.execute('freezeWork', { workId: request.workId });
        if (!this.drafts) throw new Error('本机拆文草稿未接入。');
        return this.drafts.saveReviews(request.workId, request.token, request.reviews);
      }
      if (command === 'readExtractionDraft') {
        const { workId } = z.object({ workId: z.uuid() }).strict().parse(payload);
        const generation = this.previewGeneration;
        await this.store.execute('freezeWork', { workId });
        if (!this.drafts) return null;
        const recovered = await this.drafts.recover(workId);
        if (!recovered) return null;
        if (generation !== this.previewGeneration) throw new Error('素材预览已被新任务替换。');
        this.web.reset();
        const preview = { ...sourcePreview(workId, recovered.draft.source), token: recovered.draft.previewToken };
        this.preview = preview;
        return { ...recovered, preview: structuredClone(preview) };
      }
      if (command === 'cancelBookExtraction') {
        const { token } = cancelSchema.parse(payload);
        if (this.preview?.token === token) { this.previewGeneration++; this.preview = null; }
        return;
      }
      if (command === 'chooseBookExtraction') {
        const { workId, encoding } = chooseSchema.parse(payload);
        this.web.reset();
        const generation = this.previewGeneration;
        const file = await this.files.choose();
        if (generation !== this.previewGeneration) throw new Error('文件预览已失效，被新的素材来源替换。');
        if (!file) return null;
        this.preview = null;
        const filename = basename(file.name), extension = extname(filename).toLowerCase();
        if (!['.txt', '.docx'].includes(extension)) throw new Error('拆书仅支持 TXT 和 DOCX。');
        const options = { title: basename(filename, extension), encoding };
        const draft = extension === '.txt' ? parseTxtManuscript(file.bytes, options) : await parseDocxManuscript(file.bytes, options);
        if (generation !== this.previewGeneration) throw new Error('文件预览已失效，被新的素材来源替换。');
        manuscriptDraftSchema.parse(draft);
        const segments = draft.chapters.flatMap((chapter, chapterIndex) => chapter.paragraphs.map((text, paragraphIndex) => ({
          id: randomUUID(), chapterTitle: chapter.title, chapterIndex: chapterIndex + 1, paragraphIndex: paragraphIndex + 1, text,
        }))).filter(segment => segment.text.trim());
        if (!segments.length) throw new Error('文件没有可摘选的正文段落。');
        const source = freezeSource({ kind: draft.format, title: options.title, rawBytes: file.bytes,
          segments: segments.map(segment => ({ text: segment.text, chapterTitle: segment.chapterTitle, chapterIndex: segment.chapterIndex, paragraphIndex: segment.paragraphIndex })) });
        const frozenSegments = segments.map((segment, index) => ({ ...segment, id: source.segments[index].id, text: source.segments[index].text }));
        this.preview = { token: randomUUID(), workId, filename, fileHash: source.rawHash, format: draft.format, warnings: draft.warnings, segments: frozenSegments, source };
        const preview = this.preview;
        if (this.drafts) await this.drafts.begin(preview, () => this.preview?.token === preview.token);
        if (generation !== this.previewGeneration || this.preview?.token !== preview.token) throw new Error('素材预览已被新任务替换。');
        return structuredClone(preview);
      }
      const request = bookExtractionConfirmationSchema.parse(payload), preview = this.preview;
      if (!preview || request.token !== preview.token || request.workId !== preview.workId) throw new Error('拆书预览已失效，请重新选择文件。');
      const items = request.items.map(item => {
        const segment = preview.segments.find(value => value.id === item.segmentId);
        if (!segment) throw new Error('摘选段落已失效，不能写入知识库。');
        const web = preview.source?.kind === 'web' ? `；原始网址：${preview.source.originalUrl}；最终网址：${preview.source.finalUrl}；获取时间：${preview.source.fetchedAt}` : '';
        const location = segment.locationUnknown ? `${segment.chapterTitle}（章序未知） 原文第${segment.paragraphIndex}段` : `第${segment.chapterIndex}章 ${segment.chapterTitle} 第${segment.paragraphIndex}段`;
        const source = `《${request.sourceTitle}》${request.sourceAuthor ? `／作者：${request.sourceAuthor}` : ''}；${preview.filename}；${location}；文件 SHA-256：${preview.fileHash}；段落 SHA-256：${createHash('sha256').update(segment.text).digest('hex')}${web}`;
        return { body: item.body, categoryId: item.categoryId, tagIds: item.tagIds, source, segmentId: item.segmentId, ...(item.annotation ? { annotation: item.annotation } : {}) };
      });
      const commit = { workId: request.workId, expectedRevision: request.expectedRevision, operationId: request.operationId, sourceDocument: preview.source, items };
      return this.drafts ? this.drafts.commit(commit) : this.store.execute('importBookExtraction', commit);
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async drain() { await this.web.drain(); await this.queue; }
}
