import { readdir, lstat } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import process, { argv, stderr } from 'node:process';
import { fileURLToPath } from 'node:url';
import { assertSafeLocalPath, bundledManifest, validateModelWeightsDirectory, validateProvenanceDirectory } from './prepare-bundled-retrieval-model.mjs';

/** 只核验模型资源子树；构建成员、实际ASAR及解包旁树由desktop-package-audit独立核验。 */
export async function checkBundledModelPackage(resourcesDirectory, manifest = bundledManifest, trustedAnchor) {
  const root = join(resolve(resourcesDirectory), 'retrieval-model'); assertSafeLocalPath(root);
  if (!(await lstat(root)).isDirectory()) throw new Error('模型资源目录缺失。');
  const entries = await readdir(root);
  if (entries.length !== 1 || entries[0] !== manifest.revision) throw new Error('模型准备失败、残留旧版本或未知资源，禁止打包。');
  const model = join(root, manifest.revision); assertSafeLocalPath(model);
  const members = await readdir(model);
  if (members.length !== 2 || !members.includes('weights') || !members.includes('notices')) throw new Error('模型资源只能包含weights和notices。');
  await validateProvenanceDirectory(join(model, 'notices'), manifest, trustedAnchor);
  await validateModelWeightsDirectory(join(model, 'weights'), manifest);
}
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (argv.length !== 3 || !isAbsolute(argv[2])) throw new Error('用法：node scripts/check-bundled-model-package.mjs <绝对resources目录>');
    await checkBundledModelPackage(argv[2]);
  } catch (error) { stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
