import { expect, it } from 'vitest';
import { canMoveManuscriptChapter, normalizeManuscriptOrder } from '../../src/renderer/lib/manuscript-order';

it('规范空白卷名且不修改源数据，聚合顺序与再次规范保持一致', () => {
  const chapters = [
    { title: '甲', volumeTitle: ' 卷一 ', paragraphs: ['甲', ''] },
    { title: '乙', volumeTitle: '   ', paragraphs: ['乙'] },
    { title: '丙', volumeTitle: '卷二', paragraphs: ['丙'] },
    { title: '丁', volumeTitle: '卷一', paragraphs: ['丁'] },
  ];
  const result = normalizeManuscriptOrder(chapters);
  expect(result.map(item => item.title)).toEqual(['乙', '甲', '丁', '丙']);
  expect(result.map(item => item.volumeTitle)).toEqual([null, '卷一', '卷一', '卷二']);
  expect(result[1].paragraphs).toBe(chapters[0].paragraphs);
  expect(chapters[0].volumeTitle).toBe(' 卷一 ');
  expect(normalizeManuscriptOrder(result)).toEqual(result);
  expect(normalizeManuscriptOrder([])).toEqual([]);
});

it('移动必须在相邻同卷范围内，无卷章同属一组，边界不可移动', () => {
  const chapters = [
    { title: '甲', volumeTitle: null, paragraphs: ['甲'] },
    { title: '乙', volumeTitle: null, paragraphs: ['乙'] },
    { title: '丙', volumeTitle: '卷一', paragraphs: ['丙'] },
    { title: '丁', volumeTitle: ' 卷一 ', paragraphs: ['丁'] },
  ];
  expect(canMoveManuscriptChapter(chapters, 0, -1)).toBe(false);
  expect(canMoveManuscriptChapter(chapters, 0, 1)).toBe(true);
  expect(canMoveManuscriptChapter(chapters, 1, 1)).toBe(false);
  expect(canMoveManuscriptChapter(chapters, 2, -1)).toBe(false);
  expect(canMoveManuscriptChapter(chapters, 2, 1)).toBe(true);
  expect(canMoveManuscriptChapter(chapters, 3, 1)).toBe(false);
  expect(canMoveManuscriptChapter([], 0, 1)).toBe(false);
});
