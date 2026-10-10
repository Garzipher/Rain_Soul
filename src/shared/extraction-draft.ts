import { z } from 'zod';
import { frozenSourceDocumentSchema } from './source-document';
import { bookExtractionCommitSchema } from './book-extraction';
import { learningAnnotationPayloadSchema } from './source-assets';
import type { BookExtractionPreview } from './book-extraction';
import type { WorkDetail } from './contracts';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ids = z.array(z.uuid()).max(1000).refine(values => new Set(values).size === values.length);
const suggestion = learningAnnotationPayloadSchema.extend({ segmentId: z.uuid(), excerpt: z.string().min(1).max(20000), categoryId: z.uuid(), tagIds: ids }).strict();
export const extractionDraftSchema = z.object({
  schemaVersion: z.literal(1), taskId: z.uuid(), workId: z.uuid(), previewToken: z.uuid(), source: frozenSourceDocumentSchema,
  batches: z.array(z.object({ id: z.uuid(), requestHash: hash, segmentIds: ids.refine(values => values.length > 0 && values.length <= 20),
    status: z.enum(['running', 'ready', 'cancelled', 'failed']), categoryIds: ids, tagIds: ids,
    suggestions: z.array(suggestion).max(20), rawText: z.string().max(128000).optional(),
    validationError: z.string().min(1).max(4000).optional(), dictionaryHash: hash.optional(),
  }).strict()).max(100),
  reviews: z.array(z.object({ segmentId: z.uuid(), body: z.string().max(20000), categoryId: z.uuid(), tagIds: ids,
    status: z.enum(['pending', 'approved', 'rejected', 'committed']), annotation: learningAnnotationPayloadSchema.optional(),
  }).strict()).max(2000),
  committing: z.object({ request: bookExtractionCommitSchema, requestHash: hash }).strict().nullable(),
}).strict().superRefine((draft, context) => {
  const invalid = (message: string) => context.addIssue({ code: 'custom', message });
  const segments = new Map(draft.source.segments.map(segment => [segment.id, segment]));
  if (new Set(draft.batches.map(batch => batch.id)).size !== draft.batches.length
    || new Set(draft.batches.map(batch => batch.requestHash)).size !== draft.batches.length
    || new Set(draft.reviews.map(review => review.segmentId)).size !== draft.reviews.length) invalid('草稿批次和审核段落身份不能重复');
  for (const batch of draft.batches) {
    if (batch.segmentIds.some(id => !segments.has(id)) || new Set(batch.suggestions.map(item => item.segmentId)).size !== batch.suggestions.length
      || batch.suggestions.some(item => !batch.segmentIds.includes(item.segmentId) || !segments.get(item.segmentId)?.text.includes(item.excerpt)
        || !batch.categoryIds.includes(item.categoryId) || item.tagIds.some(id => !batch.tagIds.includes(id)))) invalid('批次候选必须能核对原文和分类标签证据');
  }
  if (draft.reviews.some(review => !segments.has(review.segmentId))) invalid('审核段落不属于冻结来源');
  if (draft.reviews.some(review => ['approved', 'committed'].includes(review.status) && !review.body.trim())) invalid('已审核或入库内容不能为空');
  if (draft.committing && (draft.committing.request.workId !== draft.workId
    || JSON.stringify(draft.committing.request.sourceDocument) !== JSON.stringify(draft.source))) invalid('提交请求必须绑定当前作品和完整冻结来源');
});
export type ExtractionDraft = z.infer<typeof extractionDraftSchema>;
export const extractionDraftSaveSchema = z.object({ draft: extractionDraftSchema, expectedTaskId: z.uuid().nullable() }).strict();
export type ExtractionDraftSaveRequest = z.infer<typeof extractionDraftSaveSchema>;
export interface ExtractionDraftRecovery { draft: ExtractionDraft; preview: BookExtractionPreview; work?: WorkDetail }
export interface ExtractionReviewRequest { workId: string; token: string; reviews: ExtractionDraft['reviews'] }
