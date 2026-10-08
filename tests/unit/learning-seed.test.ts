import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDocument } from '../../src/shared/document';
import { ensureLearningWork, type LearningCourse } from '../../src/workers/database/learning-seed';
import { WorkRepository } from '../../src/workers/database/repository';

describe('项目开发学习作品', () => {
  let directory: string;
  let course: LearningCourse;
  const chapter = (key: string): LearningCourse['volumes'][number]['chapters'][number] =>
    ({ key, id: randomUUID(), title: key, document: emptyDocument() });
  const database = () => new Database(join(directory, 'Projects', course.id, 'project.sqlite'));
  const seed = () => ensureLearningWork(join(directory, 'Projects'), course);
  const readWork = () => {
    const repository = new WorkRepository(directory);
    try { return repository.openWork(course.id); } finally { repository.close(); }
  };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-learning-'));
    course = { id: '80d0c996-574e-5b8b-91d6-93fe72517231', title: '项目全流程开发学习',
      volumes: [{ key: 'foundation', id: randomUUID(), title: '基础开发', chapters: [chapter('foundation/01')] }] };
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('首次生成普通作品兼容的分卷章节，重启不会重复或改变版本时间', () => {
    seed();
    const first = readWork();
    expect(first).toMatchObject({ id: course.id, title: course.title, revision: 1,
      volumes: [{ id: course.volumes[0].id, title: '基础开发' }],
      chapters: [{ id: course.volumes[0].chapters[0].id, volumeId: course.volumes[0].id }] });
    const db = database();
    const initial = db.prepare('SELECT * FROM work_meta').get();
    db.close();
    seed();
    expect(readWork()).toEqual(first);
    const reopened = database();
    try { expect(reopened.prepare('SELECT * FROM work_meta').get()).toEqual(initial); }
    finally { reopened.close(); }
    expect(readdirSync(join(directory, 'Projects'))).toEqual([course.id]);
  });

  it('自动追加新章和新卷，只递增一次版本且正文统计正确', () => {
    seed();
    const next = chapter('foundation/02');
    next.document.content[0].content = [{ type: 'text', text: '学习 SQLite 2026。' }];
    course.volumes[0].chapters.push(next);
    course.volumes.push({ key: 'next', id: randomUUID(), title: '后续开发', chapters: [chapter('next/01')] });
    seed();
    expect(readWork()).toMatchObject({ revision: 2, chapters: [expect.anything(),
      expect.objectContaining({ id: next.id, wordCount: 12 }), expect.anything()] });
    seed();
    expect(readWork().revision).toBe(2);
  });

  it('保留作者修改的作品卷章名称、正文、段落 ID、移动位置和用户新增章节', () => {
    seed();
    const repository = new WorkRepository(directory);
    let work = repository.openWork(course.id);
    const original = work.chapters[0];
    const edited = emptyDocument();
    edited.content[0].content = [{ type: 'text', text: '我的学习笔记' }];
    repository.saveChapter(work.id, original.id, '我的章节', edited, work.revision, randomUUID());
    work = repository.openWork(work.id);
    work = repository.manageStructure({ workId: work.id, expectedRevision: work.revision, operationId: randomUUID(),
      action: { type: 'renameWork', title: '自己的名字' } })!;
    work = repository.manageStructure({ workId: work.id, expectedRevision: work.revision, operationId: randomUUID(),
      action: { type: 'renameVolume', volumeId: work.volumes[0].id, title: '我的卷' } })!;
    work = repository.manageStructure({ workId: work.id, expectedRevision: work.revision, operationId: randomUUID(),
      action: { type: 'setChapterVolume', chapterId: original.id, volumeId: null } })!;
    work = repository.addChapter(work.id, '作者新章', work.revision, randomUUID(), work.volumes[0].id);
    repository.close();
    course.volumes[0].title = '新版卷名';
    course.volumes[0].chapters[0].title = '新版章名';
    course.volumes[0].chapters[0].document = emptyDocument();
    seed();
    expect(readWork()).toEqual(work);
  });

  it('尊重整书软删除，升级不复活作品也不追加未读章节', () => {
    seed();
    const db = database();
    db.prepare('UPDATE work_meta SET deleted_at = ?').run(new Date().toISOString());
    const before = db.prepare('SELECT * FROM work_meta').get();
    db.close();
    course.volumes[0].chapters.push(chapter('foundation/02'));
    seed();
    const reopened = database();
    try {
      expect(reopened.prepare('SELECT * FROM work_meta').get()).toEqual(before);
      expect(reopened.prepare('SELECT COUNT(*) AS count FROM chapter').get()).toEqual({ count: 1 });
    } finally { reopened.close(); }
  });

  it('不复活已删卷章；已删卷暂缓新章，恢复卷后补入且独立删除章仍保留删除', () => {
    seed();
    const first = course.volumes[0].chapters[0];
    const db = database();
    db.prepare('UPDATE chapter SET deleted_at = ? WHERE id = ?').run('独立删除', first.id);
    db.prepare('UPDATE volume SET deleted_at = ?').run('卷删除');
    db.close();
    const next = chapter('foundation/02');
    course.volumes[0].chapters.push(next);
    seed();
    expect(readWork()).toMatchObject({ revision: 1, volumes: [], chapters: [] });
    const restored = database();
    restored.prepare('UPDATE volume SET deleted_at = NULL').run();
    restored.close();
    seed();
    expect(readWork()).toMatchObject({ revision: 2, chapters: [expect.objectContaining({ id: next.id })],
      deletedItems: [expect.objectContaining({ id: first.id })] });
  });

  it.each(['chapter-id', 'volume-id', 'chapter-key', 'volume-key', 'title', 'document', 'extra', 'path'])('非法课程 %s 在创建目录前拒绝', (kind) => {
    const next = chapter('foundation/02');
    const volume = course.volumes[0];
    if (kind === 'chapter-id') next.id = volume.chapters[0].id;
    if (kind === 'volume-id') next.id = volume.id;
    if (kind === 'chapter-key') next.key = volume.chapters[0].key;
    if (kind === 'volume-key') next.key = volume.key;
    if (kind === 'title') next.title = ' ';
    if (kind === 'document') next.document.content = [];
    if (kind === 'extra') Object.assign(next, { source: '不受支持的字段' });
    if (kind === 'path') course.id = '../越界';
    volume.chapters.push(next);
    expect(seed).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(existsSync(join(directory, 'Projects'))).toBe(false);
  });

  it('同名普通作品正常保留；固定 ID 被普通作品占用时不认领、不覆盖', () => {
    const repository = new WorkRepository(directory);
    const userWork = repository.createWork(course.title);
    repository.close();
    seed();
    expect(readWork().id).not.toBe(userWork.id);
    const db = database();
    db.exec('DROP TABLE learning_course');
    const before = db.prepare('SELECT * FROM work_meta').get();
    db.close();
    expect(seed).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    const unchanged = database();
    try { expect(unchanged.prepare('SELECT * FROM work_meta').get()).toEqual(before); }
    finally { unchanged.close(); }
    const reopened = new WorkRepository(directory);
    try { expect(reopened.openWork(userWork.id)).toEqual(userWork); } finally { reopened.close(); }
  });

  it('未来 schema、损坏库和缺失正文库均拒绝且不创建替代文件', () => {
    seed();
    const db = database();
    db.pragma('user_version = 99');
    db.close();
    expect(seed).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
    const file = join(directory, 'Projects', course.id, 'project.sqlite');
    writeFileSync(file, '损坏的原始文件');
    expect(seed).toThrow();
    expect(readFileSync(file, 'utf8')).toBe('损坏的原始文件');
    rmSync(file);
    expect(seed).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    expect(existsSync(file)).toBe(false);
  });

  it('源 key 改用其他 ID 或新章撞到作者章 ID 时整笔拒绝且版本正文不变', () => {
    seed();
    const before = readWork();
    const first = course.volumes[0].chapters[0];
    const originalId = first.id;
    first.id = randomUUID();
    expect(seed).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    first.id = originalId;
    const db = database();
    const colliding = chapter('foundation/03');
    db.prepare('INSERT INTO chapter (id, title, document_json, word_count, sort_order) VALUES (?, ?, ?, 0, 0)')
      .run(colliding.id, '作者章节', JSON.stringify(emptyDocument()));
    db.close();
    const withUserChapter = readWork();
    course.volumes[0].chapters.push(chapter('foundation/02'), colliding);
    expect(seed).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    expect(readWork()).toEqual(withUserChapter);
    expect(readWork().revision).toBe(before.revision);
  });

  it('追加过程中 SQLite 失败时新增卷章和版本全部回滚，重试仅追加一次', () => {
    seed();
    const before = readWork();
    const next = { key: 'next', id: randomUUID(), title: '新卷', chapters: [chapter('next/01')] };
    course.volumes.push(next);
    const db = database();
    db.exec("CREATE TRIGGER reject_learning_chapter BEFORE INSERT ON chapter BEGIN SELECT RAISE(FAIL, '模拟磁盘拒绝'); END;");
    db.close();
    expect(seed).toThrow('模拟磁盘拒绝');
    expect(readWork()).toEqual(before);
    const recovered = database();
    recovered.exec('DROP TRIGGER reject_learning_chapter');
    recovered.close();
    seed(); seed();
    expect(readWork()).toMatchObject({ revision: 2 });
    expect(readWork().volumes).toHaveLength(2);
    expect(readWork().chapters).toHaveLength(2);
  });

  it('已有目标目录缺失数据库时保留目录内用户文件', () => {
    const target = join(directory, 'Projects', course.id);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '手稿.txt'), '不允许覆盖');
    expect(seed).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    expect(readdirSync(target)).toEqual(['手稿.txt']);
  });

  it.each(['ancestor', 'target'])('拒绝 %s 目录链接，不向被链接的目录写入课程', (kind) => {
    const projects = join(directory, 'Projects');
    const external = join(directory, '原目录');
    mkdirSync(external);
    if (kind === 'ancestor') symlinkSync(external, projects, 'junction');
    else {
      mkdirSync(projects);
      symlinkSync(external, join(projects, course.id), 'junction');
    }
    expect(seed).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    expect(readdirSync(external)).toEqual([]);
  });

  it.each(['wrong-id', 'multiple-meta', 'wrong-marker', 'multiple-marker', 'missing-tracked-chapter'])('已有课程身份异常 %s 时保留原数据', (kind) => {
    seed();
    const db = database();
    if (kind === 'wrong-id') db.prepare('UPDATE work_meta SET id = ?').run(randomUUID());
    if (kind === 'multiple-meta') db.prepare('INSERT INTO work_meta (id, title, revision, updated_at) VALUES (?, ?, 1, ?)')
      .run(randomUUID(), '错误的第二部作品', new Date().toISOString());
    if (kind === 'wrong-marker') db.prepare('UPDATE learning_course SET course_key = ?').run('其他课程');
    if (kind === 'multiple-marker') db.prepare('INSERT INTO learning_course VALUES (?)').run('其他课程');
    if (kind === 'missing-tracked-chapter') db.prepare('DELETE FROM chapter').run();
    const before = db.prepare('SELECT * FROM work_meta').all();
    db.close();
    expect(seed).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    const unchanged = database();
    try { expect(unchanged.prepare('SELECT * FROM work_meta').all()).toEqual(before); }
    finally { unchanged.close(); }
  });

  it('不因源章节改 key 而认领旧 ID；新增卷撞到现有章节时整笔拒绝', () => {
    seed();
    const before = readWork();
    const first = course.volumes[0].chapters[0];
    first.key = 'foundation/改key';
    expect(seed).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    first.key = 'foundation/01';
    const db = database();
    const collision = randomUUID();
    db.prepare('INSERT INTO chapter (id, title, document_json, word_count, sort_order) VALUES (?, ?, ?, 0, 0)')
      .run(collision, '作者章节', JSON.stringify(emptyDocument()));
    db.close();
    const withUserChapter = readWork();
    course.volumes.push({ key: 'next', id: collision, title: '新卷', chapters: [chapter('next/01')] });
    expect(seed).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    expect(readWork()).toEqual(withUserChapter);
    expect(readWork().revision).toBe(before.revision);
  });

  it.each(['project.sqlite-wal', 'project.sqlite-shm', 'project.sqlite-journal'])('拒绝 SQLite 附属路径 %s 的链接，保护外部目录', (name) => {
    seed();
    const external = join(directory, '不可改动');
    mkdirSync(external);
    writeFileSync(join(external, '内容.txt'), '原始内容');
    symlinkSync(external, join(directory, 'Projects', course.id, name), 'junction');
    expect(seed).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    expect(readFileSync(join(external, '内容.txt'), 'utf8')).toBe('原始内容');
  });
});
