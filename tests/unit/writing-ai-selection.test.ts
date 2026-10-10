import { Schema } from '@tiptap/pm/model';
import { expect, it } from 'vitest';
import { captureWritingSelection, restoreWritingRequest } from '../../src/renderer/lib/writing-ai-selection';
import { emptyDocument } from '../../src/shared/document';
const schema = new Schema({ nodes: {
  doc: { content: 'paragraph+' }, paragraph: { content: 'inline*', attrs: { id: { default: '' } } }, text: { group: 'inline' },
  bookmark: { inline: true, group: 'inline', atom: true }, hardBreak: { inline: true, group: 'inline' },
} });
const paragraph = (id: string, text: string) => schema.node('paragraph', { id }, text ? [schema.text(text)] : []);
it('导航恢复只保留同章同正文的原选区，前插重复句或改章后拒绝旧偏移', () => {
  const document = emptyDocument(); document.content[0].content = [{ type: 'text', text: '雨落。雨落。' }];
  const chapter = { id: 'chapter', document }, request = { token: 1, operation: 'sentencePolish' as const, paragraphIds: [document.content[0].attrs.id], text: '雨落。', sentenceFrom: 3 };
  const saved = { chapterId: chapter.id, document: JSON.stringify(document), request };
  expect(restoreWritingRequest(saved, chapter)).toEqual(request);
  expect(restoreWritingRequest(saved, { ...chapter, id: 'other' })).toBeUndefined();
  const modified = structuredClone(document); modified.content[0].content = [{ type: 'text', text: '雨落。雨落。雨落。' }];
  expect(restoreWritingRequest(saved, { ...chapter, document: modified })).toBeUndefined();
  expect(restoreWritingRequest(undefined, chapter)).toBeUndefined();
});
it('选中第二个重复句保留真实偏移；空光标和边界无效不抢占原生右键', () => {
  const doc = schema.node('doc', null, [paragraph('p1', '雨落。雨落。')]);
  expect(captureWritingSelection(doc, 4, 7)).toEqual({ paragraphIds: ['p1'], text: '雨落。', sentenceFrom: 3 });
  for (const [from, to] of [[1, 1], [2, 1], [-1, 4], [1, 100]]) expect(captureWritingSelection(doc, from, to)).toBeNull();
});
it('跨段选区只包含实际相交段落，不把边界下一段列为目标', () => {
  const doc = schema.node('doc', null, [paragraph('p1', '雨夜'), paragraph('p2', '车站'), paragraph('p3', '归途')]);
  expect(captureWritingSelection(doc, 2, 7)).toEqual({ paragraphIds: ['p1', 'p2'], text: '夜\n车站' });
  expect(captureWritingSelection(doc, 1, 5)?.paragraphIds).toEqual(['p1']);
});
it('书签不参与文本偏移，换行不能伪装为单句，空白选区忽略', () => {
  const doc = schema.node('doc', null, [schema.node('paragraph', { id: 'p' }, [schema.text('甲'), schema.node('bookmark'), schema.text('雨落。'), schema.node('hardBreak'), schema.text('乙')])]);
  expect(captureWritingSelection(doc, 3, 6)).toEqual({ paragraphIds: ['p'], text: '雨落。', sentenceFrom: 1 });
  expect(captureWritingSelection(doc, 3, 8)?.sentenceFrom).toBeUndefined();
  expect(captureWritingSelection(schema.node('doc', null, [paragraph('p', '   ')]), 1, 4)).toBeNull();
});
