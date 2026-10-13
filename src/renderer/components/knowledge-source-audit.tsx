import { useState } from 'react';
import type { KnowledgeSourceAuditRecord } from '../../shared/knowledge-source';
import type { FrozenSourceDocument } from '../../shared/source-document';

/** 只展示冻结证据字段，不读取或执行网页 HTML。 */
export function WebSourceAudit({ source }: { source: FrozenSourceDocument }) {
  if (source.kind !== 'web') return null;
  const capture = source.capture;
  return <details><summary>网页来源记录</summary><p>原始地址：{source.originalUrl}<br />最终地址：{source.finalUrl}<br />获取时间：{source.fetchedAt}<br />
    捕获方式：{capture ? capture.captureMethod === 'static' ? '静态获取' : '受限浏览器' : '未知（旧记录）'}<br />
    {capture && <>捕获时间：{capture.capturedAt}<br />政策版本：{capture.policyVersion}<br /></>}
    {capture?.captureMethod === 'restricted-browser' && <>渲染 DOM SHA-256：{capture.renderedDomHash}<br /></>}
    原始 HTML SHA-256：{source.rawHash}<br />正文 SHA-256：{source.bodyHash}</p></details>;
}

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
