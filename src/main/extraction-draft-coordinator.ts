import { createHash, randomUUID } from 'node:crypto';
import type { WorkDetail } from '../shared/contracts';
import { bookExtractionCommitSchema, type BookExtractionCommit, type BookExtractionPreview } from '../shared/book-extraction';
import { extractionDraftSchema, type ExtractionDraft } from '../shared/extraction-draft';
import { ExtractionDraftStore } from './extraction-draft-store';

interface Store { execute(command: string, payload: unknown): Promise<unknown> }
type Receipt = { status: 'missing' } | { status: 'committed'; revision: number; result: WorkDetail };
const workQueues=new Map<string,Promise<unknown>>();
/** 未知结果保留原请求，只查本机回执或同身份重放，不能刷新revision后另发。 */
export class ExtractionDraftCoordinator {
  constructor(private readonly drafts: ExtractionDraftStore, private readonly store: Store) {}
  private serial<T>(workId:string, action:()=>Promise<T>):Promise<T> {
    const result=(workQueues.get(workId)??Promise.resolve()).catch(()=>{}).then(action);
    workQueues.set(workId,result);
    void result.finally(()=>{if(workQueues.get(workId)===result) workQueues.delete(workId);}).catch(()=>{});
    return result;
  }
  async begin(preview: BookExtractionPreview, isCurrent:()=>boolean=()=>true): Promise<ExtractionDraft> {
    return this.serial(preview.workId,()=>this.beginCurrent(preview,isCurrent));
  }
  private async beginCurrent(preview:BookExtractionPreview,isCurrent:()=>boolean):Promise<ExtractionDraft> {
    if(!isCurrent()) throw new Error('拆文预览已被新素材替换。');
    if (!preview.source) throw new Error('拆文预览缺少冻结来源。');
    const current = await this.drafts.readExtractionDraft(preview.workId);
    if (current?.committing) throw new Error('请先核对上一批入库回执，再替换素材。');
    if(!isCurrent()) throw new Error('拆文预览已被新素材替换。');
    return this.drafts.saveExtractionDraft({ expectedTaskId: current?.taskId ?? null,
      draft: { schemaVersion: 1, taskId: randomUUID(), workId: preview.workId, previewToken: preview.token, source: preview.source,
        batches: [], reviews: [], committing: null } });
  }
  async read(workId: string) { return this.drafts.readExtractionDraft(workId); }
  /** 主进程只能追加或完成同一批次，不能改写来源、审核内容及提交请求。 */
  async recordBatch(workId:string,previewToken:string,value:ExtractionDraft['batches'][number]):Promise<ExtractionDraft> {
    return this.serial(workId,async()=> {
      const draft=await this.drafts.readExtractionDraft(workId);
      if(!draft || draft.previewToken!==previewToken) throw new Error('拆文预览已失效，不能保存到新任务。');
      const batch=extractionDraftSchema.shape.batches.element.parse(value);
      const previous=draft.batches.find(item=>item.id===batch.id || item.requestHash===batch.requestHash);
      if(previous) {
        const evidence=(item:typeof batch)=>[item.id,item.requestHash,item.segmentIds,item.categoryIds,item.tagIds,item.dictionaryHash];
        if(JSON.stringify(evidence(previous))!==JSON.stringify(evidence(batch))) throw new Error('批次冻结证据不能改写。');
        if(previous.status==='ready' && JSON.stringify(previous)!==JSON.stringify(batch)) throw new Error('完成批次只读，不能覆盖已有回答。');
      } else if(batch.status!=='running') throw new Error('新批次必须先保存发送状态。');
      return this.drafts.saveExtractionDraft({expectedTaskId:draft.taskId,draft:{...draft,
        batches:previous?draft.batches.map(item=>item.id===batch.id?batch:item):[...draft.batches,batch]}});
    });
  }
  async saveReviews(workId:string,previewToken:string,values:ExtractionDraft['reviews']):Promise<ExtractionDraft> {
    return this.serial(workId,async()=> {
      const draft=await this.drafts.readExtractionDraft(workId);
      if(!draft || draft.previewToken!==previewToken) throw new Error('拆文预览已失效，请重新读取。');
      if(draft.committing) throw new Error('入库回执待核对，不能改写审核内容。');
      const reviews=extractionDraftSchema.shape.reviews.parse(values);
      const committed=draft.reviews.filter(review=>review.status==='committed'), prior=new Map(committed.map(review=>[review.segmentId,review]));
      for(const review of reviews) {
        const saved=prior.get(review.segmentId);
        if(saved && JSON.stringify(saved)!==JSON.stringify(review) || !saved && review.status==='committed') throw new Error('已提交段落只读，不能伪造入库状态。');
      }
      return this.drafts.saveExtractionDraft({expectedTaskId:draft.taskId,draft:{...draft,reviews:[...committed,...reviews.filter(review=>!prior.has(review.segmentId))]}});
    });
  }
  async discard(workId:string,taskId:string):Promise<void> {
    return this.serial(workId,()=>this.drafts.discardExtractionDraft(workId,taskId));
  }
  private async settled(draft: ExtractionDraft, work: WorkDetail) {
    const request = draft.committing!.request, ids = new Set(request.items.map(item => item.segmentId));
    const reviews = draft.reviews.filter(review => !ids.has(review.segmentId));
    for (const item of request.items) reviews.push({ segmentId: item.segmentId!, body: item.body, categoryId: item.categoryId,
      tagIds: item.tagIds, status: 'committed', ...(item.annotation ? { annotation: item.annotation } : {}) });
    const next = await this.drafts.settleExtractionDraft({ draft: { ...draft, reviews, committing: null }, expectedTaskId: draft.taskId },request.operationId,draft.committing!.requestHash);
    return { draft: next, work };
  }
  async recover(workId: string): Promise<{ draft: ExtractionDraft; work?: WorkDetail } | null> {
    return this.serial(workId,()=>this.recoverCurrent(workId));
  }
  private async recoverCurrent(workId:string):Promise<{draft:ExtractionDraft;work?:WorkDetail}|null> {
    const draft = await this.drafts.readExtractionDraft(workId);
    if (!draft) return null;
    if (!draft.committing) return { draft };
    const { request, requestHash } = draft.committing;
    const receipt = await this.store.execute('getBookExtractionReceipt', { workId, operationId: request.operationId, requestHash }) as Receipt;
    if (receipt.status === 'committed') return this.settled(draft, receipt.result);
    const work = await this.store.execute('importBookExtraction', request) as WorkDetail;
    return this.settled(draft, work);
  }
  async commit(value: BookExtractionCommit): Promise<WorkDetail> {
    return this.serial(value.workId,()=>this.commitCurrent(value));
  }
  private async commitCurrent(value:BookExtractionCommit):Promise<WorkDetail> {
    const request = bookExtractionCommitSchema.parse(value), draft = await this.drafts.readExtractionDraft(request.workId);
    if (!draft || JSON.stringify(draft.source) !== JSON.stringify(request.sourceDocument)) throw new Error('入库来源已失效或被替换。');
    if (draft.committing) throw new Error('上一批回执待核对，冻结请求不能改写。');
    const committed = new Set(draft.reviews.filter(review => review.status === 'committed').map(review => review.segmentId));
    if (request.items.some(item => committed.has(item.segmentId!))) throw new Error('已入库段落不能重复提交。');
    const pending = await this.drafts.saveExtractionDraft({ expectedTaskId: draft.taskId,
      draft: { ...draft, committing: { request, requestHash: createHash('sha256').update(JSON.stringify(['book-extraction', request])).digest('hex') } } });
    const work = await this.store.execute('importBookExtraction', request) as WorkDetail;
    await this.settled(pending, work); return work;
  }
}
