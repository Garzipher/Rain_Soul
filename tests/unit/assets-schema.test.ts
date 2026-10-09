import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { projectSchema } from '../../src/workers/database/project-schema';
import { initializeAssetsSchema } from '../../src/workers/database/assets-schema';
import { assetActionSchema } from '../../src/shared/assets-schema';

describe('作品资产 schema', () => {
  it('默认分类确定性初始化，不污染其他作品且未分类固定保留', () => {
    const first = new Database(':memory:'); const second = new Database(':memory:');
    try {
      first.exec(projectSchema); second.exec(projectSchema);
      initializeAssetsSchema(first); initializeAssetsSchema(second);
      const categories = first.prepare('SELECT * FROM category ORDER BY sort_order').all();
      expect(categories).toEqual(second.prepare('SELECT * FROM category ORDER BY sort_order').all());
      expect(categories).toHaveLength(6);
      expect(categories[0]).toMatchObject({ name: '未分类', system_key: 'uncategorized' });
      expect(first.prepare("SELECT name FROM sqlite_master WHERE name='search_fts'").get()).toBeDefined();
    } finally { first.close(); second.close(); }
  });
  it('严格拒绝额外字段、伪造ID、重复多选和不存在的状态', () => {
    expect(assetActionSchema.safeParse({ type: 'createTag', name: '带 空格', path: 'x' }).success).toBe(false);
    expect(assetActionSchema.safeParse({ type: 'deleteOutline', id: '同名剧情' }).success).toBe(false);
    const id = crypto.randomUUID();
    expect(assetActionSchema.safeParse({ type: 'setOutlineKnowledge', id, knowledgeIds: [id, id] }).success).toBe(false);
    expect(assetActionSchema.safeParse({ type: 'updateForeshadow', id, name: '伏笔', description: '', status: '自动完结', outlineId: null }).success).toBe(false);
    expect(assetActionSchema.parse({ type: 'createTag', name: '  情绪 转折  ' })).toMatchObject({ name: '情绪 转折' });
  });
});
