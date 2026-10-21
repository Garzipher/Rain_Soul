import type { Evidence, EvidenceKind, Foreshadow } from './assets';
import type { Chapter, ParagraphNode, WorkDetail } from './contracts';

export interface EvidenceStatus {
  valid: boolean;
  reason: string | null;
}

/** 将正文段落还原成证据可核对的纯文本；行内书签不属于正文摘录。 */
export function paragraphText(paragraph: ParagraphNode | undefined): string {
  return (paragraph?.content ?? []).map(node => node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : '').join('');
}

function chapterText(chapter: Chapter | undefined, paragraphId?: string | null): string {
  const paragraph = paragraphId ? chapter?.document.content.find(item => item.attrs.id === paragraphId) : undefined;
  return (paragraph ? [paragraph] : chapter?.document.content ?? []).map(item => paragraphText(item)).join('\n');
}

/** 与离线一致性检查使用同一套规则，避免列表、详情和报告显示不一致。 */
export function getEvidenceStatus(work: Pick<WorkDetail, 'chapters'>, evidence: Evidence): EvidenceStatus {
  const chapter = work.chapters.find(item => item.id === evidence.chapterId);
  const paragraph = evidence.paragraphId ? chapter?.document.content.find(item => item.attrs.id === evidence.paragraphId) : undefined;
  const reason = !chapter ? '关联章节已不存在'
    : evidence.paragraphId && !paragraph ? '关联段落已不存在'
      : !evidence.valid ? evidence.invalidReason || '证据已经失效'
        : evidence.excerpt && !chapterText(chapter, evidence.paragraphId).includes(evidence.excerpt) ? '证据摘录已不在当前正文中' : null;
  return { valid: !reason, reason };
}

export interface ForeshadowEvidenceSummary {
  missing: EvidenceKind[];
  invalid: Evidence[];
}

export function summarizeForeshadowEvidence(work: Pick<WorkDetail, 'chapters' | 'assets'>, hint: Foreshadow): ForeshadowEvidenceSummary {
  const evidence = (work.assets?.evidence ?? []).filter(item => item.foreshadowId === hint.id && !item.deletedAt && !item.supersededBy);
  const validKinds = new Set<EvidenceKind>();
  const invalid: Evidence[] = [];
  for (const item of evidence) {
    const status = getEvidenceStatus(work, item);
    if (status.valid) validKinds.add(item.kind); else invalid.push(item);
  }
  const required: Record<string, EvidenceKind[]> = { 未埋设: [], 已埋设: ['埋设'], 已触发: ['埋设', '触发'], 已回收: ['埋设', '触发', '回收'], 废弃: [] };
  return { missing: (required[hint.status] ?? []).filter(kind => !validKinds.has(kind)), invalid };
}
