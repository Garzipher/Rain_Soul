import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { ArchiveCommands } from '../../src/main/archive-commands';
import { createProjectArchive } from '../../src/main/project-archive';
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
