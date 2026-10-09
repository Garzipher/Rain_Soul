import { randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

interface CleanupRequest { localAppData: string | undefined; confirmed: boolean }
interface CleanupIo { rename?: (source: string, target: string) => void; unlink?: (path: string) => void; rmdir?: (path: string) => void }
const normalized = (path: string) => process.platform === 'win32' ? resolve(path).toLocaleLowerCase() : resolve(path);

function ordinaryPath(path: string) {
  let current = path;
  while (true) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error('数据目录包含链接或 junction，拒绝清理，请先检查目录。');
    if (stat && normalized(realpathSync.native(current)) !== normalized(current)) throw new Error('数据目录存在链接、重解析或路径偏离，拒绝清理。');
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}

function assertContained(root: string, path: string) {
  const child = relative(root, path);
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error('清理路径超出授权数据目录。');
  ordinaryPath(path);
  const stat = lstatSync(path);
  if (!stat.isDirectory() && !stat.isFile()) throw new Error('数据目录存在非普通文件，拒绝清理。');
  return stat;
}

function inspectTree(root: string) {
  const queue = [root];
  while (queue.length) {
    const path = queue.pop()!;
    if (assertContained(root, path).isDirectory()) {
      for (const name of readdirSync(path)) queue.push(join(path, name));
    }
  }
}

/** 仅清理固定本机目录。先完整拒绝链接，再隔离目录；删除失败保留剩余隔离数据，不伪装成事务回滚。 */
export function cleanupLocalData(request: CleanupRequest, io: CleanupIo = {}): { removed: boolean } {
  if (request.confirmed !== true) throw new Error('删除本机数据需要作者明确确认。');
  if (!request.localAppData || !isAbsolute(request.localAppData)) throw new Error('本机应用目录无效，未删除任何数据。');
  const base = resolve(request.localAppData);
  if (dirname(base) === base) throw new Error('本机应用目录不能是磁盘根目录，未删除任何数据。');
  const root = join(base, 'RainSoul'); ordinaryPath(root);
  const stat = lstatSync(root, { throwIfNoEntry: false });
  if (!stat) return { removed: false };
  if (!stat.isDirectory()) throw new Error('RainSoul 数据位置不是普通目录，未删除任何数据。');
  inspectTree(root);
  const isolated = join(base, `.RainSoul-uninstall-${randomUUID()}`);
  try {
    ordinaryPath(root); ordinaryPath(isolated);
    const fresh = lstatSync(root);
    if (fresh.dev !== stat.dev || fresh.ino !== stat.ino) throw new Error('数据目录已变化');
    (io.rename ?? renameSync)(root, isolated);
  } catch { throw new Error('数据目录被占用或发生变化，原目录未删除；请退出程序后再试。'); }
  try {
    // 原子改名后再次全树检查，逐项删除前再次检查祖先，不使用递归 RMDir 跟随目录链接。
    inspectTree(isolated);
    const queue: { path: string; visited: boolean }[] = [{ path: isolated, visited: false }];
    while (queue.length) {
      const item = queue.pop()!, current = assertContained(isolated, item.path);
      if (!current.isDirectory()) (io.unlink ?? unlinkSync)(item.path);
      else if (item.visited) (io.rmdir ?? rmdirSync)(item.path);
      else {
        queue.push({ path: item.path, visited: true });
        for (const name of readdirSync(item.path)) queue.push({ path: join(item.path, name), visited: false });
      }
    }
  } catch {
    throw new Error(`本机数据清理未完成，安装程序已保留。剩余数据位于隔离目录：${isolated}。删除可能已部分完成，不代表完整备份；请手动核对，不要将残缺目录当作完整作品库。`);
  }
  return { removed: true };
}
