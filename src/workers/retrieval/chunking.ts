export interface RetrievalChunk { index: number; start: number; end: number; text: string; tokenCount: number }

/** 按原文码点定位，不用WordPiece decode重建正文；tokenize必须不含前缀/特殊token。 */
export function chunkKnowledgeText(text: string, tokenize: (text: string)=>number[]): RetrievalChunk[] {
  if (typeof text!=='string') throw new Error('知识原文无效。');
  if (!text.trim()) return [];
  const points=Array.from(text);
  if (points.length>200000) throw new Error('知识原文超过分块容量。');
  const offsets=[0]; for (const point of points) offsets.push(offsets.at(-1)!+point.length);
  const slice=(start:number,end:number)=>text.slice(offsets[start],offsets[end]);
  const count=(value:string)=> {
    const tokens=tokenize(value);
    if (!Array.isArray(tokens) || tokens.some(token=>!Number.isSafeInteger(token) || token<0)) throw new Error('本机tokenizer返回无效结果。');
    return tokens.length;
  };
  // 二分结果仍经真实tokenize复验；无需假设字符数等于token数。
  const longest=(size:number,limit:number,read:(length:number)=>string)=> {
    let low=0,high=Math.min(400,size);
    while (high<size && count(read(high))<=limit) { low=high; high=Math.min(size,high*2); }
    if (count(read(high))<=limit) return high;
    while (low+1<high) { const middle=Math.floor((low+high)/2); if (count(read(middle))<=limit) low=middle; else high=middle; }
    return low;
  };
  const chunks:RetrievalChunk[]=[]; let start=0;
  while(start<points.length) {
    const length=longest(points.length-start,400,size=>slice(start,start+size));
    if (!length) throw new Error('单个原文字元超过模型容量，未截断原文。');
    const end=start+length, value=slice(start,end), tokenCount=count(value);
    if (!tokenCount || tokenCount>400) throw new Error('知识分块token数量无效。');
    chunks.push({index:chunks.length,start:offsets[start],end:offsets[end],text:value,tokenCount});
    if(end===points.length) break;
    const overlap=longest(length-1,50,size=>slice(end-size,end));
    if(overlap && count(slice(end-overlap,end))>50) throw new Error('知识分块重叠超过token限额。');
    start=end-overlap;
  }
  return chunks;
}
