import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';
import { rebuildAssetSearch, refreshChapterSearch, searchAssets } from '../../src/workers/database/assets-search';
import { copyKnowledge } from '../../src/workers/database/assets-knowledge';
import { auditedKnowledgeSource } from './knowledge-source-helper';

describe('知识与正文离线搜索', () => {
  let fixture: ReturnType<typeof assetFixture>;
  beforeEach(() => { fixture = assetFixture(); rebuildAssetSearch(fixture.db); }); afterEach(() => fixture.db.close());
  it('已有库的原始审计索引首次查询即修复，普通同标记出处保留且后续查询幂等', () => {
    const { source } = auditedKnowledgeSource();
    const categoryId = fixture.state().categories[0].id;
    const state = fixture.change({ type: 'createKnowledge', body: '历史知识', source, categoryId, tagIds: [] });
    fixture.change({ type: 'createKnowledge', body: '普通知识', source: '作者附注\nAI 审核来源：普通文本', categoryId, tagIds: [] });
    fixture.db.prepare('UPDATE search_document SET source=?,normalized_text=? WHERE id=?').run(source, `历史知识\n${source}`.toLowerCase(), `k:${state.knowledge[0].id}`);
    const before = fixture.state();
    expect(searchAssets(fixture.db, { text: '上下文独有秘词', mode: 'knowledge' })).toEqual([]);
    expect(searchAssets(fixture.db, { text: '普通文本', mode: 'knowledge' })).toHaveLength(1);
    const changes = fixture.db.prepare('SELECT total_changes() AS count').get();
    expect(searchAssets(fixture.db, { text: '作者可读出处', mode: 'knowledge' })).toHaveLength(1);
    expect(fixture.db.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
    expect(fixture.state()).toEqual(before);
  });
  it('知识索引只使用可读出处，重建旧索引不改变数据库来源和历史审计', () => {
    const { source } = auditedKnowledgeSource();
    const state = fixture.change({ type: 'createKnowledge', body: '知识摘要', source, categoryId: fixture.state().categories[0].id, tagIds: [] });
    for (const rebuild of [false, true]) {
      if (rebuild) rebuildAssetSearch(fixture.db);
      expect(searchAssets(fixture.db, { text: '上下文独有秘词', mode: 'knowledge' })).toEqual([]);
      expect(searchAssets(fixture.db, { text: '作者可读出处', mode: 'knowledge' })).toEqual([expect.objectContaining({ id: state.knowledge[0].id, source: '作者可读出处' })]);
      expect(fixture.state().knowledge[0].source).toBe(source);
      expect(fixture.db.prepare('SELECT source FROM knowledge_history').get()).toEqual({ source });
    }
  });
  it('行内书签不打断连续正文搜索，只有真实换行节点拆开文本', () => {
    const document = structuredClone(fixture.document);
    document.content[0].content = [{ type: 'text', text: '灯塔' },
      { type: 'bookmark', attrs: { id: crypto.randomUUID(), kind: 'knowledge', targetId: crypto.randomUUID() } },
      { type: 'text', text: '旁边' }, { type: 'hardBreak' }, { type: 'text', text: '海岸' }];
    fixture.db.prepare('UPDATE chapter SET document_json=? WHERE id=?').run(JSON.stringify(document), fixture.chapterId);
    refreshChapterSearch(fixture.db, fixture.chapterId);
    expect(searchAssets(fixture.db, { text: '灯塔旁边', mode: 'all' })).toHaveLength(1);
    expect(searchAssets(fixture.db, { text: '旁边海岸', mode: 'all' })).toEqual([]);
    expect(searchAssets(fixture.db, { text: '海岸', mode: 'all' })[0].snippet).toBe('灯塔旁边\n海岸');
  });
  it('中文单字、双字和长词覆盖正文知识，返回真实来源与段落定位', () => {
    let state = fixture.state();
    state = fixture.change({ type: 'createKnowledge', body: '灯塔旁的海风，裹挟着雨。', source: '优秀作品', categoryId: state.categories[0].id, tagIds: [] });
    for (const text of ['雨', '灯塔', '灯塔旁']) {
      const results = searchAssets(fixture.db, { text, mode: 'all' });
      expect(results.map(r => r.kind).sort()).toEqual(['knowledge', 'paragraph']);
      expect(results.find(r => r.kind === 'paragraph')).toMatchObject({ chapterId: fixture.chapterId, paragraphId: fixture.paragraphId, title: '同名章节' });
    }
    expect(searchAssets(fixture.db, { text: '优秀作品', mode: 'knowledge' })[0].id).toBe(state.knowledge[0].id);
  });
  it('多个标签AND只过滤知识，不隐藏正文；分类筛选包含子分类', () => {
    let state = fixture.change({ type: 'createTag', name: '细节' }); const first = state.tags[0].id;
    state = fixture.change({ type: 'createTag', name: '情绪 转折' }); const second = state.tags[1].id;
    state = fixture.change({ type: 'createCategory', name: '子类', parentId: state.categories[0].id }); const categoryId = state.categories.find(c => c.name === '子类')!.id;
    state = fixture.change({ type: 'createKnowledge', body: '雨中的灯塔', source: '书A', categoryId, tagIds: [first, second] }); const expected = state.knowledge[0].id;
    fixture.change({ type: 'createKnowledge', body: '雨中的灯塔', source: '书B', categoryId, tagIds: [first] });
    const results = searchAssets(fixture.db, { text: '雨', mode: 'all', tagIds: [first, second], categoryId: state.categories[0].id });
    expect(results.filter(r => r.kind === 'knowledge').map(r => r.id)).toEqual([expected]);
    expect(results.some(r => r.kind === 'paragraph')).toBe(true);
    expect(searchAssets(fixture.db, { text: '情绪 转折', mode: 'knowledge' }).map(r => r.id)).toEqual([expected]);
    fixture.change({ type: 'deleteTag', id: second });
    expect(searchAssets(fixture.db, { text: '情绪 转折', mode: 'knowledge' })).toEqual([]);
  });
  it('引号、百分号、下划线和SQL片段按字面查询；NFC与大小写统一', () => {
    const state = fixture.state();
    fixture.change({ type: 'createKnowledge', body: '值100%_ "引用" Café ABC', source: '', categoryId: state.categories[0].id, tagIds: [] });
    for (const text of ['%', '_', '"引用"', '100%_', 'café', 'abc']) expect(searchAssets(fixture.db, { text, mode: 'knowledge' })).toHaveLength(1);
    expect(searchAssets(fixture.db, { text: "' OR 1=1 --", mode: 'all' })).toEqual([]);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM chapter').get()).toEqual({ count: 1 });
  });
  it('知识删除、正文清空/删除及时移除搜索；清空查询显示分页内容', () => {
    let state = fixture.state();
    state = fixture.change({ type: 'createKnowledge', body: '雨知识', source: '', categoryId: state.categories[0].id, tagIds: [] }); const id = state.knowledge[0].id;
    fixture.change({ type: 'deleteKnowledge', id });
    expect(searchAssets(fixture.db, { text: '雨', mode: 'knowledge' })).toEqual([]);
    fixture.db.prepare('UPDATE chapter SET deleted_at=? WHERE id=?').run(new Date().toISOString(), fixture.chapterId);
    refreshChapterSearch(fixture.db, fixture.chapterId);
    expect(searchAssets(fixture.db, { text: '', mode: 'all' })).toEqual([]);
    expect(() => searchAssets(fixture.db, { text: '', mode: 'all', limit: 0 })).toThrow();
    expect(() => searchAssets(fixture.db, { text: '', mode: 'all', tagIds: [crypto.randomUUID()] })).toThrow();
  });
  it('删章解除活跃剧情关联，同时留下真实原关联记录', () => {
    let state = fixture.change({ type: 'createOutline', kind: 'chapter', parentId: null, title: '剧情节点' }); const id = state.outlines[0].id;
    fixture.change({ type: 'updateOutline', id, title: '剧情节点', summary: '', chapterId: fixture.chapterId });
    fixture.db.prepare('UPDATE work_meta SET revision=revision+1').run();
    fixture.db.prepare('UPDATE chapter SET deleted_at=? WHERE id=?').run(new Date().toISOString(), fixture.chapterId);
    refreshChapterSearch(fixture.db, fixture.chapterId);
    state = fixture.state(); expect(state.outlines[0].chapterId).toBeNull();
    const records = fixture.db.prepare("SELECT payload_json FROM asset_history WHERE entity_kind='outline_node' AND entity_id=? AND phase='before' ORDER BY revision DESC").all(id) as { payload_json: string }[];
    expect(records.map(row => JSON.parse(row.payload_json).chapter_id)).toContain(fixture.chapterId);
  });
  it('跨作复制保持出处与来源，使用当前字典且修改互不联动', () => {
    const source = assetFixture();
    try {
      let state = source.state();
      state = source.change({ type: 'createKnowledge', body: '原素材', source: '原书', categoryId: state.categories[0].id, tagIds: [] });
      const originId = state.knowledge[0].id; const sourceWorkId = crypto.randomUUID();
      const id = fixture.db.transaction(() => copyKnowledge(fixture.db, { workId: sourceWorkId, workTitle: '来源作品', revision: 2, entry: state.knowledge[0] }, fixture.state().categories[0].id, [], 2))();
      fixture.db.prepare('UPDATE work_meta SET revision=2').run();
      rebuildAssetSearch(fixture.db);
      expect(fixture.state().knowledge[0]).toMatchObject({ id, body: '原素材', source: '原书', origin: { workId: sourceWorkId, entryId: originId, sourceRevision: 2 } });
      fixture.change({ type: 'updateKnowledge', id, body: '独立改写', source: '原书', categoryId: fixture.state().categories[0].id, tagIds: [] });
      expect(source.state().knowledge[0].body).toBe('原素材');
      expect(searchAssets(fixture.db, { text: '独立', mode: 'knowledge' })).toHaveLength(1);
    } finally { source.db.close(); }
  });
});
