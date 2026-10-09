import { describe, expect, it } from 'vitest';
import { parseAiExtraction, extractionCategoryPath, suggestedExtractionCategory } from '../../src/shared/ai-extraction';

describe('AI 知识提取草稿', () => {
  it('结构化候选保留类型及分类标签建议但不能自动审核', () => {
    const result = parseAiExtraction(JSON.stringify({ items: [{ type: '角色', body: '雨夜中的旅人', category: '人物描写', tags: ['雨夜'], source: '作者正文' }] }));
    expect(result).toEqual([{ type: '角色', body: '雨夜中的旅人', suggestedCategory: '人物描写', suggestedTags: ['雨夜'], source: '作者正文' }]);
  });
  it('代码围栏JSON可解析；格式错误降级单个完整草稿，不能丢弃内容', () => {
    expect(parseAiExtraction('```json\n{"items":[{"body":"摘要"}]}\n```')[0].body).toBe('摘要');
    expect(parseAiExtraction('{"items":[{"body":5}]}')).toEqual([{ body: '{"items":[{"body":5}]}', type: '待分类', source: '', suggestedCategory: '', suggestedTags: [] }]);
    expect(parseAiExtraction('第一段\n\n第二段')[0].body).toBe('第一段\n\n第二段');
  });
  it('空内容、超长字段或超过100项时不生成看似有效的部分候选', () => {
    expect(parseAiExtraction(' ')).toEqual([]);
    const text = JSON.stringify({ items: Array.from({ length: 101 }, () => ({ body: '知识' })) });
    expect(parseAiExtraction(text)).toHaveLength(1);
    expect(parseAiExtraction(JSON.stringify({ items: [{ body: '摘要', type: 'x'.repeat(121) }] }))[0].type).toBe('待分类');
  });
});

it('分类路径在缺失父节点或环中仍有限，唯一全路径才可自动建议', () => {
  const categories = [{ id: 'a', name: '人物', parentId: 'b' }, { id: 'b', name: '描写', parentId: 'a' }, { id: 'c', name: '描写', parentId: 'missing' }].map((item, sortOrder) => ({ ...item, sortOrder, systemKey: null, deletedAt: null }));
  expect(extractionCategoryPath(categories, 'a')).toBe('描写 / 人物');
  expect(extractionCategoryPath(categories, 'unknown')).toBe('');
  expect(suggestedExtractionCategory(categories, '描写')).toBe('');
  expect(suggestedExtractionCategory(categories, '人物 / 描写')).toBe('b');
  expect(suggestedExtractionCategory(categories, '未知')).toBe('');
});
