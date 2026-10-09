import { z } from 'zod';
import type { AiCandidate } from './ai';
import type { WorkDetail } from './contracts';

export const aiAnalysisDimensions = ['角色', '时间', '地点', '伏笔', '大纲偏离', '写作特点漂移', '剧情衔接', '合理性'] as const;
export interface AiAnalysisEvidence {
  excerpt: string; verified: boolean; invalidReason: string | null;
  location: { chapterId: string; paragraphId: string } | null;
}
export interface AiAnalysisFinding {
  dimension: string; message: string; uncertainty: string;
  evidenceVerified: boolean; evidence: AiAnalysisEvidence[];
}
export interface AiAnalysisReport {
  format: 'structured' | 'text'; rawText: string; stale: boolean; findings: AiAnalysisFinding[];
}
const nonempty = z.string().trim().min(1);
const reportSchema = z.object({ findings: z.array(z.object({
  dimension: z.enum(aiAnalysisDimensions), message: nonempty.max(20000), uncertainty: nonempty.max(5000),
  evidence: z.array(z.unknown()).max(30),
}).strict()).min(1).max(100) }).strict();
const evidenceSchema = z.object({ chapterId: z.uuid(), paragraphId: z.uuid(),
  excerpt: z.string().max(20000).refine(text => !!text.trim(), '摘录不能为空'),
}).strict();

/** 核验的是证据位置与摘录，不代表已经证明模型的文学判断。只读取已授权的正文范围。 */
export function analyzeAiCandidate(candidate: AiCandidate, current: WorkDetail, sentChapterIds: readonly string[]): AiAnalysisReport {
  if (candidate.operation !== 'consistency' && candidate.operation !== 'plotFeel') throw new Error('仅分析一致性检查和剧情感受建议。');
  const stale = candidate.workId !== current.id || candidate.baselineRevision !== current.revision;
  const base = { rawText: candidate.text, stale };
  let value: unknown;
  try {
    const text = candidate.text.trim();
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
    value = JSON.parse(fenced?.[1] ?? text);
  } catch { value = null; }
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) return { ...base, format: 'text', findings: [{
    dimension: candidate.operation === 'plotFeel' ? '剧情感受' : '一致性建议', message: candidate.text,
    uncertainty: '未验证：模型未提供合格的结构化原因、不确定性及证据，请作者结合原文核对。',
    evidenceVerified: false, evidence: [],
  }] };
  const allowed = new Set(sentChapterIds);
  const chapters = new Map(current.chapters.map(chapter => [chapter.id, new Map(chapter.document.content.map(paragraph => [paragraph.attrs.id,
    (paragraph.content ?? []).map(node => node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : '').join('')]))]));
  function checkEvidence(input: unknown): AiAnalysisEvidence {
    const parsed = evidenceSchema.safeParse(input);
    if (!parsed.success) {
      const excerpt = input && typeof input === 'object' && 'excerpt' in input && typeof input.excerpt === 'string' ? input.excerpt : '';
      return { excerpt, verified: false, invalidReason: '未验证：证据格式无效或摘录为空。', location: null };
    }
    const { chapterId, paragraphId, excerpt } = parsed.data;
    const paragraph = chapters.get(chapterId)?.get(paragraphId);
    const invalidReason = stale ? '未验证：建议对应的作品版本已过期，请重新生成。'
      : !allowed.has(chapterId) ? '未验证：证据不在本次已授权发送范围。'
        : paragraph === undefined ? '未验证：证据章节或段落不存在。'
          : !paragraph.includes(excerpt) ? '未验证：证据摘录不在对应段落正文中。' : null;
    return { excerpt, verified: invalidReason === null, invalidReason,
      location: invalidReason === null ? { chapterId, paragraphId } : null };
  }
  return { ...base, format: 'structured', findings: parsed.data.findings.map(finding => {
    const evidence = finding.evidence.map(checkEvidence);
    return { ...finding, evidence, evidenceVerified: evidence.length > 0 && evidence.every(item => item.verified) };
  }) };
}
