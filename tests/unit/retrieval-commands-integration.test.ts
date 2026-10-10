import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';
import { StoreService } from '../../src/main/store-service';
import { RetrievalCommands } from '../../src/main/retrieval-commands';
import type { WorkDetail } from '../../src/shared/contracts';
import type { RetrievalQuery, RetrievalReply } from '../../src/shared/retrieval';
import type { RetrievalModelStatus } from '../../src/shared/retrieval-model';

let directory:string, repository:WorkRepository, store:StoreService, first:WorkDetail, second:WorkDetail;
beforeEach(()=> {
  directory=mkdtempSync(join(tmpdir(),'rainsoul-retrieval-integration-'));repository=new WorkRepository(directory);
  first=repository.createWork('雨夜作品');second=repository.createWork('山林作品');
  for(const work of [first,second]) repository.manageAssets({workId:work.id,expectedRevision:work.revision,operationId:randomUUID(),action:{
    type:'createKnowledge',body:'雨声落在屋檐下。',source:work.title,categoryId:work.assets!.categories[1].id,tagIds:[]}});
  first=repository.openWork(first.id);second=repository.openWork(second.id);
  store=new StoreService(async(command,payload)=> {
    const value=payload as {id:string;scopeId:string|null;query:Parameters<WorkRepository['searchKnowledgeScope']>[1]};
    if(command==='openWork') return repository.openWork(value.id);
    if(command==='listWorks') return repository.listWorks();
    if(command==='readKnowledgeScope') return repository.readKnowledgeScope(value.scopeId);
    if(command==='searchKnowledgeScope') return repository.searchKnowledgeScope(value.scopeId,value.query);
    throw new Error('测试运输不支持命令');
  });
});
afterEach(()=>{repository.close();rmSync(directory,{recursive:true,force:true});});
function setup(onScopeRead?:()=>void) {
  const status:RetrievalModelStatus={state:'ready',modelId:'test',fingerprint:'qualified-fingerprint',installed:true,qualified:true,bytes:100};
  const models={getStatus:vi.fn(async()=>structuredClone(status)),getActiveDirectory:vi.fn(async()=> 'trusted-model'),setEnabled:vi.fn(async()=>{}),install:vi.fn(async()=>{})};
  const client={search:vi.fn(async()=>first.assets!.knowledge.map(entry=>({workId:first.id,entryId:entry.id,bodyHash:createHash('sha256').update(entry.body).digest('hex'),
    excerpt:entry.body,source:entry.source,matchedBy:['semantic' as const],reliable:true}))),index:vi.fn(async()=>{}),close:vi.fn(),invalidateWork:vi.fn(),isIndexing:()=>false,cancel:vi.fn()};
  const transport=onScopeRead?{execute:async(command:string,value:unknown)=>{const result=await store.execute(command,value);if(command==='readKnowledgeScope')onScopeRead();return result;}}:store;
  const commands=new RetrievalCommands(transport,models,client,async()=>null);
  const query:RetrievalQuery={workId:first.id,queryId:randomUUID(),query:'雨声',mode:'hybrid',tagIds:[],page:1,pageSize:20};
  return {status,models,client,commands,query};
}
it('真实全局知识scope身份映射回源ID，分页、来源作品revision及关键词命中保持隔离',async()=> {
  await store.execute('openWork',{id:first.id});const state=setup();
  const reply=await state.commands.execute('queryKnowledge',{...state.query,workId:null,mode:'keyword',pageSize:1}) as RetrievalReply;
  expect(reply.total).toBe(2);expect(reply.hits).toHaveLength(1);
  expect(reply.sourceRevisions).toEqual({[first.id]:first.revision,[second.id]:second.revision});
  const secondPage=await state.commands.execute('queryKnowledge',{...state.query,queryId:randomUUID(),workId:null,mode:'keyword',pageSize:1,page:2}) as RetrievalReply;
  const actual=[...reply.hits,...secondPage.hits];
  expect(new Set(actual.map(hit=>hit.workId))).toEqual(new Set([first.id,second.id]));
  for(const hit of actual) expect(repository.openWork(hit.workId).assets!.knowledge.some(entry=>entry.id===hit.entryId)).toBe(true);
  expect(state.client.search).not.toHaveBeenCalled();
});
it('真实Store当前作品边界不阻断其他作品只读检索，跨作品分类筛选明确拒绝',async()=> {
  await store.execute('openWork',{id:first.id});const state=setup();
  const reply=await state.commands.execute('queryKnowledge',{...state.query,workId:second.id,mode:'keyword'}) as RetrievalReply;
  expect(reply.hits[0].workId).toBe(second.id);
  await expect(state.commands.execute('queryKnowledge',{...state.query,workId:null,categoryId:first.assets!.categories[1].id})).rejects.toThrow(/先选定作品/);
});
it('标签AND与层级分类真实筛选，仅返回当前作品符合条件的知识',async()=> {
  let work=first;
  for(const name of ['雨夜','听觉']) work=repository.manageAssets({workId:work.id,expectedRevision:work.revision,operationId:randomUUID(),action:{type:'createTag',name}});
  const tags=work.assets!.tags.map(tag=>tag.id), entry=work.assets!.knowledge[0];
  work=repository.manageAssets({workId:work.id,expectedRevision:work.revision,operationId:randomUUID(),action:{type:'createCategory',name:'雨夜子分类',parentId:entry.categoryId}});
  const child=work.assets!.categories.find(category=>category.name==='雨夜子分类')!.id;
  work=repository.manageAssets({workId:work.id,expectedRevision:work.revision,operationId:randomUUID(),action:{type:'createTag',name:'无命中标签'}});
  const absent=work.assets!.tags.find(tag=>tag.name==='无命中标签')!.id;
  work=repository.manageAssets({workId:work.id,expectedRevision:work.revision,operationId:randomUUID(),action:{type:'updateKnowledge',id:entry.id,body:entry.body,source:entry.source,categoryId:child,tagIds:tags}});
  await store.execute('openWork',{id:work.id});const state=setup();
  const reply=await state.commands.execute('queryKnowledge',{...state.query,mode:'keyword',categoryId:entry.categoryId,tagIds:tags}) as RetrievalReply;
  expect(reply.total).toBe(1);expect(reply.hits[0].entryId).toBe(entry.id);
  expect((await state.commands.execute('queryKnowledge',{...state.query,queryId:randomUUID(),mode:'keyword',tagIds:[...tags,absent]}) as RetrievalReply).total).toBe(0);
});
it('异步模型结果期间真实来源改稿使回执失效，不把旧正文交给界面',async()=> {
  await store.execute('openWork',{id:first.id});const state=setup();
  state.client.search.mockImplementationOnce(async()=> {
    const entry=first.assets!.knowledge[0];repository.manageAssets({workId:first.id,expectedRevision:first.revision,operationId:randomUUID(),action:{type:'updateKnowledge',id:entry.id,
      body:'风声替代雨声。',source:entry.source,categoryId:entry.categoryId,tagIds:[]}});return [];
  });
  await expect(state.commands.execute('queryKnowledge',state.query)).rejects.toThrow(/来源已变化/);
});
it('等待模型目录时取消不能继续启动索引或模型搜索',async()=> {
  await store.execute('openWork',{id:first.id});const state=setup();
  state.models.getActiveDirectory.mockImplementationOnce(async()=> {await state.commands.execute('cancelKnowledgeQuery',{queryId:state.query.queryId});return 'trusted-model';});
  await expect(state.commands.execute('queryKnowledge',state.query)).rejects.toThrow(/取消/);
  expect(state.client.index).not.toHaveBeenCalled();expect(state.client.search).not.toHaveBeenCalled();
});
it('模型资格在结果返回前失效，禁止交付旧模型semantic结果',async()=> {
  await store.execute('openWork',{id:first.id});const state=setup();
  state.client.search.mockImplementationOnce(async()=> {state.status.qualified=false;return [{workId:first.id,entryId:first.assets!.knowledge[0].id,
    bodyHash:createHash('sha256').update(first.assets!.knowledge[0].body).digest('hex'),excerpt:first.assets!.knowledge[0].body,source:first.title,matchedBy:['semantic' as const],reliable:true}];});
  const reply=await state.commands.execute('queryKnowledge',state.query) as RetrievalReply;
  expect(reply.status).toBe('fallback');expect(reply.modelFingerprint).toBeNull();expect(reply.hits.every(hit=>hit.matchedBy.every(mode=>mode==='keyword'))).toBe(true);
});
it('模型资格在最终来源核对的await期间失效，也不能交付semantic结果',async()=> {
  await store.execute('openWork',{id:first.id});let reads=0;
  const state=setup(()=>{reads++;if(reads===2)state.status.qualified=false;});
  const reply=await state.commands.execute('queryKnowledge',state.query) as RetrievalReply;
  expect(reply.status).toBe('fallback');expect(reply.modelFingerprint).toBeNull();expect(reply.hits.every(hit=>hit.matchedBy.every(mode=>mode==='keyword'))).toBe(true);
});
