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
// 全局库使用显式命名空间，不能与同 UUID 的作品共享派生缓存。
const ownerIdentity=z.union([identity,z.string().startsWith('global:').refine(value=>identity.safeParse(value.slice(7)).success)]);
const tokenSchema=z.object({generation:identity,fingerprint,workId:ownerIdentity,workGeneration:z.number().int().nonnegative()}).strict();
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
      db.exec('CREATE TABLE IF NOT EXISTS cache_stage(work_id TEXT PRIMARY KEY,generation TEXT NOT NULL,fingerprint TEXT NOT NULL,work_generation INTEGER NOT NULL,expected_json TEXT NOT NULL)');
      db.exec('CREATE TABLE IF NOT EXISTS cache_epoch(work_id TEXT PRIMARY KEY,generation INTEGER NOT NULL)');
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
    this.db.transaction(()=> {this.db.prepare('INSERT OR REPLACE INTO cache_model VALUES(1,?,?)').run(generation,parsed);this.db.exec('DELETE FROM embedding_chunk;DELETE FROM cache_work;DELETE FROM cache_stage;DELETE FROM cache_epoch;');})();
    return generation;
  }
  getWorkToken(workId:string):CacheToken {
    ownerIdentity.parse(workId);const model=this.db.prepare('SELECT generation,fingerprint FROM cache_model').get() as {generation:string;fingerprint:string}|undefined;
    if(!model)throw new Error('检索缓存模型尚未初始化。');
    const work=this.db.prepare('SELECT generation FROM cache_work WHERE work_id=?').get(workId) as {generation:number}|undefined;
    return tokenSchema.parse({...model,workId,workGeneration:work?.generation??0});
  }
  invalidateWork(workId:string):void {
    ownerIdentity.parse(workId);this.db.transaction(()=> {
      const current=this.getWorkToken(workId),counter=this.db.prepare('SELECT generation FROM cache_epoch WHERE work_id=?').get(workId) as {generation:number}|undefined;
      const next=Math.max(current.workGeneration,counter?.generation??0)+1;
      this.db.prepare('INSERT OR REPLACE INTO cache_work VALUES(?,?)').run(workId,next);
      this.db.prepare('INSERT OR REPLACE INTO cache_epoch VALUES(?,?)').run(workId,next);
      this.db.prepare('DELETE FROM embedding_chunk WHERE work_id=?').run(workId);
      this.db.prepare('DELETE FROM cache_stage WHERE work_id=?').run(workId);
    })();
  }
  /** 新代先复制正文hash未变的块；未完成代可在重启后继续，不暴露给查询。 */
  stageWork(workId:string,values:{entryId:string;bodyHash:string}[]):CacheToken {
    const sources=z.array(sourceSchema).parse(values),active=this.getWorkToken(workId);
    if(new Set(sources.map(item=>item.entryId)).size!==sources.length)throw new Error('索引条目身份重复。');
    return this.db.transaction(()=> {
      const prior=this.db.prepare('SELECT generation FROM cache_epoch WHERE work_id=?').get(workId) as {generation:number}|undefined;
      const next={...active,workGeneration:Math.max(active.workGeneration,prior?.generation??0)+1};
      this.db.prepare('INSERT OR REPLACE INTO cache_epoch VALUES(?,?)').run(workId,next.workGeneration);
      for(const source of sources) this.db.prepare(`INSERT INTO embedding_chunk
        SELECT generation,fingerprint,work_id,?,entry_id,body_hash,chunk_index,start_offset,end_offset,text,token_count,dimensions,vector
        FROM embedding_chunk WHERE work_id=? AND generation=? AND fingerprint=? AND entry_id=? AND body_hash=? AND work_generation=?`)
        .run(next.workGeneration,workId,active.generation,active.fingerprint,source.entryId,source.bodyHash,
          (this.db.prepare('SELECT MAX(work_generation) AS value FROM embedding_chunk WHERE work_id=? AND generation=? AND fingerprint=? AND entry_id=? AND body_hash=?')
            .get(workId,active.generation,active.fingerprint,source.entryId,source.bodyHash) as {value:number|null}).value ?? -1);
      this.db.prepare('INSERT OR REPLACE INTO cache_stage VALUES(?,?,?,?,?)').run(workId,next.generation,next.fingerprint,next.workGeneration,JSON.stringify(sources));
      this.db.prepare('DELETE FROM embedding_chunk WHERE work_id=? AND work_generation NOT IN (?,?)').run(workId,active.workGeneration,next.workGeneration);
      return next;
    })();
  }
  private stageCurrent(token:CacheToken):boolean {
    const current=this.db.prepare('SELECT generation,fingerprint,work_generation FROM cache_stage WHERE work_id=?').get(token.workId) as {generation:string;fingerprint:string;work_generation:number}|undefined;
    const active=this.getWorkToken(token.workId);
    return !!current && current.generation===token.generation && current.fingerprint===token.fingerprint && current.work_generation===token.workGeneration
      && active.generation===token.generation && active.fingerprint===token.fingerprint;
  }
  readStaged(token:CacheToken,values:{entryId:string;bodyHash:string}[]):CachedChunk[] {
    tokenSchema.parse(token);return this.stageCurrent(token)?this.readToken(token,values):[];
  }
  writeStagedCAS(token:CacheToken,value:CacheEntry):boolean {return this.write(token,value,true);}
  activateStage(token:CacheToken):boolean {
    tokenSchema.parse(token);
    return this.db.transaction(()=> {
      if(!this.stageCurrent(token))return false;
      const row=this.db.prepare('SELECT expected_json FROM cache_stage WHERE work_id=?').get(token.workId) as {expected_json:string};
      const expected=z.array(sourceSchema).parse(JSON.parse(row.expected_json));
      const present=new Set(this.readStaged(token,expected).map(chunk=>chunk.entryId));
      if(expected.some(entry=>!present.has(entry.entryId)))return false;
      this.db.prepare('INSERT OR REPLACE INTO cache_work VALUES(?,?)').run(token.workId,token.workGeneration);
      this.db.prepare('DELETE FROM cache_stage WHERE work_id=?').run(token.workId);
      this.db.prepare('DELETE FROM embedding_chunk WHERE work_id=? AND work_generation<>?').run(token.workId,token.workGeneration);
      return true;
    })();
  }
  discardStage(token:CacheToken):void {
    tokenSchema.parse(token);if(!this.stageCurrent(token))return;
    this.db.transaction(()=> {this.db.prepare('DELETE FROM cache_stage WHERE work_id=?').run(token.workId);
      this.db.prepare('DELETE FROM embedding_chunk WHERE work_id=? AND work_generation=?').run(token.workId,token.workGeneration);})();
  }
  writeCAS(token:CacheToken,value:CacheEntry):boolean {
    return this.write(token,value,false);
  }
  private write(token:CacheToken,value:CacheEntry,staged:boolean):boolean {
    const checked=tokenSchema.parse(token),entry=entrySchema.parse(value);
    validChunkSequence(entry.chunks);for(const chunk of entry.chunks)validVector(chunk.vector);
    return this.db.transaction(()=> {
      let current:CacheToken;try{current=this.getWorkToken(checked.workId);}catch{return false;}
      if(staged?!this.stageCurrent(checked):JSON.stringify(current)!==JSON.stringify(checked))return false;
      if(staged) {
        const row=this.db.prepare('SELECT expected_json FROM cache_stage WHERE work_id=?').get(checked.workId) as {expected_json:string};
        if(!(JSON.parse(row.expected_json) as {entryId:string;bodyHash:string}[]).some(item=>item.entryId===entry.entryId && item.bodyHash===entry.bodyHash))return false;
      }
      this.db.prepare('DELETE FROM embedding_chunk WHERE work_id=? AND entry_id=? AND work_generation=?').run(checked.workId,entry.entryId,checked.workGeneration);
      const insert=this.db.prepare('INSERT INTO embedding_chunk VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for(const chunk of entry.chunks) {
        const vector=Buffer.alloc(512*4);for(let index=0;index<512;index++)vector.writeFloatLE(chunk.vector[index],index*4);
        insert.run(checked.generation,checked.fingerprint,checked.workId,checked.workGeneration,entry.entryId,entry.bodyHash,chunk.index,chunk.start,chunk.end,chunk.text,chunk.tokenCount,512,vector);
      }
      return true;
    })();
  }
  readWork(workId:string,values:{entryId:string;bodyHash:string}[]):CachedChunk[] {
    ownerIdentity.parse(workId);return this.readToken(this.getWorkToken(workId),values);
  }
  private readToken(token:CacheToken,values:{entryId:string;bodyHash:string}[]):CachedChunk[] {
    const workId=token.workId,sources=z.array(sourceSchema).parse(values);
    const allowed=new Map(sources.map(item=>[item.entryId,item.bodyHash]));
    try {
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
