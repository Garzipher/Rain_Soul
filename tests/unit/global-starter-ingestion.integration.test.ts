import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GlobalBookExtractionCommands } from '../../src/main/global-book-extraction-commands';
import { GlobalKnowledgeRepository } from '../../src/workers/global-knowledge/repository';
import { globalSourceStarters, globalSourceStarterText, type GlobalSourceStarter } from '../../src/shared/global-source-starter';
import type { GlobalBookExtractionConfirmation, GlobalExtractionPreview } from '../../src/shared/global-book-extraction';
import type { GlobalExtractionCommit, GlobalKnowledgePage } from '../../src/shared/global-knowledge';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'test-rainsoul-starter-'));
  // 仅清理本测试新建、已解析且属于临时根目录的隔离数据。
  cleanup.push(async () => {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('测试目录越界');
    await rm(directory, { recursive: true, force: true });
  });
  let repository = await GlobalKnowledgeRepository.open(join(directory, 'global'));
  cleanup.push(async () => repository.close());
  const client = { request: async (command: string, payload: unknown) => {
    if (command !== 'ingestExtraction') throw new Error(`意外全局请求：${command}`);
    return repository.ingestExtraction(payload as GlobalExtractionCommit);
  } };
  const createCommands = () => new GlobalBookExtractionCommands({ choose: async () => null }, client, join(directory, 'draft'));
  return { get repository() { return repository; }, commands: createCommands(), createCommands,
    async reopen() { repository.close(); repository = await GlobalKnowledgeRepository.open(join(directory, 'global')); } };
}

function starterRequest(starter: GlobalSourceStarter) {
  // 与全局拆书“载入预览”实际发送协议一致，不发起网页或云端请求。
  return { starterId: starter.id, title: `${starter.workTitle} · ${starter.chapter}`, text: globalSourceStarterText(starter), source: {
      workUrl: starter.workUrl, chapterUrl: starter.chapterUrl, author: starter.author,
      chapter: starter.chapter, fetchedAt: starter.fetchedAt, metrics: starter.metrics,
    } };
}
async function preview(commands: GlobalBookExtractionCommands, starter: GlobalSourceStarter) {
  return await commands.execute('previewGlobalPastedExtraction', starterRequest(starter)) as GlobalExtractionPreview;
}

function confirmation(repository: GlobalKnowledgeRepository, value: GlobalExtractionPreview, starter: GlobalSourceStarter): GlobalBookExtractionConfirmation {
  return { token: value.token, operationId: randomUUID(), expectedRevision: repository.status().revision,
    permissionConfirmed: true, sourceTitle: starter.workTitle, sourceAuthor: starter.author,
    chapter: starter.chapter, rightsBasis: 'public-excerpt', metrics: starter.metrics,
    items: value.segments.map((segment, index) => ({ segmentId: segment.id, body: segment.text,
      categoryId: repository.read().categories.find(category => category.systemKey === starter.excerpts[index].categoryKey)!.id,
      tagIds: [], annotation: starter.excerpts[index].annotation })),
  };
}

describe('首批素材真实 SQLite 审核入库（后台隔离集成）', () => {
  for (const starter of globalSourceStarters) {
    it(`${starter.workTitle}：预览与审核草稿不入库，确认后来源和讲解持久化，重开可读`, async () => {
      const context = await setup();
      expect(context.repository.read().total).toBe(0);
      const value = await preview(context.commands, starter), request = confirmation(context.repository, value, starter);
      expect(context.repository.read().total).toBe(0);
      await context.commands.execute('saveGlobalExtractionReview', { token: value.token,
        reviews: request.items.map(item => ({ ...item, status: 'approved' })),
        metadata: { sourceTitle: starter.workTitle, sourceAuthor: starter.author, chapter: starter.chapter, rightsBasis: 'public-excerpt', metrics: starter.metrics } });
      expect(context.repository.read().total).toBe(0);
      const page = await context.commands.execute('confirmGlobalBookExtraction', request) as GlobalKnowledgePage;
      expect(page.total).toBe(starter.excerpts.length);
      expect(page.entries.map(entry => entry.body).sort()).toEqual(starter.excerpts.map(item => item.text).sort());
      expect(page.entries.every(entry => entry.reviewed)).toBe(true);
      expect(page.annotations).toHaveLength(starter.excerpts.length);
      for (const excerpt of starter.excerpts) {
        const entry = page.entries.find(item => item.body === excerpt.text)!;
        expect(page.annotations.find(item => item.entryId === entry.id)).toMatchObject(excerpt.annotation);
        expect(entry.source).toContain(starter.author); expect(entry.source).toContain(starter.workTitle);
      }
      await context.reopen();
      const frozen = context.repository.readFrozen({ entries: page.entries.map(entry => ({ entryId: entry.id, revision: entry.revision })) });
      expect(frozen.entries).toHaveLength(starter.excerpts.length);
      expect(frozen.metadata).toEqual([expect.objectContaining({ author: starter.author, workTitle: starter.workTitle,
        chapter: starter.chapter, rightsBasis: 'public-excerpt', capturedAt: starter.fetchedAt, metrics: starter.metrics })]);
      expect(frozen.sourceAssets.documents[0]).toMatchObject({ originalUrl: starter.workUrl, finalUrl: starter.chapterUrl });
      expect(frozen.sourceAssets.annotations).toHaveLength(starter.excerpts.length);
      const recovery = await context.createCommands().execute('readGlobalExtractionDraft', undefined) as { draft: { reviews: { status: string }[] } };
      expect(recovery.draft.reviews.every(item => item.status === 'committed')).toBe(true);
    });
  }

  it('重复确认明确拒绝，正式条目数量不增加；取消和放弃草稿均不入库', async () => {
    const context = await setup(), starter = globalSourceStarters[0];
    const value = await preview(context.commands, starter), request = confirmation(context.repository, value, starter);
    await context.commands.execute('confirmGlobalBookExtraction', request);
    await expect(context.commands.execute('confirmGlobalBookExtraction', request)).rejects.toThrow(/再次提交/);
    expect(context.repository.read().total).toBe(starter.excerpts.length);
    await context.commands.execute('discardGlobalExtractionDraft', { token: value.token });
    const next = await preview(context.commands, globalSourceStarters[1]);
    await context.commands.execute('cancelGlobalBookExtraction', { token: next.token });
    expect(context.repository.read().total).toBe(starter.excerpts.length);
    await context.createCommands().execute('readGlobalExtractionDraft', undefined);
    const reopened = context.createCommands();
    await reopened.execute('readGlobalExtractionDraft', undefined);
    await reopened.execute('discardGlobalExtractionDraft', { token: next.token });
    expect(context.repository.read().total).toBe(starter.excerpts.length);
    expect(await reopened.execute('readGlobalExtractionDraft', undefined)).toBeNull();
  });

  it('伪造摘录拒绝且不入库；其后可继续正常审核', async () => {
    const context = await setup(), starter = globalSourceStarters[0];
    const value = await preview(context.commands, starter), request = confirmation(context.repository, value, starter);
    await expect(context.commands.execute('confirmGlobalBookExtraction', { ...request,
      items: [{ ...request.items[0], body: 'test 伪造的原文句子' }] })).rejects.toThrow(/逐字/);
    expect(context.repository.read().total).toBe(0);
    await context.commands.execute('confirmGlobalBookExtraction', request);
    expect(context.repository.read().total).toBe(starter.excerpts.length);
  });

  it('AI 处理中禁止确认和修改审核，处理结束后才可入库', async () => {
    const context = await setup(), starter = globalSourceStarters[0];
    const value = await preview(context.commands, starter), request = confirmation(context.repository, value, starter);
    await context.commands.setAiBusy(value.token, true);
    await expect(context.commands.execute('confirmGlobalBookExtraction', request)).rejects.toThrow(/AI 拆书仍在处理/);
    await expect(context.commands.execute('saveGlobalExtractionReview', { token: value.token, reviews: [] })).rejects.toThrow(/AI 拆书仍在处理/);
    expect(context.repository.read().total).toBe(0);
    await context.commands.setAiBusy(value.token, false);
    await context.commands.execute('confirmGlobalBookExtraction', request);
    expect(context.repository.read().total).toBe(starter.excerpts.length);
  });

  it('失效分类导致整批事务回滚，不留下来源、条目或版本增量', async () => {
    const context = await setup(), starter = globalSourceStarters[0];
    const value = await preview(context.commands, starter), request = confirmation(context.repository, value, starter);
    const revision = context.repository.status().revision;
    await expect(context.commands.execute('confirmGlobalBookExtraction', { ...request,
      items: [request.items[0], { ...request.items[1], categoryId: randomUUID() }] })).rejects.toThrow(/分类或标签不存在/);
    expect(context.repository.read().total).toBe(0);
    expect(context.repository.status().revision).toBe(revision);
    expect(context.repository.exportData().sourceAssets.documents).toHaveLength(0);
  });

  it.each(globalSourceStarters)('$workTitle 的原始段落编号在预览、草稿重开和正式入库后均保留', async starter => {
    const context = await setup();
    const value = await preview(context.commands, starter), request = confirmation(context.repository, value, starter);
    expect(value.segments.map(segment => segment.paragraphIndex)).toEqual(starter.excerpts.map(item => item.paragraphIndex));
    const reopened = context.createCommands();
    const recovered = await reopened.execute('readGlobalExtractionDraft', undefined) as { preview: GlobalExtractionPreview };
    expect(recovered.preview.segments.map(segment => segment.paragraphIndex)).toEqual(starter.excerpts.map(item => item.paragraphIndex));
    const page = await reopened.execute('confirmGlobalBookExtraction', request) as GlobalKnowledgePage;
    const original = starter.excerpts[1], entry = page.entries.find(item => item.body === original.text)!;
    expect(entry.source).toContain(`原文第${original.paragraphIndex}段`);
    const frozen = context.repository.readFrozen({ entries: [{ entryId: entry.id, revision: entry.revision }] });
    expect(frozen.sourceAssets.documents[0].segments.find(segment => segment.id === entry.segmentId)?.paragraphIndex).toBe(original.paragraphIndex);
  });

  it('未知首批身份或被替换的原文、标题、出处不能借用首批坐标，失败后无草稿和正式条目', async () => {
    const context = await setup(), request = starterRequest(globalSourceStarters[0]);
    for (const invalid of [
      { ...request, starterId: 'test-unknown-source' },
      { ...request, text: 'test被改写的摘录' },
      { ...request, title: 'test被替换的作品' },
      { ...request, source: { ...request.source, chapterUrl: 'https://example.com/chapter' } },
    ]) {
      await expect(context.commands.execute('previewGlobalPastedExtraction', invalid)).rejects.toThrow(/首批/);
      expect(await context.commands.execute('readGlobalExtractionDraft', undefined)).toBeNull();
      expect(context.repository.read().total).toBe(0);
    }
  });

  it('普通粘贴不因文本与首批相同而被冒认为原著坐标', async () => {
    const context = await setup(), starter = globalSourceStarters[0];
    const value = await context.commands.execute('previewGlobalPastedExtraction', {
      title: 'test个人粘贴', text: globalSourceStarterText(starter),
    }) as GlobalExtractionPreview;
    expect(value.source?.kind).toBe('paste');
    expect(value.source?.segments.every(segment => segment.paragraphIndex === undefined)).toBe(true);
    expect(value.source?.originalUrl).toBeNull();
  });
});
