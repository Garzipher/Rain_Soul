import { useState } from 'react';
import type { KnowledgeSourceAuditRecord } from '../../shared/knowledge-source';

export function KnowledgeSourceAudit({ records }: { records: KnowledgeSourceAuditRecord[] }) {
  const [open, setOpen] = useState(false);
  if (!records.length) return null;
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>AI 审核记录</summary>{open && <>
    <p>以下为当时授权读取的材料，不表示每条知识都逐段引用。</p>
    {records.map((record, index) => <section key={index} aria-label={`审核记录 ${index + 1}`}>
      <p>候选 ID：{record.candidateId} · 作品 ID：{record.workId}</p><p>请求哈希：{record.requestHash}</p>
      <p>原候选：{record.candidateText}</p>
      {record.evidence.map((item, evidenceIndex) => <div key={evidenceIndex}>
        <p>{item.chapterTitle} · 版本 {item.revision} · 章节 ID：{item.chapterId} · 段落 ID：{item.paragraphId}</p>
        <p>{item.excerpt || '无正文摘录'}</p>{item.hash && <p>摘录哈希：{item.hash}</p>}
      </div>)}
    </section>)}
  </>}</details>;
}
