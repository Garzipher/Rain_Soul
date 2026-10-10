export interface RankedEntry {
  workId: string; entryId: string; bodyHash: string; excerpt: string; source: string; categoryId: string; tagIds: string[];
}
export interface CategoryNode { workId: string; id: string; parentId: string | null }
export interface SemanticChunk { workId: string; entryId: string; chunkIndex: number; excerpt: string; vector: ArrayLike<number> }
export interface RankingInput {
  entries: RankedEntry[]; categories: CategoryNode[]; keywords: { workId: string; entryId: string }[];
  chunks: SemanticChunk[]; queryVector: ArrayLike<number>; threshold: number; mode: 'keyword' | 'semantic' | 'hybrid';
  filter: { workId: string | null; categoryId?: string; tagIds: string[] };
}
export interface RankedHit extends RankedEntry { matchedBy: ('keyword' | 'semantic')[]; reliable: boolean; score: number; semanticScore: number | null }
const identity = (item: { workId: string; entryId: string }) => JSON.stringify([item.workId,item.entryId]);
const compareIdentity = (left: { workId: string; entryId: string }, right: { workId: string; entryId: string }) => {
  const leftKey=identity(left), rightKey=identity(right); return leftKey<rightKey?-1:leftKey>rightKey?1:0;
};

export function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number {
  if (!left.length || left.length !== right.length) throw new Error('检索向量维数不匹配。');
  let dot=0,leftNorm=0,rightNorm=0;
  for (let index=0; index<left.length; index++) {
    const a=left[index], b=right[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('检索向量包含无效数值。');
    dot+=a*b; leftNorm+=a*a; rightNorm+=b*b;
  }
  if (!leftNorm || !rightNorm || !Number.isFinite(dot+leftNorm+rightNorm)) throw new Error('检索向量范数无效。');
  return Math.max(-1,Math.min(1,dot/Math.sqrt(leftNorm*rightNorm)));
}

/** 两路先筛选再排名；循环分类停止遍历，不把未知父链视作目标分类。 */
function inCategory(entry: RankedEntry, categoryId: string, categories: Map<string,string|null>): boolean {
  let current: string|null=entry.categoryId; const seen=new Set<string>();
  while (current!==null && !seen.has(current)) {
    if (current===categoryId && categories.has(JSON.stringify([entry.workId,current]))) return true;
    seen.add(current); current=categories.get(JSON.stringify([entry.workId,current]))??null;
  }
  return false;
}

/** 纯排序仅计算给定向量；阈值必须来自真实模型独立校准，不能用此模块证明模型质量。 */
export function rankKnowledge(input: RankingInput): RankedHit[] {
  if (!Number.isFinite(input.threshold) || input.threshold<-1 || input.threshold>1 || !['keyword','semantic','hybrid'].includes(input.mode)) throw new Error('检索排序配置无效。');
  const categories=new Map(input.categories.map(item=>[JSON.stringify([item.workId,item.id]),item.parentId]));
  const entries=new Map<string,RankedEntry>();
  for (const entry of input.entries) if ((input.filter.workId===null || input.filter.workId===entry.workId)
    && (!input.filter.categoryId || inCategory(entry,input.filter.categoryId,categories))
    && input.filter.tagIds.every(tag=>entry.tagIds.includes(tag))) entries.set(identity(entry),entry);
  const keywordKeys=[...new Set(input.keywords.map(identity))].filter(key=>entries.has(key));
  const semantic=new Map<string,{score:number;chunk:SemanticChunk}>();
  if (input.mode!=='keyword') for (const chunk of input.chunks) {
    const key=identity(chunk); if (!entries.has(key)) continue;
    const score=cosineSimilarity(input.queryVector,chunk.vector), prior=semantic.get(key);
    if (score>=input.threshold && (!prior || score>prior.score || score===prior.score && chunk.chunkIndex<prior.chunk.chunkIndex)) semantic.set(key,{score,chunk});
  }
  const semanticKeys=[...semantic.keys()].sort((a,b)=>semantic.get(b)!.score-semantic.get(a)!.score || compareIdentity(entries.get(a)!,entries.get(b)!));
  const ranked=new Map<string,RankedHit>();
  const add=(keys:string[],kind:'keyword'|'semantic')=>keys.forEach((key,index)=> {
    const entry=entries.get(key)!, prior=ranked.get(key), evidence=semantic.get(key);
    const score=input.mode==='hybrid'?1/(60+index+1):kind==='semantic'?evidence!.score:1/(index+1);
    if (prior) { prior.score+=score; prior.matchedBy.push(kind); }
    else ranked.set(key,{...entry,excerpt:kind==='semantic'?evidence!.chunk.excerpt:entry.excerpt, matchedBy:[kind],reliable:true, score, semanticScore:kind==='semantic'?evidence!.score:null});
    if (kind==='semantic') { ranked.get(key)!.semanticScore=evidence!.score; ranked.get(key)!.excerpt=evidence!.chunk.excerpt; }
  });
  if (input.mode!=='semantic') add(keywordKeys,'keyword');
  if (input.mode!=='keyword') add(semanticKeys,'semantic');
  return [...ranked.values()].sort((a,b)=>b.score-a.score || compareIdentity(a,b));
}
