import { expect, it } from 'vitest';
import { cosineSimilarity, rankKnowledge } from '../../src/workers/retrieval/ranking';

const entries = [
  { workId: 'w1', entryId: 'a', bodyHash: 'hash-a', excerpt: '雨夜', source: '甲书', categoryId: 'child', tagIds: ['rain','night'] },
  { workId: 'w1', entryId: 'b', bodyHash: 'hash-b', excerpt: '晴天', source: '乙书', categoryId: 'root', tagIds: ['rain'] },
  { workId: 'w2', entryId: 'a', bodyHash: 'hash-c', excerpt: '远景', source: '丙书', categoryId: 'root', tagIds: ['rain','night'] },
];
const categories = [{ workId: 'w1', id: 'root', parentId: null }, { workId:'w1', id:'child', parentId:'root' }, { workId:'w2', id:'root', parentId:null }];
const chunk = (entry: typeof entries[number], vector: number[], chunkIndex = 0) => ({ workId: entry.workId, entryId: entry.entryId, vector, chunkIndex, excerpt: entry.excerpt });
const input = () => ({ entries, categories, keywords: [entries[1], entries[0]], chunks: [chunk(entries[0], [1,0]),chunk(entries[1],[0,1]),chunk(entries[2],[1,0])], queryVector:[1,0], threshold:0.5, mode:'hybrid' as const, filter: { workId:null, tagIds:[] as string[] } });
it('真实余弦计算拒绝零向量、维数错位和非有限数，负相关保留负号', () => {
  expect(cosineSimilarity([3,4],[3,4])).toBeCloseTo(1);
  expect(cosineSimilarity([1,0],[-1,0])).toBe(-1);
  for (const vector of [[0,0],[1],[NaN,0],[Infinity,0]]) expect(() => cosineSimilarity([1,0],vector)).toThrow();
});
it('按条目取分块最大相似度，低于校准阈值不输出语义推荐', () => {
  const result=rankKnowledge({...input(), mode:'semantic', chunks:[chunk(entries[0],[0,1],0),chunk(entries[0],[1,0],1),chunk(entries[1],[0,1])]});
  expect(result).toHaveLength(1); expect(result[0]).toMatchObject({entryId:'a',semanticScore:1,matchedBy:['semantic'],reliable:true});
});
it('RRF k60融合两路去重排名，关键词弱语义仍作为关键词命中保留', () => {
  const result=rankKnowledge(input());
  expect(result.map(hit=>`${hit.workId}/${hit.entryId}`)).toEqual(['w1/a','w1/b','w2/a']);
  expect(result[0].score).toBeCloseTo(1/62+1/61);
  expect(result[0].matchedBy).toEqual(['keyword','semantic']);
  expect(result[1]).toMatchObject({matchedBy:['keyword'],reliable:true,semanticScore:null});
});
it('分类子树和标签AND在两路排名之前筛选，作品身份隔离', () => {
  const result=rankKnowledge({...input(),filter:{workId:'w1',categoryId:'root',tagIds:['rain','night']}});
  expect(result).toHaveLength(1); expect(result[0].entryId).toBe('a'); expect(result[0].score).toBeCloseTo(2/61);
  expect(rankKnowledge({...input(),filter:{workId:'w1',categoryId:'missing',tagIds:[]}})).toEqual([]);
});
it('同作品身份去重但跨作品同entryId独立，等分稳定且忽略悬空候选', () => {
  const request={...input(),mode:'semantic' as const,entries:[...entries,entries[0]],chunks:[chunk(entries[2],[1,0]),chunk(entries[0],[1,0]),chunk({...entries[0],entryId:'missing'},[1,0])]};
  expect(rankKnowledge(request).map(hit=>`${hit.workId}/${hit.entryId}`)).toEqual(['w1/a','w2/a']);
  expect(rankKnowledge({...request,chunks:[...request.chunks].reverse()})).toEqual(rankKnowledge(request));
});
it('空查询向量/无相关项不伪造语义结果，关键词模式不运行无效向量', () => {
  expect(rankKnowledge({...input(),chunks:[],keywords:[]})).toEqual([]);
  expect(rankKnowledge({...input(),mode:'keyword',queryVector:[NaN]})).toHaveLength(2);
  expect(()=>rankKnowledge({...input(),threshold:NaN})).toThrow();
});
