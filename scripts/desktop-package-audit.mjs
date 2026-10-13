import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { extractFile, listPackage, statFile, uncache } from '@electron/asar';
import { assertSafeLocalPath } from './prepare-bundled-retrieval-model.mjs';

const desktop = new Set(['main.cjs', 'preload.cjs', 'database-worker.cjs', 'web-article-worker.cjs', 'retrieval-runtime.cjs', 'retrieval-worker.cjs', 'retrieval-ort-wasm.cjs', 'rainsoul.png', 'learning-course.json', 'THIRD_PARTY_NOTICES.txt', 'retrieval-wasm/ort-wasm-simd-threaded.mjs', 'retrieval-wasm/ort-wasm-simd-threaded.wasm']);
const asset = /^renderer\/assets\/(?:index|react|editor|textbook|textbook-content|snapshot-panel|consistency-panel|ai-workspace|rolldown-runtime)-[A-Za-z0-9_-]{8}\.(?:js|css)$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const recordsDigest = records => digest(JSON.stringify(records));
function safeMember(path) {
  if (path.split('/').some(part => !part || part === '.' || part === '..' || /[\\:]/.test(part) || [...part].some(char => char.charCodeAt(0) < 32) || /[. ]$/.test(part))) throw new Error('打包成员路径不规范。');
}
function buildMember(path, directory) {
  if (directory) return ['desktop', 'desktop/retrieval-wasm', 'renderer', 'renderer/assets', 'renderer/learning'].includes(path);
  return (path.startsWith('desktop/') && desktop.has(path.slice(8))) || path === 'renderer/index.html' || asset.test(path) || /^renderer\/learning\/[a-f0-9]{64}\.png$/.test(path);
}
async function sha256(path) { assertSafeLocalPath(path); const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
async function walk(root, visit, prefix = '') {
  assertSafeLocalPath(root);
  for (const item of await readdir(root, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${item.name}` : item.name, absolute = join(root, item.name); safeMember(path);
    if (item.isSymbolicLink()) throw new Error('打包资源不允许链接。');
    if (!item.isDirectory() && !item.isFile()) throw new Error('打包资源必须是普通文件或目录。');
    if (await visit(path, absolute, item.isDirectory()) === false) continue;
    if (item.isDirectory()) await walk(absolute, visit, path);
  }
}
/** 仅枚举构建树；模型输入由来源策略独立处理，研究包不会读取其内容。 */
export async function checkDesktopBuild(directory) {
  const files = [];
  await walk(directory, async (path, absolute, isDirectory) => {
    if (path === 'retrieval-model' && isDirectory) return false;
    if (!buildMember(path, isDirectory)) throw new Error(`存在未授权构建成员或目录：${path}`);
    if (!isDirectory) files.push({ path, bytes: (await lstat(absolute)).size, sha256: await sha256(absolute) });
  });
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { files, membersSha256: recordsDigest(files) };
}
function packageMember(path, directory) {
  if (path === 'dist' && directory) return true;
  if (path.startsWith('dist/')) return buildMember(path.slice(5), directory);
  if (path === 'package.json' && !directory) return true;
  if (path === 'node_modules' && directory) return true;
  // 依赖有合法许可证、类型声明等；拒绝数据库、日志、凭据及作者文档。
  return path.startsWith('node_modules/') && !/\.(?:(?:sqlite(?:3)?|db)(?:-(?:wal|shm|journal))?|log(?:\.\d+)?|docx|doc|odt)$/i.test(path) && !/(?:^|\/)(?:Projects|ExtractionDrafts|Avatars|RetrievalCache|RetrievalModels|(?:ai-settings|author-profile)\.json|\.(?:ai-settings|author-profile)-[^/]+\.tmp|credentials(?:\.json)?|\.env(?:\..*)?)$/i.test(path);
}
/** 校验真实ASAR及解包旁树，不信任头内摘要来代替文件字节。 */
export async function auditDesktopPackage(resources, expected, options = {}) {
  const archive = join(resources, 'app.asar'), side = `${archive}.unpacked`;
  const resourceFiles = [];
  await walk(resources, async (path, absolute, directory) => {
    if (path === 'app.asar' && !directory) return;
    if (path === 'app.asar.unpacked' && directory) return false;
    if (path === 'retrieval-model' && directory && options.allowModel) return false;
    const notice = expected.files.find(file => file.path === 'desktop/THIRD_PARTY_NOTICES.txt');
    let expectedHash;
    if (path === 'THIRD_PARTY_NOTICES.txt' && !directory && notice) expectedHash = notice.sha256;
    else if (path === 'default_app.asar' && !directory && options.vendorDefaultAsar) expectedHash = await sha256(options.vendorDefaultAsar);
    else throw new Error(`存在未授权包资源：${path}`);
    const actual = await sha256(absolute); if (actual !== expectedHash) throw new Error('包资源内容与既定构建或官方默认归档不符。');
    resourceFiles.push({ path, sha256: actual });
  });
  assertSafeLocalPath(archive); const before = await sha256(archive); uncache(archive);
  const files = [], unpacked = new Set(), folded = new Set(), actualBuild = [];
  for (const member of listPackage(archive)) {
    const native = member.slice(1), path = native.replaceAll('\\', '/'); safeMember(path);
    if (folded.has(path.toLowerCase())) throw new Error('ASAR成员存在大小写歧义。'); folded.add(path.toLowerCase());
    const info = statFile(archive, native, false), directory = 'files' in info;
    if ('link' in info || !packageMember(path, directory)) throw new Error(`ASAR存在未授权成员：${path}`);
    if (directory) continue;
    let file;
    if (info.unpacked) {
      const physical = join(side, native); assertSafeLocalPath(physical);
      const beforeFile = await lstat(physical);
      if (!beforeFile.isFile() || beforeFile.size !== info.size) throw new Error('解包实际文件长度与ASAR声明不符。');
      const hash = await sha256(physical), afterFile = await lstat(physical);
      if (afterFile.size !== beforeFile.size || afterFile.mtimeMs !== beforeFile.mtimeMs) throw new Error('审计期间解包内容发生变化。');
      file = { path, bytes: beforeFile.size, sha256: hash, unpacked: true }; unpacked.add(path);
    } else {
      const bytes = extractFile(archive, native, false); file = { path, bytes: bytes.length, sha256: digest(bytes), unpacked: false };
    }
    if (info.integrity && (info.integrity.algorithm !== 'SHA256' || info.integrity.hash !== file.sha256)) throw new Error('实际ASAR或解包文件内容摘要不匹配。');
    files.push(file);
    if (path.startsWith('dist/')) actualBuild.push({ path: path.slice(5), bytes: file.bytes, sha256: file.sha256 });
  }
  actualBuild.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (recordsDigest(actualBuild) !== expected.membersSha256) throw new Error('实际包构建成员缺失或内容摘要发生变化。');
  const sideStat = await lstat(side).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const seen = new Set();
  if (sideStat) {
    if (!sideStat.isDirectory() || sideStat.isSymbolicLink()) throw new Error('解包旁树不能使用链接。');
    await walk(side, (path, absolute, directory) => {
      if (directory) { if (![...unpacked].some(file => file.startsWith(`${path}/`))) throw new Error('存在未授权解包目录。'); }
      else { if (!unpacked.has(path)) throw new Error('存在未授权解包成员。'); seen.add(path); }
    });
  }
  if (seen.size !== unpacked.size) throw new Error('解包成员缺失。');
  const after = await sha256(archive); if (before !== after) throw new Error('审计期间ASAR内容发生变化。');
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  resourceFiles.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { schemaVersion: 1, asarSha256: after, membersSha256: recordsDigest(files), memberCount: files.length, buildMembersSha256: expected.membersSha256, unpackedFiles: seen.size, files, resourceFiles };
}
