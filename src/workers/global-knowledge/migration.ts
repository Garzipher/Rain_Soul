import Database from 'better-sqlite3';
import { existsSync, mkdirSync, unlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { globalDefaults, globalSchema } from './schema';

/** 升级前通过SQLite备份API合并WAL；恢复只在旧连接完全关闭之后进行。 */
export async function openGlobalDatabase(directory: string): Promise<Database.Database> {
  mkdirSync(directory, { recursive: true });
  const filename = join(directory, 'knowledge.sqlite'), existed = existsSync(filename);
  let db = new Database(filename);
  db.pragma('busy_timeout=3000'); db.pragma('foreign_keys=ON');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 1) { db.close(); throw new Error('全局知识库来自较新版本，请升级应用后重试。'); }
  if (version === 1) { db.pragma('journal_mode=WAL'); return db; }
  const backup = `${filename}.before-v1-${randomUUID()}.bak`;
  if (existed) {
    try { await db.backup(backup); } catch { db.close(); throw new Error('全局知识库升级备份失败，原库未修改。'); }
  }
  try {
    db.transaction(() => {
      db.exec(globalSchema);
      db.prepare('INSERT INTO global_meta VALUES(1,?,1)').run(randomUUID());
      const add = db.prepare('INSERT INTO global_category VALUES(?,?)');
      globalDefaults.forEach(([name, systemKey], sortOrder) => { const id = randomUUID(); add.run(id, JSON.stringify({ id, name, parentId: null, sortOrder, systemKey, deletedAt: null })); });
      db.pragma('user_version=1');
    })();
    db.pragma('journal_mode=WAL'); return db;
  } catch {
    db.close();
    if (existed) {
      for (const suffix of ['-wal', '-shm']) { const sidecar = filename + suffix; if (existsSync(sidecar)) unlinkSync(sidecar); }
      copyFileSync(backup, filename);
    }
    throw new Error('全局知识库迁移失败，已保留升级备份；作品数据不受影响。');
  }
}
