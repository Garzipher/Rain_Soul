import { z } from 'zod';
import { sourceCaptureSchema, type SourceCapture } from './source-capture';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const boundedText = (max: number) => z.string().refine(value => [...value].length <= max, `文本最多 ${max} 个字符`);

/** 这里只验证地址形式；DNS、重定向和固定 IP 建连由网络边界另行验证。 */
export const sourceUrlSchema = boundedText(2048).refine(value => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (!url.port || url.port === '443') && !url.username && !url.password
      && host.includes('.') && !host.endsWith('.') && !host.endsWith('.localhost') && !host.endsWith('.local')
      && !host.endsWith('.internal') && !host.endsWith('.test') && !host.endsWith('.invalid')
      && !/^[\d.]+$/.test(host) && !host.includes(':') && !host.includes('[');
  } catch { return false; }
}, '来源必须是无凭据的公开 HTTPS 网址');

export const sourceSegmentSchema = z.object({
  id: z.uuid(), ordinal: z.number().int().positive(), chapterTitle: boundedText(200),
  text: boundedText(200000).refine(value => value.trim().length > 0 && !value.includes('\r'), '段落必须非空且换行已规范'),
  textHash: hash,
  chapterIndex: z.number().int().positive().optional(), paragraphIndex: z.number().int().positive().optional(),
}).strict().refine(segment => (segment.chapterIndex === undefined) === (segment.paragraphIndex === undefined), '原文坐标必须成对提供');
export type SourceSegment = z.infer<typeof sourceSegmentSchema>;

export const frozenSourceDocumentSchema = z.object({
  id: z.uuid(), kind: z.enum(['txt', 'docx', 'web', 'paste']), hashVersion: z.literal(1),
  originalUrl: sourceUrlSchema.nullable(), finalUrl: sourceUrlSchema.nullable(),
  title: boundedText(200).refine(value => value.trim().length > 0, '来源标题不能为空'),
  fetchedAt: z.iso.datetime({ offset: true }).nullable(), rawHash: hash, bodyHash: hash,
  capture: sourceCaptureSchema.optional(),
  segments: z.array(sourceSegmentSchema).min(1).max(2000),
}).strict().superRefine((source, context) => {
  const metadataValid = source.kind === 'web'
    ? source.originalUrl !== null && source.finalUrl !== null && source.fetchedAt !== null
    : source.originalUrl === null && source.finalUrl === null && source.fetchedAt === null;
  if (!metadataValid) context.addIssue({ code: 'custom', message: '来源种类与网页元信息不匹配' });
  if (source.capture && (source.kind !== 'web' || source.capture.sourceId !== source.id))
    context.addIssue({ code: 'custom', path: ['capture'], message: '捕获证据必须属于同一网页来源' });
  if (source.segments.reduce((size, segment) => size + [...segment.text].length, 0) > 200000)
    context.addIssue({ code: 'custom', path: ['segments'], message: '来源正文最多二十万字符' });
  if (new Set(source.segments.map(segment => segment.id)).size !== source.segments.length
    || source.segments.some((segment, index) => segment.ordinal !== index + 1 || segment.id === source.id))
    context.addIssue({ code: 'custom', path: ['segments'], message: '段落身份必须唯一且序号连续' });
});
export type FrozenSourceDocument = z.infer<typeof frozenSourceDocumentSchema>;

/** 仅由主进程从可信提取结果构造，渲染层不能替换原始字节或正文。 */
type CaptureInput<T = SourceCapture> = T extends SourceCapture ? Omit<T, 'sourceId'> : never;
export interface SourceInput {
  kind: FrozenSourceDocument['kind']; rawBytes: Uint8Array; title: string;
  segments: { text: string; chapterTitle?: string; chapterIndex?: number; paragraphIndex?: number }[];
  originalUrl?: string | null; finalUrl?: string | null; fetchedAt?: string | null;
  capture?: CaptureInput;
}
