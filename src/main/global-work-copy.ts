import { globalWorkCopyRequestSchema } from '../shared/global-work-copy';
import { globalKnowledgeFrozenSchema } from '../shared/global-knowledge-schema';
import type { WorkDetail } from '../shared/contracts';

interface Commands { execute(command: string, payload: unknown): Promise<unknown> }
interface GlobalClient { request(command: string, payload: unknown): Promise<unknown> }
/** 作品提交为成功边界；全局使用台账故障不会伪装成作品未落盘。 */
export class GlobalWorkCopyCommands {
  private readonly active = new Set<Promise<WorkDetail>>();
  constructor(private readonly store: Commands, private readonly global: GlobalClient) {}
  accepts(command: string) { return command === 'freezeGlobalKnowledge'; }
  execute(command: string, value: unknown): Promise<WorkDetail> {
    const task = this.copy(command, value); this.active.add(task);
    void task.then(() => this.active.delete(task), () => this.active.delete(task));
    return task;
  }
  async drain(): Promise<void> { while (this.active.size) await Promise.allSettled([...this.active]); }
  private async copy(command: string, value: unknown): Promise<WorkDetail> {
    if (!this.accepts(command)) throw new Error('未知全局知识复制命令。');
    const request = globalWorkCopyRequestSchema.parse(value);
    let work = await this.store.execute('getGlobalFreezeReceipt', request) as WorkDetail | null;
    if (!work) {
      const frozen = globalKnowledgeFrozenSchema.parse(await this.global.request('readFrozen', { entries: request.entries }));
      work = await this.store.execute('freezeGlobalKnowledge', { workId: request.workId, request, frozen }) as WorkDetail;
    }
    // 同一操作重试会再次修复台账，不会重复插入作品副本。
    await this.global.request('recordUsage', { operationId: request.operationId, workId: work.id,
      workRevision: work.revision, entries: request.entries }).catch(() => {});
    return work;
  }
}
