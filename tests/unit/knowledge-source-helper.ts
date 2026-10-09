import { randomUUID, createHash } from 'node:crypto';

export function auditedKnowledgeSource(readable = '作者可读出处', legacy = false) {
  const excerpt = '上下文独有秘词，不应再次发送。';
  const provenance = { candidateId: randomUUID(), candidateText: '候选审核原文', requestHash: 'a'.repeat(64), workId: randomUUID(),
    evidence: [{ chapterId: randomUUID(), chapterTitle: '前章', paragraphId: randomUUID(), revision: 3, excerpt,
      ...(legacy ? {} : { hash: createHash('sha256').update(excerpt).digest('hex'), role: 'authorized-context' as const }) }],
  };
  const audit = `AI 审核来源：${JSON.stringify(provenance)}`;
  return { source: `${readable}${readable ? '\n' : ''}${audit}`, readable, audit, provenance };
}
