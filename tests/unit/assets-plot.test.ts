import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';

describe('剧情与伏笔正式资产', () => {
  let fixture: ReturnType<typeof assetFixture>;
  beforeEach(() => { fixture = assetFixture(); }); afterEach(() => fixture.db.close());
  it('剧情卷章节详细树保持顺序，父级类型不合法不得创建', () => {
    let state = fixture.change({ type: 'createOutline', kind: 'volume', parentId: null, title: '第一卷剧情' });
    const volume = state.outlines[0].id;
    state = fixture.change({ type: 'createOutline', kind: 'chapter', parentId: volume, title: '章剧情' }); const chapter = state.outlines.find(n => n.type === 'chapter')!.id;
    fixture.change({ type: 'createOutline', kind: 'detail', parentId: chapter, title: '细节A' });
    state = fixture.change({ type: 'createOutline', kind: 'detail', parentId: chapter, title: '细节B' });
    const detail = state.outlines.find(n => n.title === '细节B')!.id;
    state = fixture.change({ type: 'moveOutline', id: detail, direction: 'up' });
    expect(state.outlines.filter(n => n.parentId === chapter).map(n => n.title)).toEqual(['细节B', '细节A']);
    expect(() => fixture.change({ type: 'createOutline', kind: 'detail', parentId: volume, title: '错层' })).toThrow();
    expect(() => fixture.change({ type: 'createOutline', kind: 'volume', parentId: chapter, title: '错层' })).toThrow();
    expect(() => fixture.change({ type: 'createOutline', kind: 'detail', parentId: null, title: '无章' })).toThrow();
  });
  it('多选关联知识并迁移伏笔，删除剧情子树只解除关系', () => {
    let state = fixture.change({ type: 'createOutline', kind: 'chapter', parentId: null, title: 'A' }); const first = state.outlines[0].id;
    state = fixture.change({ type: 'createOutline', kind: 'chapter', parentId: null, title: 'B' }); const second = state.outlines[1].id;
    state = fixture.change({ type: 'createKnowledge', body: '优秀描写', source: '书名', categoryId: state.categories[0].id, tagIds: [] }); const knowledgeId = state.knowledge[0].id;
    state = fixture.change({ type: 'createForeshadow', name: '灯塔' }); const foreshadowId = state.foreshadows[0].id;
    fixture.change({ type: 'setOutlineKnowledge', id: first, knowledgeIds: [knowledgeId] });
    fixture.change({ type: 'assignForeshadows', id: first, foreshadowIds: [foreshadowId] });
    state = fixture.change({ type: 'assignForeshadows', id: second, foreshadowIds: [foreshadowId] });
    expect(state.foreshadows[0].outlineId).toBe(second);
    state = fixture.change({ type: 'deleteOutline', id: second });
    expect(state.foreshadows[0].outlineId).toBeNull(); expect(state.knowledge[0].body).toBe('优秀描写');
    expect(state.outlines.find(n => n.id === second)?.deletedAt).not.toBeNull();
    fixture.change({ type: 'assignForeshadows', id: first, foreshadowIds: [] });
    expect(() => fixture.change({ type: 'assignForeshadows', id: first, foreshadowIds: [crypto.randomUUID()] })).toThrow();
    expect(fixture.state().outlines[0].knowledgeIds).toEqual([knowledgeId]);
    const history = fixture.db.prepare("SELECT payload_json FROM asset_history WHERE entity_kind='foreshadow' AND entity_id=? AND phase='before' ORDER BY revision DESC LIMIT 1").get(foreshadowId) as { payload_json: string };
    expect(JSON.parse(history.payload_json).outline_id).toBe(second);
  });
  it('剧情章节关联使用稳定 ID，跨作对象和删除章不能关联', () => {
    const state = fixture.change({ type: 'createOutline', kind: 'chapter', parentId: null, title: '剧情' }); const id = state.outlines[0].id;
    fixture.change({ type: 'updateOutline', id, title: '改名', summary: '摘要', chapterId: fixture.chapterId });
    expect(() => fixture.change({ type: 'updateOutline', id, title: '错章', summary: '', chapterId: crypto.randomUUID() })).toThrow();
    fixture.db.prepare('UPDATE chapter SET deleted_at=? WHERE id=?').run(new Date().toISOString(), fixture.chapterId);
    expect(() => fixture.change({ type: 'updateOutline', id, title: '错章', summary: '', chapterId: fixture.chapterId })).toThrow();
    expect(fixture.state().outlines[0].title).toBe('改名');
  });
  it('伏笔五状态可手动变更，删除保留证据，恢复不擅自恢复剧情归属', () => {
    let state = fixture.change({ type: 'createForeshadow', name: '未说明约定' }); const id = state.foreshadows[0].id;
    for (const status of ['已埋设', '已触发', '已回收', '废弃', '未埋设'] as const) {
      state = fixture.change({ type: 'updateForeshadow', id, name: '约定', status, description: '说明', outlineId: null });
      expect(state.foreshadows[0].status).toBe(status); expect(state.evidence).toEqual([]);
    }
    fixture.change({ type: 'addEvidence', foreshadowId: id, kind: '埋设', chapterId: fixture.chapterId, paragraphId: fixture.paragraphId, excerpt: '雨落下来' });
    state = fixture.change({ type: 'deleteForeshadow', id });
    expect(state.evidence).toHaveLength(1); expect(state.foreshadows[0].deletedAt).not.toBeNull();
    state = fixture.change({ type: 'restoreForeshadow', id }); expect(state.foreshadows[0].deletedAt).toBeNull();
  });
});
