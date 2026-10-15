import { describe, expect, it, vi } from 'vitest';
import type { GlobalKnowledgeEntry, GlobalKnowledgePage } from '../../src/shared/global-knowledge';
import { globalArchiveApi, readGlobalDictionary } from '../../src/renderer/lib/global-knowledge-settings';

const entry = (id: string): GlobalKnowledgeEntry => ({ id, body: '雨夜里的原创范句。', source: '原创', categoryId: 'category', tagIds: [], origin: null, revision: 1, deletedAt: null, reviewed: true, sourceDocumentId: null, segmentId: null });
const page = (entries: GlobalKnowledgeEntry[], offset = 0, revision = 1): GlobalKnowledgePage => ({ libraryId: 'library', revision, entries, categories: [], tags: [], annotations: [], total: 101, offset, limit: 100 });

describe('全局知识设置读取边界', () => {
  it('读取后续分页，删除字典前包含当前卡片页外的关联', async () => {
    const first = Array.from({ length: 100 }, (_, index) => entry(String(index)));
    const readGlobalKnowledge = vi.fn().mockResolvedValueOnce(page(first)).mockResolvedValueOnce(page([entry('100')], 100));
    const result = await readGlobalDictionary({ readGlobalKnowledge });
    expect(result.entries).toHaveLength(101);
    expect(readGlobalKnowledge).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100 });
  });
  it('库版本变化时拒绝混合两次读取结果', async () => {
    const readGlobalKnowledge = vi.fn().mockResolvedValueOnce(page([entry('first')])).mockResolvedValueOnce(page([entry('second')], 1, 2));
    await expect(readGlobalDictionary({ readGlobalKnowledge })).rejects.toThrow('已更新');
  });
  it('空分页和重复条目不能无限循环', async () => {
    for (const next of [[], [entry('first')]]) {
      const readGlobalKnowledge = vi.fn().mockResolvedValueOnce(page([entry('first')])).mockResolvedValueOnce(page(next, 1));
      await expect(readGlobalDictionary({ readGlobalKnowledge })).rejects.toThrow('分页不完整');
    }
  });
  it('缺失任一归档接口时明确判定不可用', () => {
    expect(globalArchiveApi({})).toBeNull();
    expect(globalArchiveApi({ exportGlobalKnowledgeArchive: async () => true })).toBeNull();
  });
  it('归档请求保留操作身份', async () => {
    const confirm = vi.fn().mockResolvedValue(page([]));
    const api = globalArchiveApi({ exportGlobalKnowledgeArchive: async () => true, chooseGlobalKnowledgeArchive: async () => null, confirmGlobalKnowledgeArchive: confirm });
    const request = { token: 'preview-token', operationId: 'same-operation' };
    await api?.confirmGlobalKnowledgeArchive(request);
    expect(confirm).toHaveBeenCalledWith(request);
  });
});
