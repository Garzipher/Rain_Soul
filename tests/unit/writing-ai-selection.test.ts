import { Schema } from '@tiptap/pm/model';
import { expect, it } from 'vitest';
import { captureWritingSelection } from '../../src/renderer/lib/writing-ai-selection';
const schema = new Schema({ nodes: {
  doc: { content: 'paragraph+' }, paragraph: { content: 'inline*', attrs: { id: { default: '' } } }, text: { group: 'inline' },
  bookmark: { inline: true, group: 'inline', atom: true }, hardBreak: { inline: true, group: 'inline' },
} });
const paragraph = (id: string, text: string) => schema.node('paragraph', { id }, text ? [schema.text(text)] : []);
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
