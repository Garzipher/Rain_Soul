import { describe, expect, it } from 'vitest';
import { globalEntryRefSchema, globalKnowledgeQuerySchema, globalSourceMetadataSchema, knowledgeLibraryTargetSchema } from '../../src/shared/global-knowledge-schema';
const id = '83c13b01-6ca5-4240-9d07-19f9c95d49d4';
describe('全局库契约边界', () => {
  it('不允许作品范围丢失身份或未知路径字段', () => {
    expect(knowledgeLibraryTargetSchema.safeParse({ kind: 'work' }).success).toBe(false);
    expect(globalKnowledgeQuerySchema.safeParse({ directory: 'C:/private' }).success).toBe(false);
  });
  it('拒绝重复标签和非正版本', () => {
    expect(globalKnowledgeQuerySchema.safeParse({ tagIds: [id, id] }).success).toBe(false);
    expect(globalEntryRefSchema.safeParse({ entryId: id, revision: 0 }).success).toBe(false);
  });
  it('未核实来源不能标为正式来源', () => {
    expect(globalSourceMetadataSchema.safeParse({ author: '作者', workTitle: '作品', chapter: '第一章', rightsBasis: 'public-excerpt', capturedAt: '2026-10-15T00:00:00Z', verificationStatus: 'pending', metrics: [] }).success).toBe(false);
  });
});
