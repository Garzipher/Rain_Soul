import { expect, it } from 'vitest';
import { buildAiReferences } from '../../src/shared/ai-reference';
import type { WorkDetail } from '../../src/shared/contracts';
import type { OutlineNode } from '../../src/shared/assets';
import { auditedKnowledgeSource } from './knowledge-source-helper';
it('自动匹配和显式选择知识均只发送可读出处，不再次发送审计上下文', () => {
  const { source } = auditedKnowledgeSource();
  const work = { chapters: [], assets: { knowledge: [{ id: 'k', body: '雨夜摘要', source, deletedAt: null }], chapterStyles: [], styleProfiles: [], outlines: [], foreshadows: [], evidence: [] } } as unknown as WorkDetail;
  for (const ids of [undefined, ['k']]) {
    const references = buildAiReferences(work, 'chapter', '雨夜', ['chapter'], ids);
    expect(references).toContain('雨夜摘要'); expect(references).toContain('出处：作者可读出处');
    expect(references).not.toContain('上下文独有秘词'); expect(references).not.toContain('AI 审核来源');
  }
  expect(work.assets!.knowledge[0].source).toBe(source);
});
it('本作品关键词参考保留出处，软删知识不进入AI，采用章节覆盖的写作特点', () => {
    const work: WorkDetail = { id: 'work', title: '雨', revision: 1, chapters: [], volumes: [], deletedItems: [], assets: { outlines: [], foreshadows: [], evidence: [], categories: [], tags: [], chapterStyles: [{ chapterId: 'chapter', profileId: 'old' }], defaultStyleId: 'new', styleProfiles: [
      { id: 'old', version: 1, payload: { narrativePerson: '第一人称', pace: '舒缓', prohibited: [], referenceWorks: [] }, createdAt: '' },
      { id: 'new', version: 2, payload: { narrativePerson: '第三人称', pace: '快', prohibited: [], referenceWorks: [] }, createdAt: '' },
    ], knowledge: [
      { id: 'k', body: '雨夜的灯光照在路面。', source: '原创摘录', categoryId: 'c', tagIds: [], origin: null, revision: 1, deletedAt: null },
      { id: 'gone', body: '雨夜的灯光', source: '已删', categoryId: 'c', tagIds: [], origin: null, revision: 1, deletedAt: 'deleted' },
    ] } };
    const result = buildAiReferences(work, 'chapter', '雨夜，灯光落下。');
    expect(result).toContain('雨夜的灯光照在路面。'); expect(result).toContain('原创摘录');
    expect(result).not.toContain('已删'); expect(result).toContain('第一人称'); expect(result).not.toContain('第三人称');
    expect(buildAiReferences(work, 'chapter', '雨夜，灯光落下。', ['chapter'], [])).not.toContain('原创摘录');
    expect(buildAiReferences(work, 'chapter', '雨夜，灯光落下。', ['chapter'], ['k'])).toContain('原创摘录');
});
it('全卷参考包含全部选定章节的特点与大纲，不发送范围外章资料', () => {
  const assets = { outlines: [
    { id: 'o1', title: '开篇', summary: '雨中', chapterId: 'one', parentId: null, deletedAt: null },
    { id: 'o2', title: '转折', summary: '真相', chapterId: 'two', parentId: null, deletedAt: null },
    { id: 'o3', title: '外卷秘密', summary: '不发送', chapterId: 'other', parentId: null, deletedAt: null },
  ], foreshadows: [], evidence: [], categories: [], tags: [], knowledge: [], chapterStyles: [], styleProfiles: [], defaultStyleId: null };
  const work = { assets, chapters: [{ id: 'one', title: '第一章' }, { id: 'two', title: '第二章' }, { id: 'other', title: '外卷' }] } as unknown as WorkDetail;
  const result = buildAiReferences(work, 'one', '雨中', ['one', 'two']);
  expect(result).toContain('转折'); expect(result).toContain('第一章'); expect(result).toContain('第二章');
  expect(result).not.toContain('外卷秘密');
});
it('章节参考包含所属卷概要和未绑定正文的详细节点，包含计划伏笔但不泄露同卷其他章节', () => {
  const node = (id: string, type: OutlineNode['type'], parentId: string | null, chapterId: string | null, summary: string): OutlineNode => ({ id, type, parentId, chapterId, title: id, summary, knowledgeIds: [], sortOrder: 0, deletedAt: null });
  const outlines = [
    node('卷计划', 'volume', null, null, '调查与成长主线'),
    node('当前章纲', 'chapter', '卷计划', 'one', '进入旧车站'),
    node('详细场景', 'detail', '当前章纲', null, '午夜交出钥匙'),
    node('其他章纲', 'chapter', '卷计划', 'other', '范围外反转'),
    node('其他详细场景', 'detail', '其他章纲', null, '另一章秘密'),
    node('跨章详细场景', 'detail', '当前章纲', 'other', '明确属于另一章'),
    node('跨章子节点', 'detail', '跨章详细场景', null, '不能越过异章节点纳入'),
    { ...node('已删场景', 'detail', '当前章纲', null, '已删除计划'), deletedAt: 'deleted' },
    node('独立场景', 'detail', null, null, '未关联计划'),
  ];
  const work = { chapters: [{ id: 'one', title: '第一章' }, { id: 'other', title: '第二章' }], assets: {
    outlines, foreshadows: [
      { id: 'hint', name: '钥匙暗线', status: '未埋设', description: '后续回收', outlineId: '详细场景', deletedAt: null },
      { id: 'outside', name: '异章伏笔', status: '未埋设', description: '不可发送', outlineId: '其他详细场景', deletedAt: null },
    ], evidence: [], knowledge: [], chapterStyles: [], styleProfiles: [], defaultStyleId: null,
  } } as unknown as WorkDetail;
  const result = buildAiReferences(work, 'one', '旧车站', ['one'], []);
  for (const text of ['调查与成长主线', '进入旧车站', '午夜交出钥匙', '钥匙暗线']) expect(result).toContain(text);
  for (const text of ['范围外反转', '另一章秘密', '明确属于另一章', '不能越过异章节点纳入', '已删除计划', '未关联计划', '异章伏笔']) expect(result).not.toContain(text);
});

it('作者选用知识时附带独立学习注释，未选与已删知识不得泄露注释', () => {
  const work = { chapters: [], assets: { knowledge: [
    { id: 'k', body: '她把信折了两遍。', source: '原创参考', deletedAt: null, learningNotes: [{ technique: '重复动作写情绪', usage: '克制的难过', exercise: '改用折纸动作' }] },
    { id: 'gone', body: '雨夜', source: '已删', deletedAt: 'deleted', learningNotes: [{ technique: '删除秘密', usage: '', exercise: '' }] },
  ], chapterStyles: [], styleProfiles: [], outlines: [], foreshadows: [], evidence: [] } } as unknown as WorkDetail;
  const result = buildAiReferences(work, 'chapter', '雨夜', ['chapter'], ['k', 'gone']);
  for (const text of ['她把信折了两遍。', '重复动作写情绪', '克制的难过', '改用折纸动作', '作者审核学习注释']) expect(result).toContain(text);
  expect(result).not.toContain('删除秘密');
  expect(buildAiReferences(work, 'chapter', '雨夜', ['chapter'], [])).not.toContain('重复动作写情绪');
  expect(buildAiReferences(work, 'chapter', '人物克制的难过')).toContain('她把信折了两遍。');
});
