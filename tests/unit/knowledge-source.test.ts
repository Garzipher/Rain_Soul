import { expect, it } from 'vitest';
import { conciseKnowledgeSource, readableKnowledgeSource, replaceKnowledgeSource, splitKnowledgeSource } from '../../src/shared/knowledge-source';
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

it('系统拆书出处默认去掉完整校验字段，普通作者文字和不完整哈希原样保留', () => {
  const fileHash = 'a'.repeat(64), paragraphHash = 'b'.repeat(64);
  const source = `《旧信》／作者：听雨；原稿.txt；第1章 第2段；文件 SHA-256：${fileHash}；段落 SHA-256：${paragraphHash}`;
  expect(conciseKnowledgeSource(source)).toBe('《旧信》／作者：听雨；原稿.txt；第1章 第2段');
  expect(readableKnowledgeSource(source)).toBe(source);
  expect(conciseKnowledgeSource(`《旧信》／听雨；第2段；原始 SHA-256：${fileHash}；https://example.com/book`)).toBe('《旧信》／听雨；第2段；https://example.com/book');
  for (const ordinary of ['作者讨论 SHA-256：文字', `手写出处；文件 SHA-256：${fileHash}`, '《论哈希》；文件 SHA-256：不完整', '第一行\n第二行']) {
    expect(conciseKnowledgeSource(ordinary)).toBe(ordinary);
  }
  const audit = auditedKnowledgeSource(source);
  expect(conciseKnowledgeSource(audit.source)).toBe('《旧信》／作者：听雨；原稿.txt；第1章 第2段');
});
