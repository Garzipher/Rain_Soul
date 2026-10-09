import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildAiContext } from '../../src/shared/ai-context';
import { aiPrepareRequestSchema } from '../../src/shared/ai';
import type { WorkDetail } from '../../src/shared/contracts';
const volumeId = randomUUID();
function work(): WorkDetail {
  return { id: randomUUID(), title: '雨', revision: 4, volumes: [{ id: volumeId, title: '卷一' }], deletedItems: [], chapters: ['前章', '当前', '第三章'].map(title => ({ id: randomUUID(), title, wordCount: 2, volumeId, document: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: `${title}正文` }] }] } })) };
}
it('段落目标保留硬换行且忽略行内书签，发送内容与作者原文一致', () => {
  const current = work(), chapter = current.chapters[1], paragraph = chapter.document.content[0];
  paragraph.content = [
    { type: 'text', text: '第一行。' }, { type: 'hardBreak' },
    { type: 'bookmark', attrs: { id: randomUUID(), kind: 'knowledge', targetId: randomUUID() } },
    { type: 'text', text: '第二行。' },
  ];
  const context = buildAiContext(current, { chapterId: chapter.id, scope: 'chapter', targetParagraphIds: [paragraph.attrs.id] });
  expect(context.text.split('\n\n已授权上下文：')[0]).toBe('目标正文（候选只修改这部分）：\n第一行。\n第二行。');
});
it('大量短正文章节的范围标签不阻止合法全卷请求，完整标题与段落清单仍保留', () => {
  const current = work(), initial = current.chapters[0];
  current.chapters = Array.from({ length: 50 }, (_, index) => ({ ...initial, id: randomUUID(), title: `第${index + 1}章：重逢之后的雨夜`, document: {
    type: 'doc' as const, content: [{ type: 'paragraph' as const, attrs: { id: randomUUID() }, content: [{ type: 'text' as const, text: '雨落。' }] }],
  } }));
  const context = buildAiContext(current, { chapterId: current.chapters[0].id, scope: 'volume' });
  expect(aiPrepareRequestSchema.safeParse({ provider: { id: 'cloud', name: '云模型', baseUrl: 'https://api.example.com/v1', model: 'model' }, operation: 'consistency', context }).success).toBe(true);
  expect(context.scopeLabel.length).toBeLessThanOrEqual(300);
  expect(context.scopeLabel).toContain('50');
  expect(context.referenceChapterIds).toEqual(current.chapters.map(chapter => chapter.id));
  for (const chapter of current.chapters) { expect(context.text).toContain(chapter.title); expect(context.text).toContain(chapter.document.content[0].attrs.id); }
});
it('单章长标题只缩短范围标签，不截断真正发送的正文和标题', () => {
  const current = work(), chapter = current.chapters[0]; chapter.title = '长章节标题'.repeat(80);
  const context = buildAiContext(current, { chapterId: chapter.id, scope: 'chapter' });
  expect(context.scopeLabel.length).toBeLessThanOrEqual(300);
  expect(context.text).toContain(chapter.title);
});
it('四种范围冻结指定章节，前章衔接只含前章与本章，不含未授权章节', () => {
  const current = work(), chapterId = current.chapters[1].id;
  expect(buildAiContext(current, { chapterId, scope: 'chapter' }).text).not.toContain('前章正文');
  const previous = buildAiContext(current, { chapterId, scope: 'previous' });
  expect(previous.text).toContain('前章正文'); expect(previous.text).toContain('当前正文'); expect(previous.text).not.toContain('第三章正文');
  expect(buildAiContext(current, { chapterId, scope: 'volume' }).text).toContain('第三章正文');
  const custom = buildAiContext(current, { chapterId, scope: 'custom', chapterIds: [current.chapters[2].id] });
  expect(custom.text).toContain('当前正文'); expect(custom.scopeLabel).toContain('当前、第三章');
  expect(custom.text).not.toContain('前章正文');
});
it('目标段落和上下文分离，自定义空范围/跨作品段落拒绝，无正文不调用AI', () => {
  const current = work(), chapterId = current.chapters[1].id, paragraphId = current.chapters[1].document.content[0].attrs.id;
  const context = buildAiContext(current, { chapterId, scope: 'previous', targetParagraphIds: [paragraphId] });
  expect(context.paragraphIds).toEqual([paragraphId]); expect(context.baselineRevision).toBe(4);
  expect(() => buildAiContext(current, { chapterId, scope: 'custom', chapterIds: [] })).toThrow();
  expect(() => buildAiContext(current, { chapterId, scope: 'chapter', targetParagraphIds: [randomUUID()] })).toThrow();
  current.chapters[1].document.content[0].content = [];
  expect(() => buildAiContext(current, { chapterId, scope: 'chapter' })).toThrow(/正文/);
});
it('无卷章节不能伪称发送全卷，首章前章衔接明确声明无前章', () => {
  const current = work(), chapterId = current.chapters[0].id;
  current.chapters[0].volumeId = null;
  expect(() => buildAiContext(current, { chapterId, scope: 'volume' })).toThrow(/分卷/);
  expect(buildAiContext(current, { chapterId, scope: 'previous' }).scopeLabel).toContain('无前章');
});
it('精确选区按偏移锁定重复单句，错误偏移或独立偏移拒绝', () => {
  const current = work(), chapter = current.chapters[1], paragraphId = chapter.document.content[0].attrs.id;
  chapter.document.content[0].content = [{ type: 'text', text: '雨落。雨落。' }];
  const request = { chapterId: chapter.id, scope: 'chapter' as const, targetParagraphIds: [paragraphId], sentenceText: '雨落。', sentenceFrom: 3 };
  expect(buildAiContext(current, request).selection).toEqual({ paragraphId, from: 3, to: 6, text: '雨落。' });
  expect(() => buildAiContext(current, { ...request, sentenceFrom: 2 })).toThrow(/选区|匹配/);
  expect(() => buildAiContext(current, { chapterId: chapter.id, scope: 'chapter', sentenceFrom: 3 })).toThrow(/选区|单句/);
});
