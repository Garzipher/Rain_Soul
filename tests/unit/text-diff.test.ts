import { expect, it } from 'vitest';
import { diffText } from '../../src/shared/text-diff';
it('中文增删差异保持完整原文与候选，可处理换行和代理对字符', () => {
  for (const [before, after] of [['雨落窗前。', '细雨落窗边。'], ['', '新增'], ['删除', ''], ['🙂雨\n夜', '🙂雪\n夜'], ['相同', '相同']]) {
    const pieces = diffText(before, after);
    expect(pieces.filter(piece => piece.kind !== 'insert').map(piece => piece.text).join('')).toBe(before);
    expect(pieces.filter(piece => piece.kind !== 'delete').map(piece => piece.text).join('')).toBe(after);
  }
  expect(diffText('雨落', '雪落')).toContainEqual({ kind: 'delete', text: '雨' });
  expect(diffText('雨落', '雪落')).toContainEqual({ kind: 'insert', text: '雪' });
});
it('长文本限制比较矩阵，仍完整保留首尾和变更范围', () => {
  const pieces = diffText(`头${'雨'.repeat(2000)}尾`, `头${'雪'.repeat(2000)}尾`);
  expect(pieces).toEqual([{ kind: 'equal', text: '头' }, { kind: 'delete', text: '雨'.repeat(2000) }, { kind: 'insert', text: '雪'.repeat(2000) }, { kind: 'equal', text: '尾' }]);
});
