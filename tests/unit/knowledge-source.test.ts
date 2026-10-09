import { expect, it } from 'vitest';
import { readableKnowledgeSource, replaceKnowledgeSource, splitKnowledgeSource } from '../../src/shared/knowledge-source';
import { auditedKnowledgeSource } from './knowledge-source-helper';

it.each([false, true])('兼容新旧审计后缀（旧格式：%s），清空或修改可读出处仍保留逐字审计', legacy => {
  const { source, audit, provenance } = auditedKnowledgeSource('普通出处\n第二行', legacy);
  expect(readableKnowledgeSource(source)).toBe('普通出处\n第二行');
  expect(splitKnowledgeSource(source).records).toEqual([provenance]);
  expect(replaceKnowledgeSource(source, '新出处')).toBe(`新出处\n${audit}`);
  expect(replaceKnowledgeSource(source, '')).toBe(audit);
  expect(readableKnowledgeSource(audit)).toBe('');
});
it('连续历史审计后缀均保留，不能将前一份审计当作可读出处再发送', () => {
  const first = auditedKnowledgeSource('作者出处'), second = auditedKnowledgeSource();
  const source = `${first.source}\n${second.audit}`;
  expect(readableKnowledgeSource(source)).toBe('作者出处');
  expect(splitKnowledgeSource(source).records).toHaveLength(2);
  expect(replaceKnowledgeSource(source, '修订')).toBe(`修订\n${first.audit}\n${second.audit}`);
});
it('普通出处包含标记、无效JSON、错误字段/身份或非末尾结构时不误裁切', () => {
  const { provenance, source } = auditedKnowledgeSource('普通出处');
  const ordinary = ['普通出处', '讨论 AI 审核来源：{}', '出处\nAI 审核来源：不是JSON', '出处\nAI 审核来源：{}',
    `出处\nAI 审核来源：${JSON.stringify({ ...provenance, extra: true })}`,
    `出处\nAI 审核来源：${JSON.stringify({ ...provenance, workId: '不是作品ID' })}`,
    `出处\nAI 审核来源：${JSON.stringify({ ...provenance, evidence: [{ excerpt: '普通出处' }] })}`,
    `${source}\n作者附注`,
  ];
  for (const value of ordinary) {
    expect(readableKnowledgeSource(value)).toBe(value); expect(splitKnowledgeSource(value).records).toEqual([]);
    expect(replaceKnowledgeSource(value, '手工改写')).toBe('手工改写');
  }
});
