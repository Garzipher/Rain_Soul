import { createHash, randomUUID } from 'node:crypto';
import { frozenSourceDocumentSchema, type FrozenSourceDocument, type SourceInput } from '../shared/source-document';

export type { SourceInput } from '../shared/source-document';
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

/** hashVersion=1：只处理换行和空段，保留原文空白及 Unicode 表示。 */
export function freezeSource(input: SourceInput): FrozenSourceDocument {
  const paragraphs = input.segments.map(segment => ({ ...segment, text: segment.text.replace(/\r\n?/g, '\n') }))
    .filter(segment => segment.text.trim().length > 0);
  return frozenSourceDocumentSchema.parse({
    id: randomUUID(), kind: input.kind, hashVersion: 1,
    originalUrl: input.originalUrl ?? null, finalUrl: input.finalUrl ?? null,
    title: input.title, fetchedAt: input.fetchedAt ?? null,
    rawHash: sha256(input.rawBytes), bodyHash: sha256(JSON.stringify(paragraphs.map(segment => segment.text))),
    segments: paragraphs.map((segment, index) => ({
      id: randomUUID(), ordinal: index + 1, chapterTitle: segment.chapterTitle ?? '',
      text: segment.text, textHash: sha256(segment.text),
    })),
  });
}
