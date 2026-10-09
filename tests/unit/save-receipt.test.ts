import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';

const documentWith = (text: string) => ({ type: 'doc' as const, content: [{
  type: 'paragraph' as const, attrs: { id: randomUUID() }, content: [{ type: 'text' as const, text }],
}] });

describe('自动保存紧凑回执', () => {
  let directory: string;
  let repository: WorkRepository;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-save-receipt-'));
    repository = new WorkRepository(directory);
  });
  afterEach(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });

  it('多次保存只记录版本与字数，不重复持久化完整知识资产', () => {
    const work = repository.createWork('回执体积');
    const assets = repository.manageAssets({ workId: work.id, expectedRevision: work.revision,
      operationId: randomUUID(), action: { type: 'createKnowledge', body: '需要保护的知识正文'.repeat(1000),
        source: '参考作品', categoryId: work.assets!.categories[0].id, tagIds: [] } });
    const operations = Array.from({ length: 5 }, () => randomUUID());
    let revision = assets.revision;
    for (const operation of operations) {
      const result = repository.saveChapter(work.id, work.chapters[0].id, '第一章', documentWith('正文'), revision, operation);
      revision = result.revision;
      expect(result.assets!.knowledge).toEqual(assets.assets!.knowledge);
    }
    const db = new Database(join(directory, 'Projects', work.id, 'project.sqlite'));
    try {
      for (const [index, operation] of operations.entries()) {
        const row = db.prepare('SELECT result_json FROM operation_log WHERE operation_id=?').get(operation) as { result_json: string };
        expect(JSON.parse(row.result_json)).toEqual({ revision: assets.revision + index + 1, wordCount: 2 });
        expect(row.result_json.length).toBeLessThan(100);
      }
    } finally { db.close(); }
  });

  it('迟到重放保持原保存回执，读取当前资产而不覆盖后续正文或再增加版本', () => {
    const work = repository.createWork('重放资产');
    const operation = randomUUID(), initial = documentWith('原正文');
    repository.saveChapter(work.id, work.chapters[0].id, '第一章', initial, work.revision, operation);
    const updated = repository.manageAssets({ workId: work.id, expectedRevision: 2,
      operationId: randomUUID(), action: { type: 'createKnowledge', body: '最新知识', source: '',
        categoryId: work.assets!.categories[0].id, tagIds: [] } });
    const latest = documentWith('后续正文');
    repository.saveChapter(work.id, work.chapters[0].id, '第一章', latest, updated.revision, randomUUID());
    repository.close(); repository = new WorkRepository(directory);
    const replay = repository.saveChapter(work.id, work.chapters[0].id, '第一章', initial, work.revision, operation);
    expect(replay).toEqual({ revision: 2, wordCount: 3, assets: repository.openWork(work.id).assets });
    expect(replay.assets!.knowledge).toEqual(updated.assets!.knowledge);
    expect(repository.openWork(work.id)).toMatchObject({ revision: 4, chapters: [{ document: latest }] });
    expect(() => repository.saveChapter(work.id, work.chapters[0].id, '第一章', latest, work.revision, operation))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(repository.openWork(work.id).revision).toBe(4);
  });
});
