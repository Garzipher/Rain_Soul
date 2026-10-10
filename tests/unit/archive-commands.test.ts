import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { ArchiveCommands } from '../../src/main/archive-commands';
import { createProjectArchive, parseProjectArchive } from '../../src/main/project-archive';
it('归档预览不会写入项目，只有确认同token才导入新作品，回执丢失可重放', async () => {
  const db = new Database(':memory:'); db.exec('CREATE TABLE example (id TEXT)'); const database = db.serialize(); db.close();
  const bytes = await createProjectArchive(database, { projectId: randomUUID(), schemaVersion: 4 });
  const requests: unknown[] = [];
  const service = new ArchiveCommands({ execute: async (_command, request) => { requests.push(request); return { id: 'new' }; } }, { choose: async () => ({ name: '作品.rainsoul', bytes }), save: async () => true });
  const preview = await service.execute('chooseProjectArchive', {}) as { token: string };
  expect(requests).toEqual([]);
  await expect(service.execute('confirmProjectArchive', { token: randomUUID(), operationId: randomUUID() })).rejects.toThrow(/预览/);
  const request = { token: preview.token, operationId: randomUUID() };
  await service.execute('confirmProjectArchive', request); await service.execute('confirmProjectArchive', request);
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
});
it('当前项目归档清单标注真实V6，避免新数据库被误标旧版本', async () => {
  const db = new Database(':memory:'); db.exec('CREATE TABLE example (id TEXT)'); const bytes = db.serialize(); db.close();
  const workId = randomUUID(); let saved!: Buffer;
  const service = new ArchiveCommands({ execute: async command => command === 'freezeWork' ? { id: workId, title: '来源作品', revision: 2 } : bytes },
    { choose: async () => null, save: async (_name, value) => { saved = value; return true; } });
  await service.execute('exportProjectArchive', { workId });
  expect((await parseProjectArchive(saved)).manifest.schemaVersion).toBe(7);
});
