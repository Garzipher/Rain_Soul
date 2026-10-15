import { describe, expect, it } from 'vitest';
import { findScopedKnowledgeCompletion } from '../../src/renderer/lib/knowledge-completion';
import type { KnowledgeEntry } from '../../src/shared/assets';

const entry = (id: string, body: string): KnowledgeEntry => ({ id, body, source: '原创样稿', categoryId: 'category', tagIds: [], origin: null, revision: 1, deletedAt: null });
describe('作品与全局原句候选', () => {
  it('同一前缀优先当前作品，不能由全局更长命中抢占', () => {
    const result = findScopedKnowledgeCompletion('雨夜', { workEntries: [entry('work', '雨夜落在窗边。')], globalEntries: [entry('global', '雨夜仍然安静。')] });
    expect(result?.knowledgeId).toBe('work');
    expect(result?.library).toBe('work');
  });
  it('无作品命中时仅展示全局原句及版本，不生成新文字', () => {
    expect(findScopedKnowledgeCompletion('雨夜', { workEntries: [], globalEntries: [entry('global', '雨夜仍然安静。')] }))
      .toMatchObject({ knowledgeId: 'global', suffix: '仍然安静。', revision: 1, library: 'global' });
  });
  it('软删除或无前缀命中时不提示', () => {
    expect(findScopedKnowledgeCompletion('雨夜', { workEntries: [], globalEntries: [{ ...entry('global', '雨夜静谧。'), deletedAt: '2026-10-15' }] })).toBeNull();
  });
});
