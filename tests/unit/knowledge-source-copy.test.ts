import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';
import { readSourceAssets } from '../../src/workers/database/source-document';
import { commitSourceAssets } from '../../src/workers/database/source-document';
import { freezeSource } from '../../src/main/freeze-source';
import { copyKnowledgeSources } from '../../src/workers/database/source-copy';
import type { WorkDetail } from '../../src/shared/contracts';

let directory:string, repository:WorkRepository, source:WorkDetail, target:WorkDetail;
const annotation={technique:'以光写温度',usage:'温暖场景',exercise:'改写冷色灯光'};
beforeEach(()=> {
  directory=mkdtempSync(join(tmpdir(),'rainsoul-source-copy-')); repository=new WorkRepository(directory);
  source=repository.createWork('原作品');
  const sourceDocument=freezeSource({kind:'web',title:'雨夜灯火',originalUrl:'https://article.example.com/original',finalUrl:'https://article.example.com/final',fetchedAt:'2026-10-10T00:00:00.000Z',
    rawBytes:Buffer.from('灯火很暖。雨落窗边。'),segments:[{text:'灯火很暖。'},{text:'雨落窗边。'}]});
  source=repository.importBookExtraction({workId:source.id,expectedRevision:source.revision,operationId:randomUUID(),sourceDocument,
    items:sourceDocument.segments.map(segment=>({body:segment.text,source:'原作品第二章',categoryId:source.assets!.categories[0].id,tagIds:[],segmentId:segment.id,annotation}))});
  target=repository.createWork('目标作品');
});
afterEach(()=>{repository.close();rmSync(directory,{recursive:true,force:true});});
const path=(workId:string)=>join(directory,'Projects',workId,'project.sqlite');
function assets(workId:string) {const db=new Database(path(workId),{readonly:true});try{return readSourceAssets(db);}finally{db.close();}}
const request=()=>({workId:target.id,expectedRevision:target.revision,operationId:randomUUID(),sourceWorkId:source.id,
  sourceExpectedRevision:source.revision,sourceEntryId:source.assets!.knowledge[0].id,categoryId:target.assets!.categories[1].id,tagIds:[]});

it('跨作品复制同时映射来源、完整段落和学习注释ID，保留哈希及网址追溯，不复制其他知识关联',()=> {
  const before=assets(source.id), command=request(); target=repository.copyKnowledge(command);
  const copied=assets(target.id), entry=target.assets!.knowledge[0];
  expect(copied.documents).toHaveLength(1); expect(copied.documents[0]).toEqual({...before.documents[0],id:expect.any(String),
    segments:before.documents[0].segments.map(segment=>({...segment,id:expect.any(String)}))});
  expect(copied.documents[0].id).not.toBe(before.documents[0].id);
  expect(copied.documents[0].segments.every(segment=>!before.documents[0].segments.some(original=>original.id===segment.id))).toBe(true);
  const originalLink=before.links.find(link=>link.entryId===command.sourceEntryId)!;
  const index=before.documents[0].segments.findIndex(segment=>segment.id===originalLink.segmentId);
  expect(copied.links).toEqual([{entryId:entry.id,sourceId:copied.documents[0].id,segmentId:copied.documents[0].segments[index].id}]);
  expect(copied.annotations).toEqual([{...annotation,id:expect.any(String),entryId:entry.id}]);
  expect(before.annotations.some(item=>item.id===copied.annotations[0].id)).toBe(false);
  expect(entry.origin).toMatchObject({workId:source.id,entryId:command.sourceEntryId,sourceRevision:source.revision});
  expect(assets(source.id)).toEqual(before); expect(repository.openWork(source.id).revision).toBe(source.revision);
  expect(repository.copyKnowledge(command).assets!.knowledge).toHaveLength(1); expect(assets(target.id)).toEqual(copied);
});
it('源作品修改删除不影响已复制证据，复制链保留实际网页来源与各阶段作品出处',()=> {
  const command=request(); target=repository.copyKnowledge(command); const frozen=assets(target.id);
  source=repository.manageAssets({workId:source.id,expectedRevision:source.revision,operationId:randomUUID(),action:{type:'deleteKnowledge',id:command.sourceEntryId}});
  expect(assets(target.id)).toEqual(frozen);
  const third=repository.createWork('再复用作品');
  const copied=repository.copyKnowledge({workId:third.id,expectedRevision:third.revision,operationId:randomUUID(),sourceWorkId:target.id,
    sourceExpectedRevision:target.revision,sourceEntryId:target.assets!.knowledge[0].id,categoryId:third.assets!.categories[0].id,tagIds:[]});
  expect(copied.assets!.knowledge[0].origin).toMatchObject({workId:target.id,entryId:target.assets!.knowledge[0].id});
  expect(assets(third.id).documents[0].originalUrl).toBe('https://article.example.com/original');
  expect(assets(third.id).annotations[0]).toMatchObject(annotation);
});
it('来源注释落盘失败时知识、来源、回执及revision整体回滚，修复后同操作可重新提交',()=> {
  const command=request(), db=new Database(path(target.id));
  db.exec("CREATE TRIGGER reject_annotation BEFORE INSERT ON learning_annotation BEGIN SELECT RAISE(ABORT,'模拟注释失败'); END;"); db.close();
  expect(()=>repository.copyKnowledge(command)).toThrow(/模拟注释失败/);
  expect(repository.openWork(target.id).revision).toBe(target.revision); expect(repository.openWork(target.id).assets!.knowledge).toEqual([]);
  expect(assets(target.id)).toEqual({documents:[],links:[],annotations:[]});
  const repaired=new Database(path(target.id));repaired.exec('DROP TRIGGER reject_annotation');repaired.close();
  target=repository.copyKnowledge(command); expect(assets(target.id).annotations).toHaveLength(1); expect(target.revision).toBe(command.expectedRevision+1);
});
it('来源哈希或学习注释损坏禁止复制，不能落下只有正文的半份知识',()=> {
  for(const corruption of ["UPDATE source_document SET body_hash='"+'a'.repeat(64)+"'", "UPDATE learning_annotation SET payload_json='{\"technique\":1}'"]) {
    const db=new Database(path(source.id)); const repair=db.prepare('SELECT id,body_hash FROM source_document').get() as {id:string;body_hash:string};
    const annotations=db.prepare('SELECT id,payload_json FROM learning_annotation').all() as {id:string;payload_json:string}[];
    db.exec(corruption);db.close();
    expect(()=>repository.copyKnowledge(request())).toThrow(); expect(repository.openWork(target.id).assets!.knowledge).toEqual([]);
    expect(assets(target.id).documents).toEqual([]);
    const restored=new Database(path(source.id)); restored.prepare('UPDATE source_document SET body_hash=? WHERE id=?').run(repair.body_hash,repair.id);
    for(const item of annotations) restored.prepare('UPDATE learning_annotation SET payload_json=? WHERE id=?').run(item.payload_json,item.id); restored.close();
  }
});
it('同条知识关联多个来源时逐一映射，学习注释各复制一次，原文不重新获取',()=> {
  const command=request(), additional=freezeSource({kind:'paste',title:'另一参考',rawBytes:Buffer.from('风声渐远'),segments:[{text:'风声渐远'}]});
  const db=new Database(path(source.id));
  db.transaction(()=>commitSourceAssets(db,additional,[{entryId:command.sourceEntryId,sourceId:additional.id,segmentId:additional.segments[0].id}],
    [{...annotation,id:randomUUID(),entryId:command.sourceEntryId}]))();db.close();
  target=repository.copyKnowledge(command);const copied=assets(target.id);
  expect(copied.documents).toHaveLength(2); expect(copied.links).toHaveLength(2); expect(copied.annotations).toHaveLength(2);
  expect(new Set(copied.documents.map(document=>document.id)).size).toBe(2);
  expect(copied.links.every(link=>link.entryId===target.assets!.knowledge[0].id && copied.documents.some(document=>document.id===link.sourceId && document.segments.some(segment=>segment.id===link.segmentId)))).toBe(true);
});
it('损坏跨表段落关系禁止复制，不留下知识或来源残片',()=> {
  const command=request(), db=new Database(path(source.id));
  try { db.pragma('foreign_keys=OFF'); db.prepare('UPDATE knowledge_source SET segment_id=? WHERE entry_id=?').run(randomUUID(),command.sourceEntryId); }
  finally {db.close();}
  expect(()=>repository.copyKnowledge(command)).toThrow(/关联损坏/);
  expect(repository.openWork(target.id).assets!.knowledge).toEqual([]);expect(assets(target.id).documents).toEqual([]);
});
it('来源复制必须在目标事务内完成，读取单条证据不混入其他知识关联和注释',()=> {
  const command=request(), evidence=assets(source.id), db=new Database(path(target.id));
  try { expect(()=>copyKnowledgeSources(db,evidence,command.sourceEntryId,randomUUID())).toThrow(/事务/); }
  finally {db.close();}
  const sourceDb=new Database(path(source.id),{readonly:true});
  try {
    const scoped=readSourceAssets(sourceDb,command.sourceEntryId);
    expect(scoped.documents).toHaveLength(1); expect(scoped.documents[0].segments).toHaveLength(2);
    expect(scoped.links).toHaveLength(1);expect(scoped.annotations).toHaveLength(1);
    expect(scoped.links[0].entryId).toBe(command.sourceEntryId);expect(scoped.annotations[0].entryId).toBe(command.sourceEntryId);
    expect(()=>readSourceAssets(sourceDb,'../invalid')).toThrow();
  } finally {sourceDb.close();}
});
