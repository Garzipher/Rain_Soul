import { z } from 'zod';
import type { WorkDetail } from './contracts';
import type { ManuscriptWarning } from './manuscript';
import type { FrozenSourceDocument } from './source-document';
import { frozenSourceDocumentSchema } from './source-document';
import { learningAnnotationPayloadSchema } from './source-assets';
import type { ExtractionDraft, ExtractionDraftRecovery, ExtractionReviewRequest } from './extraction-draft';

export interface BookExtractionSegment { id: string; chapterTitle: string; chapterIndex: number; paragraphIndex: number; text: string; locationUnknown?: boolean }
export interface BookExtractionPreview {
  token: string; workId: string; filename: string; fileHash: string; format: 'txt' | 'docx' | 'web' | 'paste';
  warnings: ManuscriptWarning[]; segments: BookExtractionSegment[];
  source?: FrozenSourceDocument;
}
export interface WebImportRequest { workId: string; operationId: string; url: string }
export interface PastedImportRequest { workId: string; text: string; title: string }
const text = z.string().trim().min(1).max(20000);
const tags = z.array(z.uuid()).max(100).refine(ids => new Set(ids).size === ids.length);
export const bookExtractionConfirmationSchema = z.object({
  token: z.uuid(), workId: z.uuid(), expectedRevision: z.number().int().positive(), operationId: z.uuid(),
  sourceTitle: z.string().trim().min(1).max(200), sourceAuthor: z.string().trim().max(200), permissionConfirmed: z.literal(true),
  items: z.array(z.object({ segmentId: z.uuid(), body: text, categoryId: z.uuid(), tagIds: tags, annotation: learningAnnotationPayloadSchema.optional() }).strict()).min(1).max(100)
    .refine(items => new Set(items.map(item => item.segmentId)).size === items.length),
}).strict();
export type BookExtractionConfirmation = z.infer<typeof bookExtractionConfirmationSchema>;
export const bookExtractionCommitSchema = z.object({
  workId: z.uuid(), expectedRevision: z.number().int().positive(), operationId: z.uuid(),
  sourceDocument: frozenSourceDocumentSchema.optional(),
  items: z.array(z.object({ body: text, source: z.string().min(1).max(6000), categoryId: z.uuid(), tagIds: tags,
    segmentId: z.uuid().optional(), annotation: learningAnnotationPayloadSchema.optional() }).strict()).min(1).max(100),
}).strict().superRefine((request, context) => {
  if (request.sourceDocument) {
    const ids = request.items.map(item => item.segmentId);
    if (ids.some(id => !id || !request.sourceDocument!.segments.some(segment => segment.id === id)) || new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', message: '审核段落必须唯一且属于冻结来源' });
  } else if (request.items.some(item => item.segmentId || item.annotation))
    context.addIssue({ code: 'custom', message: '来源关联与学习注释必须附带冻结来源' });
});
/** 仅主进程构造出处；该协议不对渲染层直接开放。 */
export type BookExtractionCommit = z.infer<typeof bookExtractionCommitSchema>;
export interface BookExtractionApi {
  readExtractionDraft?(workId: string): Promise<ExtractionDraftRecovery | null>;
  discardExtractionDraft?(workId: string, token: string): Promise<void>;
  saveExtractionReview?(request: ExtractionReviewRequest): Promise<ExtractionDraft>;
  fetchWebExtraction?(request: WebImportRequest): Promise<BookExtractionPreview>;
  cancelWebExtraction?(operationId: string): Promise<void>;
  previewPastedExtraction?(request: PastedImportRequest): Promise<BookExtractionPreview>;
  chooseBookExtraction(workId: string, encoding: 'utf-8' | 'gb18030'): Promise<BookExtractionPreview | null>;
  confirmBookExtraction(request: BookExtractionConfirmation): Promise<WorkDetail>;
  cancelBookExtraction(token: string): Promise<void>;
}
