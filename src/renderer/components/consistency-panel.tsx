import { analyzeConsistency } from '../../shared/consistency';
import type { WorkDetail } from '../../shared/contracts';
export function ConsistencyPanel({ work, onLocate }: { work: WorkDetail; onLocate: (chapterId: string, paragraphId?: string) => void }) {
  const report = analyzeConsistency(work);
  return <section className="ai-card" aria-label="离线一致性检查"><h2>结构与证据检查</h2><p className="ai-muted">当前版本 {report.baselineRevision}。规则核对结构与来源；角色、时间、地点和文学判断由云端 AI 给出建议。</p>
    {report.findings.length === 0 ? <p>当前未发现结构或证据关联问题。</p> : report.findings.map(finding => <article className="consistency-finding" key={finding.id}><p>{finding.severity === 'warning' ? '需复核' : '提示'}：{finding.message}</p>{finding.source.excerpt && <blockquote>{finding.source.excerpt}</blockquote>}{finding.source.chapterId && work.chapters.some(chapter => chapter.id === finding.source.chapterId && (!finding.source.paragraphId || chapter.document.content.some(paragraph => paragraph.attrs.id === finding.source.paragraphId))) && <button className="secondary" onClick={() => onLocate(finding.source.chapterId!, finding.source.paragraphId)}>定位证据</button>}</article>)}
  </section>;
}
