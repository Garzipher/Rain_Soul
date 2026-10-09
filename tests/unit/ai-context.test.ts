import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildAiContext } from '../../src/shared/ai-context';
import type { WorkDetail } from '../../src/shared/contracts';
const volumeId = randomUUID();
function work(): WorkDetail {
  return { id: randomUUID(), title: '雨', revision: 4, volumes: [{ id: volumeId, title: '卷一' }], deletedItems: [], chapters: ['前章', '当前', '第三章'].map(title => ({ id: randomUUID(), title, wordCount: 2, volumeId, document: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: `${title}正文` }] }] } })) };
}
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
