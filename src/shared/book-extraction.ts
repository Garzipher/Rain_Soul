import { z } from 'zod';
import type { WorkDetail } from './contracts';
import type { ManuscriptWarning } from './manuscript';

export interface BookExtractionSegment { id: string; chapterTitle: string; chapterIndex: number; paragraphIndex: number; text: string }
export interface BookExtractionPreview {
  token: string; workId: string; filename: string; fileHash: string; format: 'txt' | 'docx';
  warnings: ManuscriptWarning[]; segments: BookExtractionSegment[];
}
const text = z.string().trim().min(1).max(20000);
const tags = z.array(z.uuid()).max(100).refine(ids => new Set(ids).size === ids.length);
export const bookExtractionConfirmationSchema = z.object({
  token: z.uuid(), workId: z.uuid(), expectedRevision: z.number().int().positive(), operationId: z.uuid(),
  sourceTitle: z.string().trim().min(1).max(200), sourceAuthor: z.string().trim().max(200), permissionConfirmed: z.literal(true),
  items: z.array(z.object({ segmentId: z.uuid(), body: text, categoryId: z.uuid(), tagIds: tags }).strict()).min(1).max(100)
    .refine(items => new Set(items.map(item => item.segmentId)).size === items.length),
}).strict();
export type BookExtractionConfirmation = z.infer<typeof bookExtractionConfirmationSchema>;
export const bookExtractionCommitSchema = z.object({
  workId: z.uuid(), expectedRevision: z.number().int().positive(), operationId: z.uuid(),
  items: z.array(z.object({ body: text, source: z.string().min(1).max(3000), categoryId: z.uuid(), tagIds: tags }).strict()).min(1).max(100),
}).strict();
/** 仅主进程构造出处；该协议不对渲染层直接开放。 */
export type BookExtractionCommit = z.infer<typeof bookExtractionCommitSchema>;
export interface BookExtractionApi {
  chooseBookExtraction(workId: string, encoding: 'utf-8' | 'gb18030'): Promise<BookExtractionPreview | null>;
  confirmBookExtraction(request: BookExtractionConfirmation): Promise<WorkDetail>;
  cancelBookExtraction(token: string): Promise<void>;
}
