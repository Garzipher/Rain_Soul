import { z } from 'zod';
import { globalKnowledgeMutationSchema, globalKnowledgePageSchema, globalKnowledgeQuerySchema } from '../shared/global-knowledge-schema';

export interface GlobalKnowledgeTransport { request(command: string, payload: unknown): Promise<unknown> }
/** 只公开受限的管理命令；冻结、审核写入和全库读取只能在主进程调用。 */
export class GlobalKnowledgeCommands {
  constructor(private readonly client: GlobalKnowledgeTransport) {}
  accepts(command: string) { return ['readGlobalKnowledge', 'manageGlobalKnowledge', 'getGlobalKnowledgeStatus'].includes(command); }
  async execute(command: string, payload: unknown): Promise<unknown> {
    if (!this.accepts(command)) throw new Error('未知全局知识库命令。');
    if (command === 'getGlobalKnowledgeStatus') {
      z.object({}).strict().parse(payload);
      try { return await this.client.request(command, {}); }
      catch { return { available: false, message: '全局知识库暂不可用，作品编辑、保存和导出仍可继续。' }; }
    }
    const input = command === 'readGlobalKnowledge' ? globalKnowledgeQuerySchema.parse(payload ?? {}) : globalKnowledgeMutationSchema.parse(payload);
    return globalKnowledgePageSchema.parse(await this.client.request(command, input));
  }
}
