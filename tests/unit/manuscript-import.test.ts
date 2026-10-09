import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { createImportedProject } from '../../src/workers/database/manuscript-import';
import { WorkRepository } from '../../src/workers/database/repository';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function setup() { const dir = mkdtempSync(join(tmpdir(), 'rainsoul-import-')); dirs.push(dir); return dir; }
const draft = () => ({ title: '雨夜', format: 'txt' as const, encoding: 'utf-8', warnings: [], chapters: [
  { title: '开篇', volumeTitle: null, paragraphs: ['正文一', '', 'ABC 123。'] },
  { title: '来信', volumeTitle: '第一卷', paragraphs: ['正文二'] },
  { title: '空章', volumeTitle: '第一卷', paragraphs: [] },
] });
it('完整卷章和段落写入独立新项目，重放不重复创建，不影响已有作品', () => {
  const dir = setup(), repository = new WorkRepository(dir), existing = repository.createWork('原作品'); repository.close();
  const request = { operationId: randomUUID(), draft: draft() };
  const id = createImportedProject(join(dir, 'Projects'), request);
  expect(createImportedProject(join(dir, 'Projects'), request)).toBe(id);
  const reopened = new WorkRepository(dir);
  try {
    const work = reopened.openWork(id);
    expect(work.volumes.map(v => v.title)).toEqual(['第一卷']);
    expect(work.chapters.map(c => c.title)).toEqual(['开篇', '来信', '空章']);
    expect(work.chapters.map(c => c.wordCount)).toEqual([9, 3, 0]);
    expect(work.chapters[0].document.content).toHaveLength(3);
    expect(reopened.openWork(existing.id).chapters[0].wordCount).toBe(0);
    expect(reopened.listWorks()).toHaveLength(2);
  } finally { reopened.close(); }
  const db = new Database(join(dir, 'Projects', id, 'project.sqlite'));
  try { expect(db.pragma('foreign_key_check')).toEqual([]); } finally { db.close(); }
});
it('复用操作ID但修改内容拒绝，非法草稿不能留下半成品', () => {
  const dir = setup(), request = { operationId: randomUUID(), draft: draft() }, projects = join(dir, 'Projects');
  createImportedProject(projects, request);
  const before = readdirSync(projects);
  expect(() => createImportedProject(projects, { ...request, draft: { ...draft(), title: '另一稿' } })).toThrow(/操作/);
  expect(() => createImportedProject(projects, { operationId: randomUUID(), draft: { ...draft(), chapters: [{ title: '', volumeTitle: null, paragraphs: ['内容'] }] } })).toThrow();
  expect(readdirSync(projects)).toEqual(before);
});
