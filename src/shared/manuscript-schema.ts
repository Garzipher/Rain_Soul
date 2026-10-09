import { z } from 'zod';
import type { ManuscriptDraft } from './manuscript';
const name = z.string().trim().min(1).max(200);
export const manuscriptDraftSchema: z.ZodType<ManuscriptDraft> = z.object({
  title: name, format: z.enum(['txt', 'docx']), encoding: z.string().nullable(),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), count: z.number().int().nonnegative() }).strict()),
  chapters: z.array(z.object({ title: name, volumeTitle: name.nullable(), paragraphs: z.array(z.string()) }).strict()).min(1),
}).strict().superRefine((draft, context) => {
  const size = draft.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.reduce((total, text) => total + text.length, 0), 0);
  if (size > 128 * 1024 * 1024) context.addIssue({ code: 'custom', message: '手稿文本超过安全导入限额' });
});
export const manuscriptImportRequestSchema = z.object({ operationId: z.uuid(), draft: manuscriptDraftSchema }).strict();
export type ManuscriptImportRequest = z.infer<typeof manuscriptImportRequestSchema>;
