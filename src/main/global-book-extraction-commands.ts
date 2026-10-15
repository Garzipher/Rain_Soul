import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { z } from 'zod';
import { globalBookExtractionConfirmationSchema, globalExtractionMetadataSchema, globalExtractionDraftSchema, type GlobalExtractionDraft, type GlobalExtractionPreview } from '../shared/global-book-extraction';
import type { GlobalKnowledgePage, GlobalExtractionCommit } from '../shared/global-knowledge';
import { parseTxtManuscript } from './manuscript-text';
import { parseDocxManuscript } from './manuscript-docx';
import { freezeSource } from './freeze-source';
import { sourcePreview, WebExtractionCommands, type WebExtractionDependencies } from './web-extraction-commands';
import { GlobalExtractionDraftStore } from './global-extraction-draft-store';

interface Files { choose(): Promise<{ name: string; bytes: Buffer } | null> }
interface GlobalClient { request(command: string, payload: unknown): Promise<unknown> }
const tokenSchema = z.object({ token: z.uuid() }).strict();
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
/** 独立全局目标的可信预览、逐字审核与幂等入库。 */
export class GlobalBookExtractionCommands {
  private preview: GlobalExtractionPreview | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly web: WebExtractionCommands<GlobalExtractionPreview>;
  private readonly drafts: GlobalExtractionDraftStore;
  constructor(private readonly files: Files, private readonly global: GlobalClient, directory: string, dependencies?: WebExtractionDependencies) {
    this.drafts = new GlobalExtractionDraftStore(directory);
    this.web = new WebExtractionCommands(preview => { this.preview = preview; }, dependencies, { kind: 'global' });
  }
  accepts(command: string) { return ['chooseGlobalBookExtraction', 'fetchGlobalWebExtraction', 'previewGlobalPastedExtraction',
    'confirmGlobalBookExtraction', 'readGlobalExtractionDraft', 'saveGlobalExtractionReview', 'discardGlobalExtractionDraft',
    'cancelGlobalBookExtraction', 'cancelGlobalWebExtraction'].includes(command); }
  execute(command: string, payload: unknown): Promise<unknown> {
    if (command === 'cancelGlobalWebExtraction') return this.web.execute('cancelWebExtraction', payload);
    const operation = this.queue.then(() => this.run(command, payload));
    this.queue = operation.catch(() => {}); return operation;
  }
  private async begin(preview: GlobalExtractionPreview) {
    await this.drafts.save({ schemaVersion: 1, target: { kind: 'global' }, taskId: randomUUID(), previewToken: preview.token,
      source: preview.source!, batches: [], reviews: [], committing: null });
    this.preview = preview; return structuredClone(preview);
  }
  private valid(token: string) {
    if (!this.preview || this.preview.token !== token || this.preview.target.kind !== 'global') throw new Error('全局拆书预览已失效。');
    return this.preview;
  }
  private async settle(draft: GlobalExtractionDraft): Promise<GlobalKnowledgePage> {
    const request = draft.committing!, page = await this.global.request('ingestExtraction', request) as GlobalKnowledgePage;
    const submitted = new Set(request.items.map(item => item.segmentId));
    const reviews = [...draft.reviews.filter(item => !submitted.has(item.segmentId)), ...request.items.map(item => ({
      segmentId: item.segmentId, body: item.body, categoryId: item.categoryId, tagIds: item.tagIds,
      status: 'committed' as const, ...(item.annotation ? { annotation: item.annotation } : {}),
    }))];
    await this.drafts.save({ ...draft, reviews, committing: null }); return page;
  }
  private async run(command: string, payload: unknown): Promise<unknown> {
    if (!this.accepts(command)) throw new Error('未知全局拆书命令。');
    const draft = await this.drafts.read();
    if (command === 'readGlobalExtractionDraft') {
      z.undefined().parse(payload);
      if (!draft) return null;
      const page = draft.committing ? await this.settle(draft) : undefined;
      const current = (await this.drafts.read())!;
      this.preview = { ...sourcePreview({ kind: 'global' }, current.source), token: current.previewToken };
      return { draft: current, preview: structuredClone(this.preview), ...(page ? { page } : {}) };
    }
    if (command === 'cancelGlobalBookExtraction') { const { token } = tokenSchema.parse(payload); this.valid(token); this.web.reset(); this.preview = null; return; }
    if (draft?.committing) throw new Error('上一批全局入库回执待核对，请先恢复草稿。');
    if (command === 'saveGlobalExtractionReview' || command === 'discardGlobalExtractionDraft') {
      const { token } = tokenSchema.parse({ token: (payload as { token?: unknown })?.token });
      this.valid(token);
      if (!draft || draft.previewToken !== token) throw new Error('全局拆书草稿已被替换。');
      if (command === 'saveGlobalExtractionReview') {
        const request = tokenSchema.extend({ reviews: globalExtractionDraftSchema.shape.reviews, metadata: globalExtractionMetadataSchema.optional() }).strict().parse(payload);
        const committed = draft.reviews.filter(item => item.status === 'committed');
        if (request.reviews.some(item => item.status === 'committed' && !committed.some(prior => JSON.stringify(prior) === JSON.stringify(item))))
          throw new Error('不能伪造已入库状态。');
        await this.drafts.save({ ...draft, ...(request.metadata ? { metadata: request.metadata } : {}), reviews: [...committed, ...request.reviews.filter(item => !committed.some(prior => prior.segmentId === item.segmentId))] });
      } else { tokenSchema.parse(payload); await this.drafts.discard(); this.web.reset(); this.preview = null; }
      return;
    }
    if (command === 'fetchGlobalWebExtraction' || command === 'previewGlobalPastedExtraction') {
      if (draft) throw new Error('请先保存并返回，或明确更换现有全局拆书素材。');
      const preview = await this.web.execute(command === 'fetchGlobalWebExtraction' ? 'fetchWebExtraction' : 'previewPastedExtraction', payload) as GlobalExtractionPreview;
      return this.begin(preview);
    }
    if (command === 'chooseGlobalBookExtraction') {
      if (draft) throw new Error('请先保存并返回，或明确更换现有全局拆书素材。');
      const { encoding } = z.object({ encoding: z.enum(['utf-8', 'gb18030']) }).strict().parse(payload);
      const file = await this.files.choose(); if (!file) return null;
      const filename = basename(file.name), extension = extname(filename).toLowerCase(), options = { title: basename(filename, extension), encoding };
      if (!['.txt', '.docx'].includes(extension)) throw new Error('拆书仅支持 TXT 和 DOCX。');
      const manuscript = extension === '.txt' ? parseTxtManuscript(file.bytes, options) : await parseDocxManuscript(file.bytes, options);
      const source = freezeSource({ kind: manuscript.format, title: options.title, rawBytes: file.bytes,
        segments: manuscript.chapters.flatMap((chapter, index) => chapter.paragraphs.map((text, paragraph) => ({ text,
          chapterTitle: chapter.title, chapterIndex: index + 1, paragraphIndex: paragraph + 1 }))) });
      this.web.reset(); return this.begin({ ...sourcePreview({ kind: 'global' }, source), filename, warnings: manuscript.warnings });
    }
    const request = globalBookExtractionConfirmationSchema.parse(payload), preview = this.valid(request.token);
    if (!draft || draft.previewToken !== request.token) throw new Error('全局拆书草稿已失效。');
    if (request.items.some(item => draft.reviews.some(review => review.segmentId === item.segmentId && review.status === 'committed')))
      throw new Error('已经入库的段落不能再次提交。');
    const segments = request.items.map((item, index) => {
      const original = preview.source!.segments.find(segment => segment.id === item.segmentId), text = item.body.trim();
      if (!original || !original.text.includes(text)) throw new Error('摘录必须逐字存在于所选原文，不得修改成其他句子。');
      return { ...original, ordinal: index + 1, text, textHash: sha(text) };
    });
    const prior = draft.reviews.filter(item => item.status === 'committed');
    if (request.rightsBasis === 'public-excerpt' && (segments.length + prior.length > 3
      || [...segments, ...prior].reduce((size, segment) => size + Array.from('text' in segment ? segment.text : segment.body).length, 0) > 300))
      throw new Error('同次公开阅读来源最多三条短摘录，累计不超过三百字。');
    const sourceDocument = { ...preview.source!, segments, bodyHash: sha(JSON.stringify(segments.map(segment => segment.text))) };
    const commit: GlobalExtractionCommit = { operationId: request.operationId, expectedRevision: request.expectedRevision, sourceDocument,
      metadata: { author: request.sourceAuthor, workTitle: request.sourceTitle, chapter: request.chapter,
        rightsBasis: request.rightsBasis, capturedAt: preview.source!.fetchedAt ?? new Date().toISOString(), metrics: [], verificationStatus: 'verified' },
      items: request.items.map((item, index) => ({ ...item, body: segments[index].text, source:
        `《${request.sourceTitle}》／${request.sourceAuthor || '作者未填写'}；${request.chapter || segments[index].chapterTitle}；原文第${segments[index].paragraphIndex ?? segments[index].ordinal}段；原始 SHA-256：${preview.fileHash}${sourceDocument.originalUrl ? `；${sourceDocument.originalUrl}` : ''}` })) };
    const pending = { ...draft, committing: commit };
    await this.drafts.save(pending); return this.settle(pending);
  }
  /** 主进程内部 AI 协调入口，读取和批次落盘与手工审核共用串行队列。 */
  async getAiContext(token: string) {
    await this.queue;
    const preview = this.valid(token), draft = await this.drafts.read();
    if (!draft || draft.previewToken !== token || draft.committing) throw new Error('全局拆书草稿不可分析。');
    return { preview: structuredClone(preview), draft };
  }
  recordAiBatch(token: string, batch: GlobalExtractionDraft['batches'][number]): Promise<void> {
    const operation = this.queue.then(async () => {
      this.valid(token); const draft = await this.drafts.read();
      if (!draft || draft.previewToken !== token || draft.committing) throw new Error('全局拆书任务已替换，原结果不能写入新任务。');
      await this.drafts.save({ ...draft, batches: [...draft.batches.filter(item => item.requestHash !== batch.requestHash), batch] });
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async drain() { await this.web.drain(); await this.queue; }
}
