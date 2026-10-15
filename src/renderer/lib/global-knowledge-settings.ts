import type { GlobalKnowledgeApi, GlobalKnowledgeEntry, GlobalKnowledgePage } from '../../shared/global-knowledge';

export type GlobalArchiveApi = Pick<GlobalKnowledgeApi, 'exportGlobalKnowledgeArchive' | 'chooseGlobalKnowledgeArchive' | 'confirmGlobalKnowledgeArchive'>;

/** 旧版预加载层仍可打开设置，但不能把缺失命令当成可调用接口。 */
export function globalArchiveApi(api: Partial<GlobalKnowledgeApi>): GlobalArchiveApi | null {
  if (!api.exportGlobalKnowledgeArchive || !api.chooseGlobalKnowledgeArchive || !api.confirmGlobalKnowledgeArchive) return null;
  return {
    exportGlobalKnowledgeArchive: () => api.exportGlobalKnowledgeArchive!(),
    chooseGlobalKnowledgeArchive: () => api.chooseGlobalKnowledgeArchive!(),
    confirmGlobalKnowledgeArchive: request => api.confirmGlobalKnowledgeArchive!(request),
  };
}

/** 字典删除前读取完整关联，不能用知识页的当前一页判断分类是否为空。 */
export async function readGlobalDictionary(api: Pick<GlobalKnowledgeApi, 'readGlobalKnowledge'>): Promise<GlobalKnowledgePage> {
  const first = await api.readGlobalKnowledge({ limit: 100, offset: 0 });
  const entries: GlobalKnowledgeEntry[] = [...first.entries];
  const ids = new Set(entries.map(entry => entry.id));
  while (entries.length < first.total) {
    const next = await api.readGlobalKnowledge({ limit: 100, offset: entries.length });
    if (next.libraryId !== first.libraryId || next.revision !== first.revision || next.total !== first.total) throw new Error('全局知识库已更新，请重新读取分类关联。');
    if (!next.entries.length || next.entries.some(entry => ids.has(entry.id))) throw new Error('全局知识分页不完整，请重新读取。');
    next.entries.forEach(entry => { entries.push(entry); ids.add(entry.id); });
  }
  return { ...first, entries, offset: 0, limit: entries.length || 100 };
}
