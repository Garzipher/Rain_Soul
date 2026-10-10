import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { RetrievalCache } from '../../src/workers/retrieval/cache';

const roots:string[]=[], caches:RetrievalCache[]=[];
function setup() {const root=mkdtempSync(join(tmpdir(),'rainsoul-cache-')); roots.push(root);const cache=new RetrievalCache(root); caches.push(cache); return {root,cache};}
afterEach(()=>{for(const cache of caches.splice(0)) cache.close(); for(const root of roots.splice(0)) rmSync(root,{recursive:true,force:true});});
const vector=()=>{const value=new Float32Array(512);value[0]=1;return value;};
const entry=()=>({entryId:randomUUID(),bodyHash:'a'.repeat(64),chunks:[{index:0,start:0,end:2,text:'原文',tokenCount:2,vector:vector()}]});
it('Float32向量/原textoffset按完整指纹与hash往返，重启继续读当前代',()=>{
  const {root,cache}=setup(),workId=randomUUID(),data=entry();const generation=cache.beginGeneration('固定模型完整指纹');
  const token=cache.getWorkToken(workId);expect(cache.writeCAS(token,data)).toBe(true);
  const rows=cache.readWork(workId,[{entryId:data.entryId,bodyHash:data.bodyHash}]);
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({workId,entryId:data.entryId,bodyHash:data.bodyHash,index:0,start:0,end:2,text:'原文'});expect(rows[0].vector).toEqual(vector());
  expect(cache.readWork(workId,[{entryId:data.entryId,bodyHash:'b'.repeat(64)}])).toEqual([]);
  cache.close();const reopened=new RetrievalCache(root);caches.push(reopened);expect(reopened.getWorkToken(workId)).toEqual(token);expect(reopened.getWorkToken(workId).generation).toBe(generation);
});
it('模型切换和work失效CAS拒绝晚嵌入，跨work同entry身份不混淆',()=>{
  const {cache}=setup(),workId=randomUUID(),otherWork=randomUUID(),data=entry();cache.beginGeneration('模型1');const old=cache.getWorkToken(workId);
  expect(cache.writeCAS(old,data)).toBe(true);cache.invalidateWork(workId);expect(cache.writeCAS(old,data)).toBe(false);expect(cache.readWork(workId,[{entryId:data.entryId,bodyHash:data.bodyHash}])).toEqual([]);
  const current=cache.getWorkToken(workId);expect(cache.writeCAS(current,data)).toBe(true);expect(cache.writeCAS(cache.getWorkToken(otherWork),data)).toBe(true);
  cache.beginGeneration('模型2');expect(cache.writeCAS(current,data)).toBe(false);expect(cache.readWork(workId,[{entryId:data.entryId,bodyHash:data.bodyHash}])).toEqual([]);
});
it('拒绝维数/有限数/范数/分块offset/重复块错误且整条缓存不产生半成功',()=>{
  const {cache}=setup(),workId=randomUUID(),data=entry();cache.beginGeneration('模型');const token=cache.getWorkToken(workId);
  for(const bad of [new Float32Array(3),new Float32Array(512),Float32Array.from(vector(),(value,index)=>index===2?NaN:value)]) expect(()=>cache.writeCAS(token,{...data,chunks:[{...data.chunks[0],vector:bad}]})).toThrow();
  expect(()=>cache.writeCAS(token,{...data,chunks:[data.chunks[0],data.chunks[0]]})).toThrow();
  expect(()=>cache.writeCAS(token,{...data,chunks:[{...data.chunks[0],end:5}]})).toThrow();expect(cache.readWork(workId,[{entryId:data.entryId,bodyHash:data.bodyHash}])).toEqual([]);
});
it('损坏缓存隔离重建，原作品文件保持逐字节不变且禁止Projects目录',()=>{
  const {root,cache}=setup();cache.close();const author=join(root,'author.sqlite');writeFileSync(author,'作者原文');
  writeFileSync(join(root,'retrieval.sqlite'),'not-a-sqlite');const rebuilt=new RetrievalCache(root);caches.push(rebuilt);
  rebuilt.beginGeneration('模型');expect(readdirSync(root).some(name=>name.includes('corrupt'))).toBe(true);expect(readFileSync(author,'utf8')).toBe('作者原文');
  expect(()=>new RetrievalCache(join(root,'Projects','bad'))).toThrow(/作品/);
});
it('缓存blob或行损坏不能作为参考返回，隔离后要求重建不改源数据库',()=>{
  const {root,cache}=setup(),workId=randomUUID(),data=entry();cache.beginGeneration('模型');cache.writeCAS(cache.getWorkToken(workId),data);cache.close();
  const db=new Database(join(root,'retrieval.sqlite'));db.prepare('UPDATE embedding_chunk SET vector=?').run(Buffer.alloc(1));db.close();
  const reopened=new RetrievalCache(root);caches.push(reopened);expect(reopened.readWork(workId,[{entryId:data.entryId,bodyHash:data.bodyHash}])).toEqual([]);
});
it('同条目分块序号与原文覆盖范围损坏后不能返回部分参考',()=>{
  const {root,cache}=setup(),workId=randomUUID(),data=entry();cache.beginGeneration('模型');cache.writeCAS(cache.getWorkToken(workId),data);cache.close();
  const db=new Database(join(root,'retrieval.sqlite'));db.prepare('UPDATE embedding_chunk SET chunk_index=1').run();db.close();
  const reopened=new RetrievalCache(root);caches.push(reopened);expect(reopened.readWork(workId,[{entryId:data.entryId,bodyHash:data.bodyHash}])).toEqual([]);
});
