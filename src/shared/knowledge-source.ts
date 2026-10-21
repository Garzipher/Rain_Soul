import { z } from 'zod';

const marker = 'AI 审核来源：';
const auditSchema = z.object({ candidateId: z.uuid(), candidateText: z.string().min(1), requestHash: z.string().regex(/^[a-f0-9]{64}$/), workId: z.uuid(),
  evidence: z.array(z.object({ chapterId: z.uuid(), chapterTitle: z.string(), paragraphId: z.uuid(), revision: z.number().int().positive(), excerpt: z.string(),
    hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), role: z.enum(['authorized-context', 'target']).optional(),
  }).strict()).min(1),
}).strict();
export type KnowledgeSourceAuditRecord = z.infer<typeof auditSchema>;

/** 只识别末尾完整审计结构；未知结构仍视为普通出处，避免丢失作者文本。 */
export function splitKnowledgeSource(source: string) {
  let readable = source, audit = '';
  const records: KnowledgeSourceAuditRecord[] = [];
  while (true) {
    const matches = [...readable.matchAll(/(?:^|\r?\n)AI 审核来源：/g)], match = matches.at(-1);
    if (!match) break;
    const start = match.index + match[0].length - marker.length;
    let value: unknown;
    try { value = JSON.parse(readable.slice(start + marker.length)); } catch { break; }
    const parsed = auditSchema.safeParse(value);
    if (!parsed.success) break;
    records.unshift(parsed.data);
    audit = `${readable.slice(start)}${audit ? `\n${audit}` : ''}`;
    readable = readable.slice(0, match.index);
  }
  return { readable, audit, records };
}

export const readableKnowledgeSource = (source: string): string => splitKnowledgeSource(source).readable;

/** 只为界面缩短系统生成的完整哈希字段；原始出处与冻结审计数据保持不变。 */
export function conciseKnowledgeSource(source: string): string {
  const readable = readableKnowledgeSource(source);
  if (!/^《[^》]+》[／；]/.test(readable)) return readable;
  return readable.replace(/；(?:文件|原始|段落) SHA-256：[a-f0-9]{64}(?=；|$)/g, '');
}

/** 手工编辑只替换可读出处，保留已有审计后缀，不重写证据内容。 */
export function replaceKnowledgeSource(original: string, readable: string): string {
  const { audit } = splitKnowledgeSource(original);
  return audit ? `${readable}${readable ? '\n' : ''}${audit}` : readable;
}
