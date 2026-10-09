import { expect, it } from 'vitest';
import { buildAiReferences } from '../../src/shared/ai-reference';
import type { WorkDetail } from '../../src/shared/contracts';
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
