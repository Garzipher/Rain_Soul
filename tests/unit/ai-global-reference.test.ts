import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AiCommands } from '../../src/main/ai-commands';
import { AiService } from '../../src/main/ai-service';
import { emptyDocument } from '../../src/shared/document';
import type { GlobalKnowledgeFrozen } from '../../src/shared/global-knowledge';
import type { AiPreparedRequest } from '../../src/shared/ai';

function fixture() {
  const document = emptyDocument(); document.content[0].content = [{ type: 'text', text: '她在雨夜里等车。' }];
  const work = { id: randomUUID(), title: '测试作品', revision: 1, chapters: [{ id: randomUUID(), title: '开篇', volumeId: null, wordCount: 7, document }], volumes: [], deletedItems: [] };
  const entry = { id: randomUUID(), revision: 1, body: '雨声轻轻敲着檐角。', source: '测试作者自有素材 / 第一章', categoryId: randomUUID(), tagIds: [], origin: null, deletedAt: null, reviewed: true as const, sourceDocumentId: null, segmentId: null };
  const frozen: GlobalKnowledgeFrozen = { libraryId: randomUUID(), revision: 1, entries: [entry], categories: [], tags: [], sourceAssets: { documents: [], links: [], annotations: [] }, metadata: [] };
  let calls = 0, failUsage = false;
  const usages: unknown[] = [];
  const provider = { id: 'cloud', name: '测试服务', baseUrl: 'https://api.example.com/v1', model: 'test' };
  const service = new AiService({ credentials: { read: async () => 'fixture-only' }, resolveHost: async () => ['8.8.8.8'], fetch: async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: '新的原创候选。' } }] })); } });
  const commands = new AiCommands({ execute: async () => work }, { get: () => ({ provider, hasCredential: true }), save: () => ({ provider, hasCredential: true }), clear: () => {} }, service, {
    request: async (command, input) => {
      if (command === 'readFrozen') return structuredClone(frozen);
      if (command === 'recordUsage') { if (failUsage) throw new Error('台账暂不可用'); usages.push(input); return; }
      throw new Error('不应调用其他命令');
    },
  });
  const request = { workId: work.id, chapterId: work.chapters[0].id, scope: 'chapter', operation: 'continue', referenceGlobalKnowledge: [{ entryId: entry.id, revision: entry.revision }] };
  const prepare = () => commands.execute('prepareAi', request) as Promise<AiPreparedRequest>;
  return { commands, request, entry, frozen, prepare, usages, calls: () => calls, failUsage: () => { failUsage = true; } };
}
it('全局参考由主进程冻结，预览显示真实内容；确认前不联网、不记使用台账', async () => {
  const test = fixture(), prepared = await test.prepare();
  expect(prepared.previewText).toContain(test.entry.body);
  expect(prepared.previewText).toContain('本次临时参考');
  expect(test.calls()).toBe(0); expect(test.usages).toEqual([]);
  await expect(test.commands.execute('prepareAi', { ...test.request, referenceGlobalKnowledge: [{ ...test.request.referenceGlobalKnowledge[0], body: '伪造正文' }] })).rejects.toThrow();
  await test.commands.execute('executeAi', { confirmationToken: prepared.confirmationToken, requestHash: prepared.requestHash, confirmed: true });
  expect(test.calls()).toBe(1); expect(test.usages).toHaveLength(1);
});
it('全局条目、注释或库身份改变后，不发送过期授权', async () => {
  for (const mutate of [(test: ReturnType<typeof fixture>) => { test.entry.revision++; }, (test: ReturnType<typeof fixture>) => { test.frozen.libraryId = randomUUID(); }, (test: ReturnType<typeof fixture>) => { test.frozen.sourceAssets.annotations.push({ id: randomUUID(), entryId: test.entry.id, technique: '新的讲解', usage: '', exercise: '' }); }]) {
    const test = fixture(), prepared = await test.prepare(); mutate(test);
    await expect(test.commands.execute('executeAi', { confirmationToken: prepared.confirmationToken, requestHash: prepared.requestHash, confirmed: true })).rejects.toThrow();
    expect(test.calls()).toBe(0);
  }
});
it('非成功边界的台账故障不会丢候选，也不自动重新发送', async () => {
  const test = fixture(), prepared = await test.prepare(); test.failUsage();
  const result = await test.commands.execute('executeAi', { confirmationToken: prepared.confirmationToken, requestHash: prepared.requestHash, confirmed: true });
  expect(result).toMatchObject({ text: '新的原创候选。', referenceNotice: expect.stringContaining('请勿') });
  expect(test.calls()).toBe(1);
});
it('作品与全局参考共同受最多五条限制，重复身份无效', async () => {
  const test = fixture();
  await expect(test.commands.execute('prepareAi', { ...test.request, referenceKnowledgeIds: Array.from({ length: 5 }, () => randomUUID()) })).rejects.toThrow();
  await expect(test.commands.execute('prepareAi', { ...test.request, referenceGlobalKnowledge: [test.request.referenceGlobalKnowledge[0], test.request.referenceGlobalKnowledge[0]] })).rejects.toThrow();
  expect(test.calls()).toBe(0);
});
