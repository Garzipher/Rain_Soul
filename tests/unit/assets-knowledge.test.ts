import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';

describe('知识分类标签与版本', () => {
  let fixture: ReturnType<typeof assetFixture>;
  beforeEach(() => { fixture = assetFixture(); }); afterEach(() => fixture.db.close());
  it('层级分类禁止形成环与直接删除非空父分类，条目迁移后再删', () => {
    let state = fixture.change({ type: 'createCategory', name: '动作', parentId: null }); const parent = state.categories.find(c => c.name === '动作')!.id;
    state = fixture.change({ type: 'createCategory', name: '剑招', parentId: parent }); const child = state.categories.find(c => c.name === '剑招')!.id;
    expect(() => fixture.change({ type: 'updateCategory', id: parent, name: '动作', parentId: child })).toThrow(/环/);
    expect(() => fixture.change({ type: 'deleteCategory', id: parent, destinationId: state.categories[0].id })).toThrow(/子分类/);
    state = fixture.change({ type: 'createKnowledge', body: '一剑划破长夜。', source: '某作品', categoryId: child, tagIds: [] });
    expect(() => fixture.change({ type: 'deleteCategory', id: child, destinationId: null })).toThrow(/迁移/);
    state = fixture.change({ type: 'deleteCategory', id: child, destinationId: state.categories[0].id });
    expect(state.knowledge[0].categoryId).toBe(state.categories[0].id);
    expect(state.categories.find(c => c.id === child)?.deletedAt).not.toBeNull();
    expect(() => fixture.change({ type: 'deleteCategory', id: state.categories[0].id, destinationId: parent })).toThrow(/未分类/);
    expect(() => fixture.change({ type: 'updateCategory', id: state.categories[0].id, name: '改掉保留项', parentId: null })).toThrow(/未分类/);
  });
  it('字典排序与移动按父级隔离，父级不存在不能自动创建', () => {
    let state = fixture.change({ type: 'createCategory', name: 'A', parentId: null }); const id = state.categories.find(c => c.name === 'A')!.id;
    state = fixture.change({ type: 'moveCategory', id, direction: 'up' });
    expect(state.categories.find(c => c.id === id)?.sortOrder).toBe(5);
    state = fixture.change({ type: 'updateCategory', id, name: 'A改名', parentId: state.categories[0].id });
    expect(state.categories.find(c => c.id === id)?.parentId).toBe(state.categories[0].id);
    expect(() => fixture.change({ type: 'createCategory', name: '错', parentId: crypto.randomUUID() })).toThrow();
  });
  it('条目多个标签保持名称内空格，编辑留历史，删除保留完整正文与出处', () => {
    let state = fixture.change({ type: 'createTag', name: '情绪 转折' }); const tagId = state.tags[0].id;
    expect(() => fixture.change({ type: 'createTag', name: ' 情绪 转折 ' })).toThrow(/标签/);
    state = fixture.change({ type: 'createKnowledge', body: '旧描写', source: '原书', categoryId: state.categories[0].id, tagIds: [tagId] }); const id = state.knowledge[0].id;
    state = fixture.change({ type: 'updateKnowledge', id, body: '新描写', source: '新书', categoryId: state.categories[0].id, tagIds: [tagId] });
    expect(fixture.db.prepare('SELECT body FROM knowledge_history WHERE entry_id=? ORDER BY revision').all(id)).toEqual([{ body: '旧描写' }, { body: '新描写' }]);
    state = fixture.change({ type: 'deleteTag', id: tagId }); expect(state.knowledge[0].tagIds).toEqual([]); expect(state.knowledge[0].body).toBe('新描写');
    state = fixture.change({ type: 'deleteKnowledge', id });
    expect(state.knowledge[0]).toMatchObject({ body: '新描写', source: '新书', deletedAt: expect.any(String) });
    expect(() => fixture.change({ type: 'updateKnowledge', id, body: '覆盖删除', source: '', categoryId: state.categories[0].id, tagIds: [] })).toThrow();
  });
  it('不存在的分类标签与重复选择整笔回滚，不留下半份正文或关系', () => {
    const state = fixture.state();
    for (const action of [
      { type: 'createKnowledge', body: '半份', source: '', categoryId: crypto.randomUUID(), tagIds: [] },
      { type: 'createKnowledge', body: '半份', source: '', categoryId: state.categories[0].id, tagIds: [crypto.randomUUID()] },
    ] as const) {
      expect(() => fixture.change({ ...action, tagIds: [...action.tagIds] })).toThrow();
    }
    expect(fixture.state().knowledge).toEqual([]);
  });
  it('写作特点版本不可变，章覆盖独立于作品默认并可解除', () => {
    const payload = { narrativePerson: '第三人称', pace: '舒缓', prohibited: ['堆砌比喻'], referenceWorks: ['参考A'] };
    let state = fixture.change({ type: 'publishStyle', payload }); const original = state.styleProfiles[0].id;
    fixture.change({ type: 'setChapterStyle', chapterId: fixture.chapterId, profileId: original });
    state = fixture.change({ type: 'publishStyle', payload: { ...payload, pace: '紧凑' } });
    expect(state.defaultStyleId).toBe(state.styleProfiles[1].id);
    expect(state.styleProfiles[0].payload.pace).toBe('舒缓');
    expect(state.chapterStyles).toEqual([{ chapterId: fixture.chapterId, profileId: original }]);
    state = fixture.change({ type: 'setChapterStyle', chapterId: fixture.chapterId, profileId: null }); expect(state.chapterStyles).toEqual([]);
    expect(() => fixture.change({ type: 'setChapterStyle', chapterId: fixture.chapterId, profileId: crypto.randomUUID() })).toThrow();
  });
});
