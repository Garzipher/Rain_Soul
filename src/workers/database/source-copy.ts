import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { sourceAssetsSchema, learningAnnotationPayloadSchema, type SourceAssets } from '../../shared/source-assets';
import { commitSourceAssets } from './source-document';
import { RepositoryError } from './errors';

/** 仅复制该条知识的证据，冻结原文及哈希保留，目标身份全部重新分配。 */
export function copyKnowledgeSources(db:Database.Database,value:SourceAssets,sourceEntryId:string,targetEntryId:string):void {
  if(!db.inTransaction) throw new RepositoryError('INVALID_INPUT','来源复制必须在作品事务内提交。');
  const assets=sourceAssetsSchema.parse(value), links=assets.links.filter(link=>link.entryId===sourceEntryId);
  const documents=new Map(assets.documents.map(document=>[document.id,document]));
  if(links.some(link=>!documents.get(link.sourceId)?.segments.some(segment=>segment.id===link.segmentId)))
    throw new RepositoryError('INVALID_INPUT','复制来源与原文段落关联损坏。');
  for(const sourceId of new Set(links.map(link=>link.sourceId))) {
    const original=documents.get(sourceId)!, id=randomUUID();
    const segmentIds=new Map(original.segments.map(segment=>[segment.id,randomUUID()]));
    const source={...original,id,segments:original.segments.map(segment=>({...segment,id:segmentIds.get(segment.id)!}))};
    const copied=links.filter(link=>link.sourceId===sourceId).map(link=>({entryId:targetEntryId,sourceId:id,segmentId:segmentIds.get(link.segmentId)!}));
    // 单次来源写入沿用审核协议的100项上限，不截断多段证据。
    for(let offset=0;offset<copied.length;offset+=100) commitSourceAssets(db,source,copied.slice(offset,offset+100),[]);
  }
  const insert=db.prepare('INSERT INTO learning_annotation VALUES(?,?,?)');
  for(const annotation of assets.annotations.filter(item=>item.entryId===sourceEntryId))
    insert.run(randomUUID(),targetEntryId,JSON.stringify(learningAnnotationPayloadSchema.parse({technique:annotation.technique,usage:annotation.usage,exercise:annotation.exercise})));
}
