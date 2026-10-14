import { expect, it } from 'vitest';
import type { KnowledgeEntry } from '../../src/shared/assets';
import { findKnowledgeCompletion } from '../../src/renderer/lib/knowledge-completion';

const entry = (body: string, overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
  id: 'knowledge-1', body, source: '原创范句', categoryId: 'category', tagIds: [], origin: null, revision: 2, deletedAt: null, ...overrides,
});
it('雨夜前缀只返回原句剩余部分并附来源及版本', () => {
  const sentence = '雨夜在盛夏后，总是使人哗然转变，那份落下的雨水夹杂着短暂的愁绪。';
  expect(findKnowledgeCompletion('雨夜', [entry(sentence)])).toEqual({ knowledgeId: 'knowledge-1', revision: 2, prefix: '雨夜', suffix: sentence.slice(2), source: '原创范句' });
});
it('前文已写其他句子仍能匹配当前句，基线保留完整前文', () => {
  expect(findKnowledgeCompletion('她关上门。雨夜', [entry('描写手法：雨夜里，灯光像一枚孤独的星。')])).toMatchObject({ prefix: '她关上门。雨夜', suffix: '里，灯光像一枚孤独的星。' });
});
it('不匹配词语中间，不忽略大小写，不合成正文', () => {
  expect(findKnowledgeCompletion('雨夜', [entry('冷雨夜使她沉默。')])).toBeNull();
  expect(findKnowledgeCompletion('rai', [entry('Rain settles over the city.')])).toBeNull();
});
it('过短、只有标点、末尾空白和空前缀不触发', () => {
  for (const prefix of ['', '雨', 'ab', '。', '雨夜 ', '雨夜\n']) expect(findKnowledgeCompletion(prefix, [entry('雨夜里有人等候。')])).toBeNull();
});
it('已删除、全文已输入、无后文条目不出现候选', () => {
  expect(findKnowledgeCompletion('雨夜', [entry('雨夜里有人等候。', { deletedAt: '2026-10-14' })])).toBeNull();
  expect(findKnowledgeCompletion('雨夜', [entry('雨夜')])).toBeNull();
  expect(findKnowledgeCompletion('雨夜里有人等候。', [entry('雨夜里有人等候。')])).toBeNull();
});
it('只提示当前句，不把后续段落一起插入', () => {
  expect(findKnowledgeCompletion('雨夜', [entry('雨夜里有人等候。另一章换了地点。\n新的段落。')])).toMatchObject({ suffix: '里有人等候。' });
});
it('支持英文完整前缀与Unicode字符，不截断代理对', () => {
  expect(findKnowledgeCompletion('Rain', [entry('Rain falls softly. Another scene.')])).toMatchObject({ suffix: ' falls softly.' });
  const suffix = '𠮷'.repeat(200);
  const candidate = findKnowledgeCompletion('雨夜', [entry('雨夜' + suffix)])!;
  expect(Array.from(candidate.suffix)).toHaveLength(160);
  expect(candidate.suffix).toBe('𠮷'.repeat(160));
});
it('同一前缀多来源选择固定ID顺序，避免条目排序导致闪烁', () => {
  const a = entry('雨夜里有人等候。', { id: 'a' }), b = entry('雨夜里没有人。', { id: 'b' });
  expect(findKnowledgeCompletion('雨夜', [b, a])?.knowledgeId).toBe('a');
  expect(findKnowledgeCompletion('雨夜', [a, b])?.knowledgeId).toBe('a');
});
it('空来源显示未注明，超过扫描预算不处理后续内容', () => {
  expect(findKnowledgeCompletion('雨夜', [entry('雨夜里有人等候。', { source: '' })])?.source).toBe('未注明');
  expect(findKnowledgeCompletion('雨夜', [entry('一'.repeat(1_000_000) + '。雨夜里有人等候。')])).toBeNull();
});
