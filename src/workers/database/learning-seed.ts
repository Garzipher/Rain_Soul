import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { WritingDocument } from '../../shared/contracts';
import { countDocumentWords } from '../../shared/document';
import { validateLearningCourse } from './learning-course-schema';
import { initializeSchema, RepositoryError } from './schema';
import { refreshChapterSearch } from './assets-search';

export interface LearningCourse {
  id: string;
  title: string;
  volumes: { key: string; id: string; title: string; chapters: {
    key: string; id: string; title: string; document: WritingDocument;
  }[] }[];
}

const courseKey = 'project-full-development-learning';
const invalidFile = () => new RepositoryError('INVALID_FILE', '学习作品身份或数据结构不符，未覆盖原作品。');

function assertSafePath(path: string) {
  // 检查全部已有祖先，拒绝 Windows junction 和指向外部作品的符号链接。
  let current = resolve(path);
  while (true) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw invalidFile();
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function assertIdentity(db: Database.Database, course: LearningCourse) {
  try {
    const metadata = db.prepare('SELECT id FROM work_meta LIMIT 2').all() as { id: string }[];
    const markers = db.prepare('SELECT course_key FROM learning_course LIMIT 2').all() as { course_key: string }[];
    if (metadata.length !== 1 || metadata[0].id !== course.id || markers.length !== 1 || markers[0].course_key !== courseKey) {
      throw invalidFile();
    }
    // 缺失跟踪对象意味着数据损坏；不能把原来的章误认为尚未初始化。
    for (const [tracking, column, table] of [['learning_volume', 'volume_id', 'volume'], ['learning_seed', 'chapter_id', 'chapter']]) {
      const missing = db.prepare(`SELECT 1 FROM ${tracking} t LEFT JOIN ${table} e ON t.${column} = e.id WHERE e.id IS NULL LIMIT 1`).get();
      if (missing) throw invalidFile();
    }
  } catch { throw invalidFile(); }
}

function hasTracked(db: Database.Database, kind: 'volume' | 'chapter', key: string, id: string): boolean {
  const tracking = kind === 'volume' ? 'learning_volume' : 'learning_seed';
  const column = kind === 'volume' ? 'volume_id' : 'chapter_id';
  const tracked = db.prepare(`SELECT ${column} AS id FROM ${tracking} WHERE key = ?`).get(key) as { id: string } | undefined;
  if (tracked) {
    if (tracked.id !== id) throw invalidFile();
    return true;
  }
  // 不认领作者自己新增的同 ID 对象，也不让卷章跨类型复用 ID。
  if (db.prepare('SELECT id FROM chapter WHERE id = ? UNION ALL SELECT id FROM volume WHERE id = ?').get(id, id)) throw invalidFile();
  return false;
}

function appendCourse(db: Database.Database, course: LearningCourse): boolean {
  let changed = false;
  // 先检查整份映射，即使某卷已删除也不允许源 key 悄悄换 ID。
  for (const volume of course.volumes) {
    hasTracked(db, 'volume', volume.key, volume.id);
    for (const chapter of volume.chapters) hasTracked(db, 'chapter', chapter.key, chapter.id);
  }
  for (const volume of course.volumes) {
    if (!hasTracked(db, 'volume', volume.key, volume.id)) {
      db.prepare('INSERT INTO volume (id, title, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM volume))')
        .run(volume.id, volume.title);
      db.prepare('INSERT INTO learning_volume VALUES (?, ?)').run(volume.key, volume.id);
      changed = true;
    }
    const state = db.prepare('SELECT deleted_at FROM volume WHERE id = ?').get(volume.id) as { deleted_at: string | null };
    if (state.deleted_at) continue;
    for (const chapter of volume.chapters) {
      if (hasTracked(db, 'chapter', chapter.key, chapter.id)) continue;
      db.prepare(`INSERT INTO chapter (id, title, document_json, word_count, sort_order, volume_id)
        VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM chapter WHERE volume_id = ?), ?)`)
        .run(chapter.id, chapter.title, JSON.stringify(chapter.document), countDocumentWords(chapter.document), volume.id, volume.id);
      db.prepare('INSERT INTO learning_seed VALUES (?, ?)').run(chapter.key, chapter.id);
      refreshChapterSearch(db, chapter.id);
      changed = true;
    }
  }
  return changed;
}

function updateCourse(directory: string, course: LearningCourse) {
  const file = join(directory, 'project.sqlite');
  assertSafePath(file);
  if (!existsSync(file) || !lstatSync(file).isFile()) throw invalidFile();
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = lstatSync(`${file}${suffix}`, { throwIfNoEntry: false });
    if (sidecar && (sidecar.isSymbolicLink() || !sidecar.isFile())) throw invalidFile();
  }
  const db = new Database(file, { fileMustExist: true });
  try {
    const version = db.pragma('user_version', { simple: true });
    if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5) throw new RepositoryError('UNSUPPORTED_SCHEMA', '学习作品数据库版本不受此客户端支持。');
    assertIdentity(db, course);
    initializeSchema(db, 'project');
    db.transaction(() => {
      const metadata = db.prepare('SELECT deleted_at FROM work_meta').get() as { deleted_at: string | null };
      if (metadata.deleted_at) return;
      if (appendCourse(db, course)) {
        db.prepare('UPDATE work_meta SET revision = revision + 1, updated_at = ?').run(new Date().toISOString());
      }
    }).immediate();
  } finally { db.close(); }
}

export function ensureLearningWork(projectsDirectory: string, input: LearningCourse): void {
  const course = validateLearningCourse(input);
  const directory = join(projectsDirectory, course.id);
  assertSafePath(directory);
  if (existsSync(directory)) return updateCourse(directory, course);
  mkdirSync(projectsDirectory, { recursive: true });
  const staging = join(projectsDirectory, `.learning-${randomUUID()}`);
  mkdirSync(staging);
  let db: Database.Database | undefined;
  try {
    db = new Database(join(staging, 'project.sqlite'));
    initializeSchema(db, 'project');
    const opened = db;
    opened.transaction(() => {
      opened.exec(`CREATE TABLE learning_course (course_key TEXT PRIMARY KEY);
        CREATE TABLE learning_volume (key TEXT PRIMARY KEY, volume_id TEXT NOT NULL UNIQUE);
        CREATE TABLE learning_seed (key TEXT PRIMARY KEY, chapter_id TEXT NOT NULL UNIQUE);`);
      opened.prepare('INSERT INTO learning_course VALUES (?)').run(courseKey);
      opened.prepare('INSERT INTO work_meta (id, title, revision, updated_at) VALUES (?, ?, 1, ?)')
        .run(course.id, course.title, new Date().toISOString());
      appendCourse(opened, course);
    }).immediate();
    opened.close();
    db = undefined;
    renameSync(staging, directory);
  } catch (error) {
    db?.close();
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
