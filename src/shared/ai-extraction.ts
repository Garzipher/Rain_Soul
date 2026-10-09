import { z } from 'zod';
import type { Category } from './assets';

export interface AiKnowledgeApproval { body: string; source: string; categoryId?: string; tagIds?: string[] }
export interface AiExtractionDraft { body: string; type: string; source: string; suggestedCategory: string; suggestedTags: string[] }
export function extractionCategoryPath(categories: Category[], id: string): string {
  const path: string[] = [], seen = new Set<string>();
  let current = categories.find(item => item.id === id && !item.deletedAt);
  while (current && !seen.has(current.id)) {
    seen.add(current.id); path.unshift(current.name);
    current = categories.find(item => item.id === current!.parentId && !item.deletedAt);
  }
  return path.join(' / ');
}
export function suggestedExtractionCategory(categories: Category[], name: string): string {
  const matches = categories.filter(item => !item.deletedAt && (item.name === name || extractionCategoryPath(categories, item.id) === name));
  return matches.length === 1 ? matches[0].id : '';
}
const draftSchema = z.object({ items: z.array(z.object({
  body: z.string().trim().min(1).max(200000), type: z.string().max(120).default('待分类'),
  source: z.string().max(5000).default(''), category: z.string().max(200).default(''),
  tags: z.array(z.string().max(200)).max(100).default([]),
})).min(1).max(100) });

/** 模型输出仅形成草稿；格式异常时保留全文供作者审核，不静默丢弃部分结果。 */
export function parseAiExtraction(text: string): AiExtractionDraft[] {
  if (!text.trim()) return [];
  try {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    const parsed = draftSchema.safeParse(value);
    if (parsed.success) return parsed.data.items.map(item => ({ body: item.body, type: item.type, source: item.source, suggestedCategory: item.category, suggestedTags: item.tags }));
  } catch { /* 无效 JSON 保留为普通候选，作者决定内容与分类。 */ }
  return [{ body: text, type: '待分类', source: '', suggestedCategory: '', suggestedTags: [] }];
}
