import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assetFixture } from './assets-helper';
import { initializeSnapshots, listSnapshots, restoreSnapshot } from '../../src/workers/database/snapshots';
import { applyAiCandidate, approveAiKnowledge } from '../../src/workers/database/ai-apply';
import { refreshChapterSearch, searchAssets } from '../../src/workers/database/assets-search';
import { countDocumentWords } from '../../src/shared/document';
import type { AiCandidate } from '../../src/shared/ai';
import type { WritingDocument } from '../../src/shared/contracts';

describe('AI 作者确认写入事务', () => {
  let fixture: ReturnType<typeof assetFixture>;
  const revision = () => (fixture.db.prepare('SELECT revision FROM work_meta').get() as { revision: number }).revision;
  const document = () => JSON.parse((fixture.db.prepare('SELECT document_json FROM chapter WHERE id=?').get(fixture.chapterId) as { document_json: string }).document_json) as WritingDocument;
  const candidate = (operation: AiCandidate['operation'] = 'paragraphPolish'): AiCandidate => ({
    id: randomUUID(), operation, workId: (fixture.db.prepare('SELECT id FROM work_meta').get() as { id: string }).id,
    baselineRevision: revision(), paragraphIds: [fixture.paragraphId], text: '新描写\n第二段', requestHash: 'a'.repeat(64), createdAt: new Date().toISOString(),
  });
  beforeEach(() => { fixture = assetFixture(); initializeSnapshots(fixture.db); refreshChapterSearch(fixture.db, fixture.chapterId); });
  afterEach(() => fixture.db.close());
  it('审核可以指定作品内分类和标签，失效或跨作品字典不得留下部分数据', () => {
    const state = fixture.change({ type: 'createTag', name: '雨夜' });
    const input = candidate('extractKnowledge'), categoryId = state.categories[0].id, tagIds = [state.tags[0].id];
    approveAiKnowledge(fixture.db, input, [{ body: '审核角色', source: '作者正文', categoryId, tagIds }], randomUUID());
    expect(fixture.state().knowledge[0]).toMatchObject({ categoryId, tagIds });
    const before = fixture.state().knowledge, snapshots = listSnapshots(fixture.db);
    expect(() => approveAiKnowledge(fixture.db, candidate('extractKnowledge'), [{ body: '无效分类', source: '', categoryId: randomUUID() }], randomUUID())).toThrow();
    expect(() => approveAiKnowledge(fixture.db, candidate('extractKnowledge'), [{ body: '重复标签', source: '', tagIds: [...tagIds, ...tagIds] }], randomUUID())).toThrow();
    expect(fixture.state().knowledge).toEqual(before); expect(listSnapshots(fixture.db)).toEqual(snapshots);
  });
  it('替换连续段落保留首段身份和全部书签，先安全快照，再计字索引与单次版本更新', () => {
    const state = fixture.change({ type: 'createKnowledge', body: '可用描写', source: '原书', categoryId: fixture.state().categories[0].id, tagIds: [] });
    const before = document(), second = randomUUID(), untouched = randomUUID();
    const bookmarks = [0, 1].map(() => ({ type: 'bookmark' as const, attrs: { id: randomUUID(), kind: 'knowledge' as const, targetId: state.knowledge[0].id } }));
    before.content[0].content!.push(bookmarks[0]);
    before.content.push({ type: 'paragraph', attrs: { id: second }, content: [{ type: 'text', text: '待替换第二段' }, bookmarks[1]] }, { type: 'paragraph', attrs: { id: untouched }, content: [{ type: 'text', text: '保持原样' }] });
    fixture.db.prepare('UPDATE chapter SET document_json=? WHERE id=?').run(JSON.stringify(before), fixture.chapterId);
    const input = candidate(); input.paragraphIds.push(second); const oldRevision = revision();
    applyAiCandidate(fixture.db, input, randomUUID());
    const after = document();
    expect(after.content[0].attrs.id).toBe(fixture.paragraphId); expect(after.content.map(p => p.attrs.id)).not.toContain(second);
    expect(after.content[0].content?.filter(node => node.type === 'bookmark')).toEqual(bookmarks);
    expect(after.content.at(-1)).toEqual(before.content.at(-1));
    expect(revision()).toBe(oldRevision + 1); expect(listSnapshots(fixture.db)).toHaveLength(1);
    expect((fixture.db.prepare('SELECT word_count FROM chapter').get() as { word_count: number }).word_count).toBe(countDocumentWords(after));
    expect(searchAssets(fixture.db, { text: '新描写', mode: 'all' })).toHaveLength(1);
    restoreSnapshot(fixture.db, listSnapshots(fixture.db)[0].id, revision()); expect(document()).toEqual(before);
  });
  it('续写插入在目标段落之后，保留原段落和书签且HTML仅为普通文字', () => {
    const before = document(), input = candidate('continue'); input.text = '<script>不能执行</script>\r\n续写';
    applyAiCandidate(fixture.db, input, randomUUID());
    const after = document(); expect(after.content[0]).toEqual(before.content[0]);
    expect(after.content[1].content).toEqual([{ type: 'text', text: '<script>不能执行</script>' }]);
    expect(after.content[2].content).toEqual([{ type: 'text', text: '续写' }]);
  });
  it('相同操作重放不重复写入快照，换请求内容拒绝；相同候选不允许另一个操作再次覆盖', () => {
    const input = candidate(), id = randomUUID(); applyAiCandidate(fixture.db, input, id);
    applyAiCandidate(fixture.db, input, id); expect(revision()).toBe(2); expect(listSnapshots(fixture.db)).toHaveLength(1);
    expect(() => applyAiCandidate(fixture.db, { ...input, text: '不同结果' }, id)).toThrow(/标识/);
    expect(() => applyAiCandidate(fixture.db, input, randomUUID())).toThrow(/版本/);
  });
  it.each(['sentencePolish', 'consistency', 'plotFeel', 'extractKnowledge'] as const)('分析或无精确选区操作 %s 不能写正文', operation => {
    const before = document(); expect(() => applyAiCandidate(fixture.db, candidate(operation), randomUUID())).toThrow(/操作|正文|选区/);
    expect(document()).toEqual(before); expect(revision()).toBe(1); expect(listSnapshots(fixture.db)).toEqual([]);
  });
  it('失效版本、异作、删除作品、缺段落、不连续与跨章目标一律不改稿', () => {
    const initial = candidate(), second = randomUUID(), third = randomUUID();
    const before = document(); before.content.push({ type: 'paragraph', attrs: { id: second }, content: [] }, { type: 'paragraph', attrs: { id: third }, content: [] });
    fixture.db.prepare('UPDATE chapter SET document_json=?').run(JSON.stringify(before));
    for (const input of [{ ...initial, baselineRevision: 3 }, { ...initial, workId: randomUUID() }, { ...initial, paragraphIds: [randomUUID()] }, { ...initial, paragraphIds: [fixture.paragraphId, third] }, { ...initial, paragraphIds: [second, fixture.paragraphId] }]) expect(() => applyAiCandidate(fixture.db, input, randomUUID())).toThrow();
    const other = randomUUID(), otherParagraph = randomUUID();
    fixture.db.prepare('INSERT INTO chapter(id,title,document_json,word_count,sort_order) VALUES(?,?,?,?,?)').run(other, '另章', JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: otherParagraph }, content: [] }] }), 0, 1);
    expect(() => applyAiCandidate(fixture.db, { ...initial, paragraphIds: [fixture.paragraphId, otherParagraph] }, randomUUID())).toThrow(/同一章/);
    fixture.db.prepare('UPDATE work_meta SET deleted_at=?').run('已删除'); expect(() => applyAiCandidate(fixture.db, initial, randomUUID())).toThrow(/作品/);
    expect(document()).toEqual(before); expect(listSnapshots(fixture.db)).toEqual([]);
  });
  it('写正文失败事务回滚安全快照、版本、正文和操作回执', () => {
    const before = document(); fixture.db.exec("CREATE TRIGGER reject_ai BEFORE UPDATE ON chapter BEGIN SELECT RAISE(ABORT,'模拟写入失败'); END;");
    expect(() => applyAiCandidate(fixture.db, candidate(), randomUUID())).toThrow(/写入失败/);
    expect(document()).toEqual(before); expect(revision()).toBe(1); expect(listSnapshots(fixture.db)).toEqual([]);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM operation_log').get()).toEqual({ count: 0 });
  });
  it('逐条审核提取候选才入未分类知识，保留原候选与正文证据，幂等且不改正文', () => {
    const input = candidate('extractKnowledge'), before = document(), operationId = randomUUID();
    const items = [{ body: '作者审核过的摘要', source: '补充出处' }, { body: '角色信息', source: '' }];
    approveAiKnowledge(fixture.db, input, items, operationId); approveAiKnowledge(fixture.db, input, items, operationId);
    const entries = fixture.state().knowledge; expect(entries).toHaveLength(2); expect(document()).toEqual(before); expect(revision()).toBe(2);
    expect(entries.every(item => item.categoryId === fixture.state().categories[0].id)).toBe(true);
    expect(JSON.parse(entries[0].source.split('AI 审核来源：')[1]).candidateText).toBe(input.text); expect(entries[0].source).toContain(fixture.paragraphId); expect(entries[0].source).toContain('同名章节');
    expect(entries[0].source).toContain('灯塔旁，雨落下来。'); expect(listSnapshots(fixture.db)).toHaveLength(1);
    expect(() => approveAiKnowledge(fixture.db, input, [{ body: '更改条目', source: '' }], operationId)).toThrow(/标识/);
  });
  it('未审核、非提取操作、超限和非法候选不得入库，入库失败全部回滚', () => {
    const input = candidate('extractKnowledge');
    expect(() => approveAiKnowledge(fixture.db, input, [], randomUUID())).toThrow();
    expect(() => approveAiKnowledge(fixture.db, candidate('continue'), [{ body: '摘要', source: '' }], randomUUID())).toThrow(/提取/);
    for (const value of [{ ...input, text: '' }, { ...input, extra: '未知' }, { ...input, text: 'x'.repeat(2000001) }]) expect(() => applyAiCandidate(fixture.db, value, randomUUID())).toThrow();
    fixture.db.exec("CREATE TRIGGER reject_knowledge BEFORE INSERT ON knowledge_entry WHEN NEW.body='失败' BEGIN SELECT RAISE(ABORT,'模拟知识失败'); END;");
    expect(() => approveAiKnowledge(fixture.db, input, [{ body: '先入', source: '' }, { body: '失败', source: '' }], randomUUID())).toThrow(/知识失败/);
    expect(fixture.state().knowledge).toEqual([]); expect(revision()).toBe(1); expect(listSnapshots(fixture.db)).toEqual([]);
  });
  it('知识来源可以跨章，失效来源和缺少未分类时全部回滚', () => {
    const other = randomUUID(), paragraphId = randomUUID();
    fixture.db.prepare('INSERT INTO chapter(id,title,document_json,word_count,sort_order) VALUES(?,?,?,?,?)').run(other, '另一章节', JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: paragraphId }, content: [{ type: 'text', text: '跨章证据' }] }] }), 4, 1);
    const input = candidate('extractKnowledge'); input.paragraphIds.push(paragraphId);
    approveAiKnowledge(fixture.db, input, [{ body: '跨章总结', source: '作者审核' }], randomUUID());
    const source = fixture.state().knowledge[0].source; expect(source).toContain('另一章节'); expect(source).toContain('跨章证据');
    const next = candidate('extractKnowledge'); next.paragraphIds = [randomUUID()];
    expect(() => approveAiKnowledge(fixture.db, next, [{ body: '失效提取', source: '' }], randomUUID())).toThrow(/段落/);
    fixture.db.prepare("UPDATE category SET deleted_at='失效' WHERE system_key='uncategorized'").run();
    expect(() => approveAiKnowledge(fixture.db, candidate('extractKnowledge'), [{ body: '没有分类', source: '' }], randomUUID())).toThrow(/未分类/);
    expect(fixture.state().knowledge).toHaveLength(1); expect(revision()).toBe(2); expect(listSnapshots(fixture.db)).toHaveLength(1);
  });
  it('操作ID或目标身份重复拒绝，快照失败时不得先修改原稿', () => {
    expect(() => applyAiCandidate(fixture.db, candidate(), '任意ID')).toThrow(/标识/);
    const duplicate = randomUUID();
    fixture.db.prepare('INSERT INTO chapter(id,title,document_json,word_count,sort_order) VALUES(?,?,?,?,?)').run(duplicate, '身份重复章', JSON.stringify(document()), 8, 1);
    expect(() => applyAiCandidate(fixture.db, candidate(), randomUUID())).toThrow(/身份重复/);
    fixture.db.prepare('DELETE FROM chapter WHERE id=?').run(duplicate);
    fixture.db.exec("CREATE TRIGGER reject_snapshot BEFORE INSERT ON snapshot BEGIN SELECT RAISE(ABORT,'模拟快照失败'); END;");
    const before = document(); expect(() => applyAiCandidate(fixture.db, candidate(), randomUUID())).toThrow(/快照失败/);
    expect(document()).toEqual(before); expect(revision()).toBe(1); expect(listSnapshots(fixture.db)).toEqual([]);
  });
  it('单句精确替换跨文本节点，只修改选区并保留前后正文、书签、换行及段落ID', () => {
    const before = document(), bookmark = { type: 'bookmark' as const, attrs: { id: randomUUID(), kind: 'knowledge' as const, targetId: randomUUID() } };
    before.content[0].content = [{ type: 'text', text: '前文。旧' }, bookmark, { type: 'text', text: '句子。后文。' }, { type: 'hardBreak' }, { type: 'text', text: '下一行。' }];
    fixture.db.prepare('UPDATE chapter SET document_json=?').run(JSON.stringify(before));
    const input = { ...candidate('sentencePolish'), text: '新句子。', selection: { paragraphId: fixture.paragraphId, from: 3, to: 7, text: '旧句子。' } };
    applyAiCandidate(fixture.db, input, randomUUID());
    const after = document();
    expect(after.content).toHaveLength(1); expect(after.content[0].attrs.id).toBe(fixture.paragraphId);
    expect(after.content[0].content).toEqual([{ type: 'text', text: '前文。' }, { type: 'text', text: '新句子。' }, bookmark, { type: 'text', text: '后文。' }, { type: 'hardBreak' }, { type: 'text', text: '下一行。' }]);
    expect(revision()).toBe(2); expect(listSnapshots(fixture.db)).toHaveLength(1);
    restoreSnapshot(fixture.db, listSnapshots(fixture.db)[0].id, revision()); expect(document()).toEqual(before);
  });
  it('单句拒绝错段、跨段、范围失效、空或半个代理字符选区和换行候选，原稿不变', () => {
    const before = document(); before.content[0].content = [{ type: 'text', text: '前😀旧句。后' }];
    fixture.db.prepare('UPDATE chapter SET document_json=?').run(JSON.stringify(before));
    const input = { ...candidate('sentencePolish'), text: '新句。', selection: { paragraphId: fixture.paragraphId, from: 3, to: 6, text: '旧句。' } };
    for (const invalid of [
      { ...input, selection: { ...input.selection, paragraphId: randomUUID() } },
      { ...input, paragraphIds: [fixture.paragraphId, randomUUID()] },
      { ...input, selection: { ...input.selection, from: 3, to: 3, text: '' } },
      { ...input, selection: { ...input.selection, to: 100 } },
      { ...input, selection: { ...input.selection, text: '旧内容已变' } },
      { ...input, selection: { ...input.selection, from: 2, to: 3, text: '\ude00' } },
      { ...input, selection: { ...input.selection, from: 1, to: 2, text: '\ud83d' } },
      { ...input, text: '新句\n另一句' },
      { ...input, operation: 'paragraphPolish' as const },
    ]) expect(() => applyAiCandidate(fixture.db, invalid, randomUUID())).toThrow();
    expect(document()).toEqual(before); expect(revision()).toBe(1); expect(listSnapshots(fixture.db)).toEqual([]);
    applyAiCandidate(fixture.db, input, randomUUID());
    expect(document().content[0].content?.map(node => node.type === 'text' ? node.text : '').join('')).toBe('前😀新句。后');
  });
  it('单句以UTF16计数包含硬换行位置，选区前后书签保持原序，不能跨换行', () => {
    const before = document(), first = { type: 'bookmark' as const, attrs: { id: randomUUID(), kind: 'foreshadow' as const, targetId: randomUUID() } }, last = { ...first, attrs: { ...first.attrs, id: randomUUID() } };
    before.content[0].content = [first, { type: 'text', text: '第一行' }, { type: 'hardBreak' }, { type: 'text', text: '旧句。' }, last];
    fixture.db.prepare('UPDATE chapter SET document_json=?').run(JSON.stringify(before));
    const invalid = { ...candidate('sentencePolish'), text: '新句。', selection: { paragraphId: fixture.paragraphId, from: 2, to: 7, text: '行\n旧句。' } };
    expect(() => applyAiCandidate(fixture.db, invalid, randomUUID())).toThrow(/换行/); expect(listSnapshots(fixture.db)).toEqual([]);
    const input = { ...candidate('sentencePolish'), text: '新句。', selection: { paragraphId: fixture.paragraphId, from: 4, to: 7, text: '旧句。' } };
    const operationId = randomUUID(); applyAiCandidate(fixture.db, input, operationId); applyAiCandidate(fixture.db, input, operationId);
    expect(document().content[0].content).toEqual([first, { type: 'text', text: '第一行' }, { type: 'hardBreak' }, { type: 'text', text: '新句。' }, last]);
    expect(listSnapshots(fixture.db)).toHaveLength(1); expect(revision()).toBe(2);
  });
});
