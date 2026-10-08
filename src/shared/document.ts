import type { WritingDocument } from './contracts';
import { z } from 'zod';

const inlineSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1) }).strict(),
  z.object({ type: z.literal('hardBreak') }).strict(),
]);
export const writingDocumentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.object({
    type: z.literal('paragraph'), attrs: z.object({ id: z.uuid() }).strict(),
    content: z.array(inlineSchema).optional(),
  }).strict()).min(1),
}).strict().superRefine((doc, context) => {
  const ids = new Set<string>();
  for (const paragraph of doc.content) {
    if (ids.has(paragraph.attrs.id)) context.addIssue({ code: 'custom', message: '段落 ID 重复' });
    ids.add(paragraph.attrs.id);
  }
});

export function emptyDocument(): WritingDocument {
  return { type: 'doc', content: [{ type: 'paragraph', attrs: { id: globalThis.crypto.randomUUID() }, content: [] }] };
}
export function validateDocument(value: unknown): WritingDocument { return writingDocumentSchema.parse(value); }
export function countDocumentWords(document: WritingDocument): number {
  let count = 0;
  for (const paragraph of document.content) {
    for (const inline of paragraph.content ?? []) {
      if (inline.type === 'text') for (const character of inline.text) {
        if (/[\p{Script=Han}A-Za-z0-9]/u.test(character)) count++;
      }
    }
  }
  return count;
}
