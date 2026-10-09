import type { EvidenceKind } from './assets';
import type { WorkDetail } from './contracts';

export interface ConsistencySource { kind: 'outline' | 'evidence' | 'foreshadow' | 'style'; id: string; chapterId?: string; paragraphId?: string; excerpt?: string }
export interface ConsistencyFinding { id: string; code: string; severity: 'warning' | 'info'; message: string; source: ConsistencySource }
export interface ConsistencyReport { workId: string; baselineRevision: number; findings: ConsistencyFinding[]; aiRequiredDimensions: string[] }

/** 离线规则只核对结构与可追溯证据，不把文学判断伪装成确定事实。 */
export function analyzeConsistency(work: WorkDetail): ConsistencyReport {
  const report: ConsistencyReport = { workId: work.id, baselineRevision: work.revision, findings: [], aiRequiredDimensions: ['角色', '时间', '地点', '剧情偏离', '写作特点漂移'] };
  const assets = work.assets; if (!assets) return report;
  const chapters = new Map(work.chapters.map(chapter => [chapter.id, chapter]));
  function add(code: string, severity: ConsistencyFinding['severity'], message: string, source: ConsistencySource) {
    report.findings.push({ id: `${code}:${source.id}`, code, severity, message, source });
  }
  for (const node of assets.outlines) {
    if (!node.deletedAt && node.chapterId && !chapters.has(node.chapterId)) add('outline-missing-chapter', 'warning', `剧情节点“${node.title}”关联的正文章节不存在，请重新关联。`, { kind: 'outline', id: node.id, chapterId: node.chapterId });
  }
  const liveHints = new Map(assets.foreshadows.filter(hint => !hint.deletedAt).map(hint => [hint.id, hint]));
  const validEvidence = new Map<string, Set<EvidenceKind>>();
  for (const evidence of assets.evidence) {
    if (evidence.deletedAt || evidence.supersededBy || !liveHints.has(evidence.foreshadowId)) continue;
    const chapter = chapters.get(evidence.chapterId);
    const paragraph = evidence.paragraphId ? chapter?.document.content.find(item => item.attrs.id === evidence.paragraphId) : null;
    const sourceText = (paragraph ? [paragraph] : chapter?.document.content ?? []).map(item => (item.content ?? []).map(node => node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : '').join('')).join('\n');
    const reason = !chapter ? '关联章节已不存在' : evidence.paragraphId && !paragraph ? '关联段落已不存在' : !evidence.valid ? evidence.invalidReason || '证据已经失效' : evidence.excerpt && !sourceText.includes(evidence.excerpt) ? '证据摘录已不在当前正文中' : null;
    if (reason) {
      add('invalid-evidence', 'warning', `伏笔“${liveHints.get(evidence.foreshadowId)!.name}”的${evidence.kind}证据需复核：${reason}。`, { kind: 'evidence', id: evidence.id, chapterId: evidence.chapterId, paragraphId: evidence.paragraphId ?? undefined, excerpt: evidence.originalSource.excerpt });
    } else {
      const kinds = validEvidence.get(evidence.foreshadowId) ?? new Set<EvidenceKind>(); kinds.add(evidence.kind); validEvidence.set(evidence.foreshadowId, kinds);
    }
  }
  const required: Record<string, EvidenceKind[]> = { 未埋设: [], 已埋设: ['埋设'], 已触发: ['埋设', '触发'], 已回收: ['埋设', '触发', '回收'], 废弃: [] };
  for (const hint of liveHints.values()) {
    const missing = (required[hint.status] ?? []).filter(kind => !validEvidence.get(hint.id)?.has(kind));
    if (missing.length) add('foreshadow-missing-evidence', 'warning', `伏笔“${hint.name}”状态为${hint.status}，缺少有效${missing.join('、')}证据。请人工补充或调整状态，系统不会自动制造证据。`, { kind: 'foreshadow', id: hint.id });
    if (hint.outlineId && !assets.outlines.some(node => node.id === hint.outlineId && !node.deletedAt)) add('foreshadow-missing-outline', 'warning', `伏笔“${hint.name}”关联的剧情节点不存在，请重新关联。`, { kind: 'foreshadow', id: hint.id });
  }
  const profiles = new Map(assets.styleProfiles.map(profile => [profile.id, profile]));
  const current = assets.defaultStyleId ? profiles.get(assets.defaultStyleId) : null;
  for (const override of assets.chapterStyles) {
    const chapter = chapters.get(override.chapterId); if (!chapter) continue;
    const profile = profiles.get(override.profileId);
    if (!profile) add('chapter-style-missing-version', 'warning', `章节“${chapter.title}”指定的写作特点版本不存在。`, { kind: 'style', id: override.profileId, chapterId: chapter.id });
    else if (current && profile.version < current.version) add('chapter-style-older-version', 'info', `章节“${chapter.title}”人工固定为写作特点版本 ${profile.version}，作品默认为版本 ${current.version}。这可能是作者主动选择，不代表正文发生漂移。`, { kind: 'style', id: profile.id, chapterId: chapter.id });
  }
  return report;
}
