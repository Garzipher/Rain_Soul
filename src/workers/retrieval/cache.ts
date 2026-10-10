import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, renameSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { RetrievalChunk } from './chunking';

export interface CacheToken {generation:string;fingerprint:string;workId:string;workGeneration:number}
export interface CachedChunk extends RetrievalChunk {workId:string;entryId:string;bodyHash:string;vector:Float32Array}
export interface CacheEntry {entryId:string;bodyHash:string;chunks:(RetrievalChunk & {vector:Float32Array})[]}
const identity=z.uuid(), hash=z.string().regex(/^[a-f0-9]{64}$/), fingerprint=z.string().min(1).max(20000);
const tokenSchema=z.object({generation:identity,fingerprint,workId:identity,workGeneration:z.number().int().nonnegative()}).strict();
const sourceSchema=z.object({entryId:identity,bodyHash:hash}).strict();
const chunkSchema=z.object({index:z.number().int().nonnegative(),start:z.number().int().nonnegative(),end:z.number().int().positive(),
  text:z.string().min(1).max(400000),tokenCount:z.number().int().min(1).max(400),vector:z.instanceof(Float32Array)}).strict();
const entrySchema=sourceSchema.extend({chunks:z.array(chunkSchema).min(1).max(2000)}).strict();
function safePath(path:string) {
  let current=resolve(path);
  while(true) {
    if(basename(current).toLowerCase()==='projects') throw new Error('检索缓存不能放入作品目录。');
    if(lstatSync(current,{throwIfNoEntry:false})?.isSymbolicLink()) throw new Error('检索缓存路径不允许符号链接。');
    const parent=dirname(current);if(parent===current)break;current=parent;
  }
}
function validVector(vector:Float32Array):void {
  if(vector.length!==512 || !vector.every(Number.isFinite) || Math.abs(Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0))-1)>1e-4) throw new Error('检索缓存向量无效。');
}
function validChunkSequence(chunks:RetrievalChunk[]):void {
  for(const [index,chunk] of chunks.entries()) {
    const prior=chunks[index-1];
    if(chunk.index!==index || chunk.end-chunk.start!==chunk.text.length || !index && chunk.start!==0
      || prior && (chunk.start<=prior.start || chunk.start>prior.end || chunk.end<=prior.end
        || prior.text.slice(chunk.start-prior.start)!==chunk.text.slice(0,prior.end-chunk.start)))throw new Error('检索缓存分块顺序或偏移无效。');
  }
}
const schema=`
CREATE TABLE cache_model(singleton INTEGER PRIMARY KEY CHECK(singleton=1),generation TEXT NOT NULL,fingerprint TEXT NOT NULL);
CREATE TABLE cache_work(work_id TEXT PRIMARY KEY,generation INTEGER NOT NULL CHECK(generation>=0));
CREATE TABLE embedding_chunk(generation TEXT NOT NULL,fingerprint TEXT NOT NULL,work_id TEXT NOT NULL,work_generation INTEGER NOT NULL,
  entry_id TEXT NOT NULL,body_hash TEXT NOT NULL,chunk_index INTEGER NOT NULL,start_offset INTEGER NOT NULL,end_offset INTEGER NOT NULL,
  text TEXT NOT NULL,token_count INTEGER NOT NULL,dimensions INTEGER NOT NULL CHECK(dimensions=512),vector BLOB NOT NULL,
  PRIMARY KEY(generation,fingerprint,work_id,work_generation,entry_id,body_hash,chunk_index));
`;
interface ChunkRow {generation:string;fingerprint:string;work_id:string;work_generation:number;entry_id:string;body_hash:string;chunk_index:number;
  start_offset:number;end_offset:number;text:string;token_count:number;dimensions:number;vector:Buffer}

/** 仅拥有独立派生文件；损坏时隔离重建，不接受或打开作者项目数据库。 */
export class RetrievalCache {
  private readonly file:string;
  private db!:Database.Database;
  constructor(directory:string) {
    const root=resolve(directory);safePath(root);mkdirSync(root,{recursive:true});safePath(root);
    this.file=join(root,'retrieval.sqlite');this.open();
  }
  private create():Database.Database {
    safePath(this.file);const db=new Database(this.file);
    try {
      db.pragma('trusted_schema=OFF');db.pragma('journal_mode=WAL');db.pragma('busy_timeout=1000');
      const version=db.pragma('user_version',{simple:true});
      if(version===0) db.transaction(()=>{db.exec(schema);db.pragma('user_version=1');})();
      else if(version!==1 || db.pragma('quick_check',{simple:true})!=='ok')throw new Error('派生缓存损坏。');
      db.prepare('SELECT * FROM cache_model').all();db.prepare('SELECT * FROM cache_work').all();db.prepare('SELECT * FROM embedding_chunk LIMIT 0').all();
      return db;
    } catch(error) {db.close();throw error;}
  }
  private quarantine():void {
    this.close();const marker=`.corrupt-${randomUUID()}`;
    for(const suffix of ['','-wal','-shm','-journal']) {const file=this.file+suffix;safePath(file);if(lstatSync(file,{throwIfNoEntry:false}))renameSync(file,file+marker);}
  }
  private open():void {
    try {this.db=this.create();}catch {this.quarantine();this.db=this.create();}
  }
  beginGeneration(value:string,force=false):string {
    const parsed=fingerprint.parse(value),prior=this.db.prepare('SELECT generation,fingerprint FROM cache_model').get() as {generation:string;fingerprint:string}|undefined;
    if(prior?.fingerprint===parsed && !force)return identity.parse(prior.generation);
    const generation=randomUUID();
    this.db.transaction(()=> {this.db.prepare('INSERT OR REPLACE INTO cache_model VALUES(1,?,?)').run(generation,parsed);this.db.exec('DELETE FROM embedding_chunk;DELETE FROM cache_work;');})();
    return generation;
  }
  getWorkToken(workId:string):CacheToken {
    identity.parse(workId);const model=this.db.prepare('SELECT generation,fingerprint FROM cache_model').get() as {generation:string;fingerprint:string}|undefined;
    if(!model)throw new Error('检索缓存模型尚未初始化。');
    const work=this.db.prepare('SELECT generation FROM cache_work WHERE work_id=?').get(workId) as {generation:number}|undefined;
    return tokenSchema.parse({...model,workId,workGeneration:work?.generation??0});
  }
  invalidateWork(workId:string):void {
    identity.parse(workId);this.db.transaction(()=> {
      this.db.prepare('INSERT INTO cache_work VALUES(?,1) ON CONFLICT(work_id) DO UPDATE SET generation=generation+1').run(workId);
      this.db.prepare('DELETE FROM embedding_chunk WHERE work_id=?').run(workId);
    })();
  }
  writeCAS(token:CacheToken,value:CacheEntry):boolean {
    const checked=tokenSchema.parse(token),entry=entrySchema.parse(value);
    validChunkSequence(entry.chunks);for(const chunk of entry.chunks)validVector(chunk.vector);
    return this.db.transaction(()=> {
      let current:CacheToken;try{current=this.getWorkToken(checked.workId);}catch{return false;}
      if(JSON.stringify(current)!==JSON.stringify(checked))return false;
      this.db.prepare('DELETE FROM embedding_chunk WHERE work_id=? AND entry_id=?').run(checked.workId,entry.entryId);
      const insert=this.db.prepare('INSERT INTO embedding_chunk VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for(const chunk of entry.chunks) {
        const vector=Buffer.alloc(512*4);for(let index=0;index<512;index++)vector.writeFloatLE(chunk.vector[index],index*4);
        insert.run(checked.generation,checked.fingerprint,checked.workId,checked.workGeneration,entry.entryId,entry.bodyHash,chunk.index,chunk.start,chunk.end,chunk.text,chunk.tokenCount,512,vector);
      }
      return true;
    })();
  }
  readWork(workId:string,values:{entryId:string;bodyHash:string}[]):CachedChunk[] {
    identity.parse(workId);const sources=z.array(sourceSchema).parse(values);
    const allowed=new Map(sources.map(item=>[item.entryId,item.bodyHash]));
    try {
      const token=this.getWorkToken(workId);
      const rows=this.db.prepare('SELECT * FROM embedding_chunk WHERE work_id=? AND generation=? AND fingerprint=? AND work_generation=? ORDER BY entry_id,chunk_index')
        .all(workId,token.generation,token.fingerprint,token.workGeneration) as ChunkRow[];
      const result:CachedChunk[]=[];
      for(const row of rows) {
        if(allowed.get(row.entry_id)!==row.body_hash)continue;
        if(row.dimensions!==512 || !Buffer.isBuffer(row.vector) || row.vector.length!==512*4)throw new Error('缓存向量损坏。');
        const vector=new Float32Array(512);for(let index=0;index<512;index++)vector[index]=row.vector.readFloatLE(index*4);
        const chunk=chunkSchema.parse({index:row.chunk_index,start:row.start_offset,end:row.end_offset,text:row.text,tokenCount:row.token_count,vector});
        if(chunk.end-chunk.start!==chunk.text.length)throw new Error('缓存偏移损坏。');validVector(vector);
        result.push({...chunk,workId,entryId:identity.parse(row.entry_id),bodyHash:hash.parse(row.body_hash)});
      }
      const byEntry=new Map<string,CachedChunk[]>();for(const chunk of result){const values=byEntry.get(chunk.entryId)??[];values.push(chunk);byEntry.set(chunk.entryId,values);}
      for(const chunks of byEntry.values())validChunkSequence(chunks);
      return result;
    }catch {this.quarantine();this.db=this.create();return [];}
  }
  close():void {if(this.db?.open)this.db.close();}
}
