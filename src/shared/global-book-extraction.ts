import { z } from 'zod';
import type { BookExtractionPreview } from './book-extraction';
import type { GlobalKnowledgePage } from './global-knowledge';
import { bookExtractionConfirmationSchema } from './book-extraction';
import { extractionDraftSchema } from './extraction-draft';
import { globalExtractionCommitSchema, globalSourceMetadataSchema } from './global-knowledge-schema';
import { frozenSourceDocumentSchema } from './source-document';

export type GlobalExtractionPreview = Omit<BookExtractionPreview, 'workId'> & { target: { kind: 'global' } };
export const globalBookExtractionConfirmationSchema = bookExtractionConfirmationSchema.omit({ workId: true }).extend({
  rightsBasis: globalSourceMetadataSchema.shape.rightsBasis,
  chapter: z.string().trim().max(200),
}).strict();
export type GlobalBookExtractionConfirmation = z.infer<typeof globalBookExtractionConfirmationSchema>;
export const globalWebImportSchema = z.object({ operationId: z.uuid(), url: z.string().min(1).max(2048),
  mode: z.enum(['static', 'restricted-browser']).default('static'),
}).strict();
export const globalPasteImportSchema = z.object({ title: z.string().trim().min(1).max(200), text: z.string().min(1)
  .refine(value => Array.from(value).length <= 200000) }).strict();
export const globalExtractionDraftSchema = z.object({
  schemaVersion: z.literal(1), target: z.object({ kind: z.literal('global') }).strict(), taskId: z.uuid(), previewToken: z.uuid(),
  source: frozenSourceDocumentSchema, batches: extractionDraftSchema.shape.batches.default([]), reviews: extractionDraftSchema.shape.reviews,
  committing: globalExtractionCommitSchema.nullable(),
}).strict().superRefine((draft, ctx) => {
  if (new Set(draft.reviews.map(item => item.segmentId)).size !== draft.reviews.length
    || draft.reviews.some(item => !draft.source.segments.some(segment => segment.id === item.segmentId
      && (!['approved', 'committed'].includes(item.status) || segment.text.includes(item.body.trim()) && !!item.body.trim()))))
    ctx.addIssue({ code: 'custom', message: '审核摘录必须逐字属于本次来源，且段落身份唯一' });
  const segments = new Map(draft.source.segments.map(segment => [segment.id, segment]));
  if (new Set(draft.batches.map(batch => batch.id)).size !== draft.batches.length
    || new Set(draft.batches.map(batch => batch.requestHash)).size !== draft.batches.length
    || draft.batches.some(batch => batch.segmentIds.some(id => !segments.has(id))
      || new Set(batch.suggestions.map(item => item.segmentId)).size !== batch.suggestions.length
      || batch.suggestions.some(item => !batch.segmentIds.includes(item.segmentId) || !segments.get(item.segmentId)?.text.includes(item.excerpt)
        || !batch.categoryIds.includes(item.categoryId) || item.tagIds.some(id => !batch.tagIds.includes(id)))))
    ctx.addIssue({ code: 'custom', message: '全局 AI 批次必须绑定冻结原文和真实分类标签' });
  const pending = draft.committing;
  if (pending) {
    const source = pending.sourceDocument;
    const identity = ['id', 'kind', 'title', 'rawHash', 'originalUrl', 'finalUrl', 'fetchedAt', 'capture'] as const;
    if (identity.some(key => JSON.stringify(source[key]) !== JSON.stringify(draft.source[key]))
      || source.segments.length !== pending.items.length
      || source.segments.some(segment => {
        const original = draft.source.segments.find(item => item.id === segment.id);
        const item = pending.items.find(item => item.segmentId === segment.id);
        return !original || !item || !original.text.includes(segment.text) || item.body !== segment.text
          || original.chapterTitle !== segment.chapterTitle || original.chapterIndex !== segment.chapterIndex
          || original.paragraphIndex !== segment.paragraphIndex;
      })) ctx.addIssue({ code: 'custom', message: '待核对入库必须来自同一可信原文及已选短摘录' });
  }
});
export type GlobalExtractionDraft = z.infer<typeof globalExtractionDraftSchema>;
export interface GlobalExtractionRecovery { draft: GlobalExtractionDraft; preview: GlobalExtractionPreview; page?: GlobalKnowledgePage }
export interface GlobalExtractionApi {
  chooseGlobalBookExtraction(encoding: 'utf-8' | 'gb18030'): Promise<GlobalExtractionPreview | null>;
  fetchGlobalWebExtraction(request: z.input<typeof globalWebImportSchema>): Promise<GlobalExtractionPreview>;
  previewGlobalPastedExtraction(request: z.infer<typeof globalPasteImportSchema>): Promise<GlobalExtractionPreview>;
  confirmGlobalBookExtraction(request: GlobalBookExtractionConfirmation): Promise<GlobalKnowledgePage>;
  readGlobalExtractionDraft(): Promise<GlobalExtractionRecovery | null>;
  saveGlobalExtractionReview(request: { token: string; reviews: GlobalExtractionDraft['reviews'] }): Promise<void>;
  discardGlobalExtractionDraft(token: string): Promise<void>;
  cancelGlobalBookExtraction(token: string): Promise<void>;
  cancelGlobalWebExtraction(operationId: string): Promise<void>;
}
