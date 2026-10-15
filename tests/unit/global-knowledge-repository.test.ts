import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { GlobalKnowledgeRepository } from '../../src/workers/global-knowledge/repository';

const cleanup: (() => void)[] = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });
async function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-global-')); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const repo = await GlobalKnowledgeRepository.open(directory); cleanup.push(() => repo.close()); return repo;
}
describe('独立全局知识库事务', () => {
  it('重复操作仅写入一条，失效版本不覆盖当前库', async () => {
    const repo = await repository(), before = repo.read(), categoryId = before.categories[0].id;
    const request = { operationId: randomUUID(), expectedRevision: before.revision, action: { type: 'createKnowledge' as const, body: '雨夜', source: '本人创作', categoryId, tagIds: [] } };
    expect(repo.mutate(request).total).toBe(1); expect(repo.mutate(request).total).toBe(1);
    expect(() => repo.mutate({ ...request, operationId: randomUUID() })).toThrow('已更新');
    expect(() => repo.mutate({ ...request, action: { ...request.action, body: '改变' } })).toThrow('不同内容');
  });
  it('中文一字查询命中，两个标签必须同时满足且按页返回', async () => {
    const repo = await repository();
    for (const name of ['景物', '夜色']) repo.mutate({ operationId: randomUUID(), expectedRevision: repo.status().revision, action: { type: 'createTag', name } });
    const tags = repo.read().tags.map(item => item.id), categoryId = repo.read().categories[0].id;
    for (const selected of [tags, tags.slice(0, 1)]) repo.mutate({ operationId: randomUUID(), expectedRevision: repo.status().revision, action: { type: 'createKnowledge', body: '雨在盛夏之后落下', source: '原创', categoryId, tagIds: selected } });
    expect(repo.read({ text: '雨', tagIds: tags, limit: 1 }).total).toBe(1);
    expect(repo.read({ text: '雨', offset: 1, limit: 1 }).entries).toHaveLength(1);
  });
  it('分类不能指向子分类，删除先迁移条目且使用软删除', async () => {
    const repo = await repository();
    repo.mutate({ operationId: randomUUID(), expectedRevision: 1, action: { type: 'createCategory', name: '父分类', parentId: null } });
    const parent = repo.read().categories.find(item => item.name === '父分类')!;
    repo.mutate({ operationId: randomUUID(), expectedRevision: 2, action: { type: 'createCategory', name: '子分类', parentId: parent.id } });
    const child = repo.read().categories.find(item => item.name === '子分类')!;
    expect(() => repo.mutate({ operationId: randomUUID(), expectedRevision: 3, action: { type: 'updateCategory', id: parent.id, name: parent.name, parentId: child.id } })).toThrow('循环');
    expect(repo.status().revision).toBe(3);
  });
});
