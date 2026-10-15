import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { GlobalKnowledgeAction } from '../../shared/global-knowledge';
import { fail, putCategory, putEntry, putTag, readCategories, readEntries, readTags } from './records';

export function applyGlobalAction(db: Database.Database, action: GlobalKnowledgeAction): void {
  const categories = readCategories(db).filter(item => !item.deletedAt), tags = readTags(db).filter(item => !item.deletedAt);
  const category = (id: string) => categories.find(item => item.id === id) ?? fail('分类不存在或已删除。', 'NOT_FOUND');
  const entry = (id: string) => readEntries(db).find(item => item.id === id && !item.deletedAt) ?? fail('条目不存在或已删除。', 'NOT_FOUND');
  const checkCategory = (name: string, parentId: string | null, except?: string) => {
    if (parentId) category(parentId);
    if (categories.some(item => item.id !== except && item.parentId === parentId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail('同级分类名称不能重复。');
    const visited = new Set<string>(); let cursor = parentId;
    while (cursor) { if (cursor === except || visited.has(cursor)) fail('分类不能形成循环。'); visited.add(cursor); cursor = category(cursor).parentId; }
  };
  const checkEntry = (value: { categoryId: string; tagIds: string[] }) => { category(value.categoryId); if (value.tagIds.some(id => !tags.some(tag => tag.id === id))) fail('标签不存在或已删除。'); };
  switch (action.type) {
    case 'createCategory': checkCategory(action.name, action.parentId); putCategory(db, { id: randomUUID(), name: action.name, parentId: action.parentId, sortOrder: categories.length, systemKey: null, deletedAt: null }); break;
    case 'updateCategory': { const previous = category(action.id); checkCategory(action.name, action.parentId, action.id); putCategory(db, { ...previous, name: action.name, parentId: action.parentId }); break; }
    case 'moveCategory': {
      const current = category(action.id), siblings = categories.filter(item => item.parentId === current.parentId), index = siblings.findIndex(item => item.id === current.id), next = siblings[index + (action.direction === 'up' ? -1 : 1)];
      if (next) { putCategory(db, { ...current, sortOrder: next.sortOrder }); putCategory(db, { ...next, sortOrder: current.sortOrder }); } break;
    }
    case 'deleteCategory': {
      const current = category(action.id); if (current.systemKey === 'uncategorized') fail('未分类是必要的归档位置，不能删除。');
      const destination = action.destinationId ? category(action.destinationId) : categories.find(item => item.systemKey === 'uncategorized')!;
      let cursor: string | null = destination.id; const visited = new Set<string>();
      while (cursor) { if (cursor === current.id || visited.has(cursor)) fail('不能迁移到待删除分类及其子分类。'); visited.add(cursor); cursor = category(cursor).parentId; }
      for (const child of categories.filter(item => item.parentId === current.id)) { checkCategory(child.name, current.parentId, child.id); putCategory(db, { ...child, parentId: current.parentId }); }
      for (const item of readEntries(db).filter(item => item.categoryId === current.id)) putEntry(db, { ...item, categoryId: destination.id, revision: item.revision + 1 });
      putCategory(db, { ...current, deletedAt: new Date().toISOString() }); break;
    }
    case 'createTag': if (tags.some(item => item.name.toLocaleLowerCase() === action.name.toLocaleLowerCase())) fail('标签名称不能重复。'); else putTag(db, { id: randomUUID(), name: action.name, deletedAt: null }); break;
    case 'deleteTag': {
      const current = tags.find(item => item.id === action.id) ?? fail('标签不存在。', 'NOT_FOUND'); putTag(db, { ...current, deletedAt: new Date().toISOString() });
      for (const item of readEntries(db).filter(item => item.tagIds.includes(action.id))) putEntry(db, { ...item, tagIds: item.tagIds.filter(id => id !== action.id), revision: item.revision + 1 }); break;
    }
    case 'createKnowledge': checkEntry(action); putEntry(db, { id: randomUUID(), body: action.body, source: action.source, categoryId: action.categoryId, tagIds: action.tagIds, revision: 1, origin: null, reviewed: true, deletedAt: null, sourceDocumentId: null, segmentId: null }); break;
    case 'updateKnowledge': {
      const previous = entry(action.id); checkEntry(action);
      if (previous.sourceDocumentId && (previous.body !== action.body || previous.source !== action.source)) fail('已核实摘录的原文和出处不可修改，请另建个人条目。');
      putEntry(db, { ...previous, body: action.body, source: action.source, categoryId: action.categoryId, tagIds: action.tagIds, revision: previous.revision + 1 }); break;
    }
    case 'deleteKnowledge': { const previous = entry(action.id); putEntry(db, { ...previous, deletedAt: new Date().toISOString(), revision: previous.revision + 1 }); break; }
  }
}
