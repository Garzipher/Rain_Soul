import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WorkRepository } from '../../src/workers/database/repository';
import { StoreService } from '../../src/main/store-service';
import { assertPublicP1Command } from '../../src/main/p1-command-policy';
import { bookExtractionCommitSchema } from '../../src/shared/book-extraction';
import { assetFixture } from './assets-helper';
import { getBookExtractionReceipt } from '../../src/workers/database/book-extraction';

let directory: string, repository: WorkRepository;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'rainsoul-receipt-')); repository = new WorkRepository(directory); });
afterEach(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
it('内部回执查询缺失或已提交，返回原revision及当前作品，不重复写知识', () => {
  const work = repository.createWork('回执测试'), categoryId = work.assets!.categories[0].id;
  const request = bookExtractionCommitSchema.parse({ workId: work.id, expectedRevision: work.revision, operationId: randomUUID(),
    items: [{ body: '岸边雨声', source: '可信原文', categoryId, tagIds: [] }] });
  const lookup = { workId: work.id, operationId: request.operationId,
    requestHash: createHash('sha256').update(JSON.stringify(['book-extraction', request])).digest('hex') };
  expect(repository.getBookExtractionReceipt(lookup)).toEqual({ status: 'missing' });
  repository.importBookExtraction(request);
  const current = repository.addChapter(work.id, '后续章节', work.revision + 1, randomUUID());
  const receipt = repository.getBookExtractionReceipt(lookup);
  expect(receipt).toEqual({ status: 'committed', revision: work.revision + 1, result: current });
  expect(repository.openWork(work.id).assets!.knowledge).toHaveLength(1);
  expect(() => repository.getBookExtractionReceipt({ ...lookup, requestHash: 'b'.repeat(64) })).toThrow(/标识|哈希/);
  expect(() => repository.getBookExtractionReceipt({ ...lookup, workId: randomUUID() })).toThrow();
});
it('回执仅允许主进程访问当前作品，拒绝伪造hash、外来字段及未打开作品', async () => {
  const workId = randomUUID(), calls: string[] = [];
  const service = new StoreService(async command => { calls.push(command); return command === 'openWork' ? { id: workId } : { status: 'missing' }; });
  const lookup = { workId, operationId: randomUUID(), requestHash: 'a'.repeat(64) };
  await expect(service.execute('getBookExtractionReceipt', lookup)).rejects.toThrow(/当前作品/);
  await service.execute('openWork', { id: workId });
  await expect(service.execute('getBookExtractionReceipt', lookup)).resolves.toEqual({ status: 'missing' });
  const count = calls.length;
  for (const invalid of [{ ...lookup, workId: randomUUID() }, { ...lookup, requestHash: 'fake' }, { ...lookup, sql: 'SELECT *' }])
    await expect(service.execute('getBookExtractionReceipt', invalid)).rejects.toThrow();
  expect(calls).toHaveLength(count);
  expect(() => assertPublicP1Command('getBookExtractionReceipt', lookup)).toThrow(/主进程/);
});
it('损坏回执、超前revision、已删除作品及越权字段均明确拒绝', () => {
  const fixture = assetFixture();
  try {
    const workId = (fixture.db.prepare('SELECT id FROM work_meta').get() as { id: string }).id;
    const request = { workId, operationId: randomUUID(), requestHash: 'a'.repeat(64) };
    fixture.db.prepare('INSERT INTO operation_log VALUES(?,?,?)').run(request.operationId, request.requestHash, 'bad-json');
    expect(() => getBookExtractionReceipt(fixture.db, request)).toThrow(/损坏/);
    for (const invalid of [{ revision: 2 }, { revision: 0 }, { revision: 1, extra: true }]) {
      fixture.db.prepare('UPDATE operation_log SET result_json=?').run(JSON.stringify(invalid));
      expect(() => getBookExtractionReceipt(fixture.db, request)).toThrow(/损坏/);
    }
    expect(() => getBookExtractionReceipt(fixture.db, { ...request, requestHash: 'bad' })).toThrow(/无效/);
    expect(() => getBookExtractionReceipt(fixture.db, { ...request, workId: randomUUID() })).toThrow(/不存在/);
    fixture.db.prepare('UPDATE work_meta SET deleted_at=?').run(new Date().toISOString());
    expect(() => getBookExtractionReceipt(fixture.db, request)).toThrow(/删除/);
  } finally { fixture.db.close(); }
});
