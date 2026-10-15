import { parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { GlobalKnowledgeRepository } from './repository';
import { globalKnowledgeArchiveDataSchema } from '../../shared/global-knowledge-archive';

if (!parentPort) throw new Error('全局知识库必须在隔离worker中启动。');
const port = parentPort;
const ready = GlobalKnowledgeRepository.open(z.object({ directory: z.string().min(1) }).strict().parse(workerData).directory);
// 延迟初始化失败只影响本worker请求，不影响作品数据库worker。
void ready.catch(() => {});
let queue: Promise<unknown> = Promise.resolve();
port.on('message', (raw: unknown) => {
  const request = z.object({ requestId: z.uuid(), command: z.string(), payload: z.unknown() }).strict().safeParse(raw);
  if (!request.success) return;
  const { requestId, command, payload } = request.data;
  const task = queue.then(async () => {
    const repo = await ready;
    switch (command) {
      case 'getGlobalKnowledgeStatus': z.object({}).strict().parse(payload); return repo.status();
      case 'readGlobalKnowledge': return repo.read(payload as Parameters<typeof repo.read>[0]);
      case 'readAllGlobalKnowledge': z.object({}).strict().parse(payload); return repo.readAll();
      case 'manageGlobalKnowledge': return repo.mutate(payload as Parameters<typeof repo.mutate>[0]);
      case 'readFrozen': return repo.readFrozen(payload);
      case 'ingestExtraction': return repo.ingestExtraction(payload as Parameters<typeof repo.ingestExtraction>[0]);
      case 'recordUsage': return repo.recordUsage(payload);
      case 'exportData': z.object({}).strict().parse(payload); return repo.exportData();
      case 'importData': { const value = z.object({ operationId: z.uuid(), data: globalKnowledgeArchiveDataSchema }).strict().parse(payload); return repo.importData(value.operationId, value.data); }
      default: throw new Error('未知全局知识库命令。');
    }
  });
  queue = task.then(data => port.postMessage({ requestId, ok: true, data }), reason => {
    // 不将SQLite路径、来源正文或未处理的Zod输入回传给日志。
    const known = reason instanceof Error && 'code' in reason && ['REVISION_CONFLICT', 'INVALID_INPUT', 'NOT_FOUND'].includes(String(reason.code));
    const message = known ? reason.message : reason instanceof z.ZodError ? '全局知识库请求或资产格式无效。' : '全局知识库暂不可用，请保留当前内容并稍后重试；作品编辑不受影响。';
    port.postMessage({ requestId, ok: false, message, ...(known ? { code: String(reason.code) } : {}) });
  });
});
