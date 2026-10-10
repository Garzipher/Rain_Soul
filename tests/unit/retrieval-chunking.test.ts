import { expect, it } from 'vitest';
import { chunkKnowledgeText } from '../../src/workers/retrieval/chunking';

// 仅验证分块数学边界；此夹具不是模型检索质量证据。
const onePerCodePoint=(text:string)=>Array.from(text).map((_,index)=>index);
it('400 token块、50 token重叠，末块不丢字符且块序号稳定', () => {
  const text='字'.repeat(751), chunks=chunkKnowledgeText(text,onePerCodePoint);
  expect(chunks.map(chunk=>[chunk.start,chunk.end,chunk.tokenCount])).toEqual([[0,400,400],[350,750,400],[700,751,51]]);
  expect(chunks.map(chunk=>chunk.index)).toEqual([0,1,2]);
  expect(chunks.at(-1)!.text).toBe(text.slice(700));
});
it('保持原文Unicode、空白、标点，用UTF16偏移定位且不切开代理对', () => {
  const text='  Á\n'+ '😀'.repeat(500)+'尾部  ', chunks=chunkKnowledgeText(text,onePerCodePoint);
  for(const chunk of chunks) { expect(chunk.text).toBe(text.slice(chunk.start,chunk.end)); expect(Array.from(chunk.text)).toHaveLength(chunk.tokenCount); }
  expect(chunks[0].text.startsWith('  Á\n')).toBe(true);
  expect(chunks.at(-1)!.text.endsWith('尾部  ')).toBe(true);
});
it('实际tokenizer多token字元仍严格限额，所有重叠不超过50token', () => {
  const tokenize=(text:string)=>Array.from(text).flatMap(()=>[1,2,3]);
  const chunks=chunkKnowledgeText('甲'.repeat(400),tokenize);
  expect(chunks.every(chunk=>chunk.tokenCount<=400)).toBe(true);
  for(let index=1;index<chunks.length;index++) expect(tokenize('甲'.repeat(chunks[index-1].end-chunks[index].start)).length).toBeLessThanOrEqual(50);
  expect(chunks.at(-1)!.end).toBe(400);
});
it('短文仅一块，空白不索引，零token或单码点超模型容量明确拒绝', () => {
  expect(chunkKnowledgeText('短文',onePerCodePoint)).toEqual([{index:0,start:0,end:2,text:'短文',tokenCount:2}]);
  expect(chunkKnowledgeText(' \n ',onePerCodePoint)).toEqual([]);
  expect(()=>chunkKnowledgeText('字',()=>[])).toThrow();
  expect(()=>chunkKnowledgeText('字',()=>Array(401).fill(1))).toThrow();
});
it('不通过decode重建英文，tokenizer非单调时仍复验容量并保持进度', () => {
  const text='A'.repeat(800);
  const tokens=(value:string)=>Array(value.length===401?399:value.length).fill(1);
  const chunks=chunkKnowledgeText(text,tokens);
  expect(chunks.every(chunk=>tokens(chunk.text).length<=400)).toBe(true);
  expect(chunks.at(-1)!.end).toBe(800);
});
