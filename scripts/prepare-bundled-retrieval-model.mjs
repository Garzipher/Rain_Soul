import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync } from 'node:fs';
import { copyFile, lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process, { argv, stderr } from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { z } from 'zod';

export const bundledManifest = JSON.parse(readFileSync(new URL('../assets/retrieval-model-manifest.json', import.meta.url), 'utf8'));
// 固定公开仓库、修订、模型卡及许可；精确转换链只作补充，不允许外部变量跳过文件校验。
const repositoryAnchor = JSON.parse(readFileSync(new URL('../assets/retrieval-model-provenance.json', import.meta.url), 'utf8'));
const revision = z.string().regex(/^[a-f0-9]{40}$/), sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const localName = z.string().regex(/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/).refine(value => !value.split('/').some(part => part === '.' || part === '..'));
const fileSchema = z.object({ path: localName, bytes: z.number().int().positive().max(512 * 1024 ** 2), sha256 }).strict();
const artifactSchema = fileSchema.extend({ kind: z.enum(['upstream-card', 'candidate-card', 'license', 'conversion']), url: z.url() });
const provenanceSchema = z.object({ schemaVersion: z.literal(1), repository: z.string(), revision, upstreamRepository: z.string(), upstreamRevision: revision, manifestSha256: sha256, artifacts: z.array(artifactSchema).min(3).max(4) }).strict();
const digest = data => createHash('sha256').update(data).digest('hex');
const modelFiles = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'];

/** 来源锚绑定模型、运行配置与许可字节；后续验收和校准不改变固定来源身份。 */
export function modelArtifactDigest(manifest = bundledManifest) {
  const identity = { ...manifest };
  delete identity.qualification; delete identity.similarityThreshold;
  return digest(JSON.stringify(identity));
}

export function assertSafeLocalPath(path) {
  let current = resolve(path);
  while (true) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('模型路径不允许链接。');
    if (basename(current).toLowerCase() === 'projects') throw new Error('模型路径不能包含作品目录。');
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}
function parsedFiles(files) {
  const parsed = z.array(fileSchema).min(1).max(20).parse(files);
  if (new Set(parsed.map(file => file.path.toLowerCase())).size !== parsed.length || parsed.reduce((sum, file) => sum + file.bytes, 0) > 512 * 1024 ** 2) throw new Error('模型文件重复或超过容量。');
  return parsed;
}
function validateBundledManifest(manifest) {
  revision.parse(manifest.revision); const files = parsedFiles(manifest.files);
  if (files.length !== 5 || !modelFiles.every(path => files.some(file => file.path === path))) throw new Error('捆绑模型必须包含固定五文件。');
  if (manifest.license !== 'MIT' || typeof manifest.licenseText !== 'string' || manifest.licenseText.length < 500) throw new Error('模型许可正文缺失。');
}
export function validateModelProvenance(evidence, manifest = bundledManifest, trustedAnchor = repositoryAnchor) {
  if (!trustedAnchor) throw new Error('来源缺少仓库可信锚，禁止捆绑。');
  validateBundledManifest(manifest);
  const trusted = provenanceSchema.parse(trustedAnchor), actual = provenanceSchema.parse(evidence);
  if (JSON.stringify(actual) !== JSON.stringify(trusted)) throw new Error('来源证据与仓库可信锚不一致。');
  if (trusted.repository !== manifest.repository || trusted.revision !== manifest.revision || trusted.upstreamRepository !== manifest.upstreamRepository || trusted.upstreamRevision !== manifest.upstreamReferenceRevision || trusted.manifestSha256 !== modelArtifactDigest(manifest)) throw new Error('来源版本或模型字节身份不一致。');
  const kinds = new Set(trusted.artifacts.map(item => item.kind));
  if (kinds.size !== trusted.artifacts.length || !['upstream-card', 'candidate-card', 'license'].every(kind => kinds.has(kind)) || new Set(trusted.artifacts.map(item => item.path.toLowerCase())).size !== trusted.artifacts.length || trusted.artifacts.some(item => item.path === 'provenance.json')) throw new Error('来源材料重复或缺少模型卡与许可。');
  for (const item of trusted.artifacts) {
    const upstream = item.kind === 'upstream-card', url = new URL(item.url);
    const prefix = `https://huggingface.co/${upstream ? trusted.upstreamRepository : trusted.repository}/raw/${upstream ? trusted.upstreamRevision : trusted.revision}/`;
    if (url.username || url.password || url.search || url.hash || (item.kind === 'license' ? item.url !== manifest.licenseUrl : !item.url.startsWith(prefix))) throw new Error('来源材料不是固定官方版本网址。');
    if (item.kind === 'license' && (item.bytes !== Buffer.byteLength(manifest.licenseText) || item.sha256 !== digest(manifest.licenseText))) throw new Error('模型许可必须保留完整原文。');
  }
  return actual;
}
export async function validateExactDirectory(directory, files) {
  const expected = parsedFiles(files), root = resolve(directory); assertSafeLocalPath(root);
  if (!(await lstat(root)).isDirectory()) throw new Error('模型必须使用本地目录。');
  const allowed = new Set(expected.map(file => file.path));
  async function walk(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const path = join(current, item.name); assertSafeLocalPath(path);
      const name = relative(root, path).split('\\').join('/');
      if (item.isDirectory() && [...allowed].some(file => file.startsWith(name + '/'))) await walk(path);
      else if (!item.isFile() || !allowed.has(name)) throw new Error('模型包含未知文件或目录。');
    }
  }
  await walk(root);
  for (const file of expected) {
    const path = join(root, file.path); assertSafeLocalPath(path);
    if (!(await lstat(path)).isFile()) throw new Error('模型文件类型错误。');
    const handle = await open(path, 'r');
    try {
      const before = await handle.stat(); if (before.size !== file.bytes) throw new Error('模型文件长度校验失败。');
      const data = await readBounded(handle, file.bytes), after = await handle.stat();
      if (data.length !== file.bytes || after.size !== before.size || after.mtimeMs !== before.mtimeMs || digest(data) !== file.sha256) throw new Error('模型文件SHA或长度校验失败。');
    } finally { await handle.close(); }
  }
}
/** 固定容量读取，输入并发增长也不扩大分配；额外一字节用于检查溢出。 */
async function readBounded(handle, limit) {
  const data = Buffer.alloc(limit + 1); let offset = 0;
  while (offset < data.length) {
    const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
    if (!bytesRead) break; offset += bytesRead;
  }
  if (offset > limit) throw new Error('模型材料超过读取容量上限。');
  return data.subarray(0, offset);
}
export async function validateModelWeightsDirectory(directory, manifest = bundledManifest) { await validateExactDirectory(directory, manifest.files); }
export async function validateProvenanceDirectory(directory, manifest = bundledManifest, trustedAnchor = repositoryAnchor) {
  assertSafeLocalPath(join(directory, 'provenance.json'));
  const stat = await lstat(join(directory, 'provenance.json'));
  if (!stat.isFile() || stat.size > 65536) throw new Error('来源协议文件无效。');
  const handle = await open(join(directory, 'provenance.json'), 'r'); let data;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 65536) throw new Error('来源协议文件无效。');
    data = await readBounded(handle, 65536); const after = await handle.stat();
    if (data.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('来源协议读取期间发生变化。');
  } finally { await handle.close(); }
  const evidence = validateModelProvenance(JSON.parse(data.toString('utf8')), manifest, trustedAnchor);
  await validateExactDirectory(directory, [...evidence.artifacts.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })), { path: 'provenance.json', bytes: data.length, sha256: digest(data) }]);
  return evidence;
}
function overlaps(left, right) {
  const child = relative(left, right); return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}
async function copyFiles(source, target, files) {
  await mkdir(target, { recursive: true });
  for (const file of files) { const destination = join(target, file.path); assertSafeLocalPath(join(source, file.path)); await mkdir(dirname(destination), { recursive: true }); await copyFile(join(source, file.path), destination); }
}
export async function prepareBundledRetrievalModel({ inputDirectory, evidenceDirectory, outputDirectory, manifest = bundledManifest, trustedAnchor = repositoryAnchor }) {
  const input = resolve(inputDirectory), evidence = resolve(evidenceDirectory), output = resolve(outputDirectory);
  for (const path of [input, evidence, output]) assertSafeLocalPath(path);
  if (basename(output) !== manifest.revision || [input, evidence].some(path => overlaps(path, output) || overlaps(output, path)) || overlaps(input, evidence) || overlaps(evidence, input)) throw new Error('输出必须为版本目录且不能与输入重叠。');
  await mkdir(dirname(output), { recursive: true });
  const lockPath = output + '.lock', pending = output + '.pending', stage = output + '.stage-' + randomUUID(), backup = output + '.backup-' + randomUUID();
  for (const path of [lockPath, pending, stage, backup]) assertSafeLocalPath(path);
  const lock = await open(lockPath, 'wx'); let movedOld = false, published = false;
  try {
    await writeFile(pending, '模型准备尚未成功，禁止打包。\n');
    const provenance = await validateProvenanceDirectory(evidence, manifest, trustedAnchor);
    await validateModelWeightsDirectory(input, manifest);
    await copyFiles(input, join(stage, 'weights'), manifest.files);
    await copyFiles(evidence, join(stage, 'notices'), [...provenance.artifacts, { path: 'provenance.json' }]);
    await validateModelWeightsDirectory(join(stage, 'weights'), manifest);
    await validateProvenanceDirectory(join(stage, 'notices'), manifest, trustedAnchor);
    assertSafeLocalPath(output);
    if (lstatSync(output, { throwIfNoEntry: false })) { await rename(output, backup); movedOld = true; }
    await rename(stage, output); published = true;
    if (movedOld) await rm(backup, { recursive: true });
    await rm(pending);
  } catch (error) {
    if (movedOld && !published) await rename(backup, output);
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true }); await lock.close(); await rm(lockPath);
  }
}
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (argv.length !== 5 || argv.slice(2).some(path => !isAbsolute(path))) throw new Error('用法：node scripts/prepare-bundled-retrieval-model.mjs <绝对输入目录> <绝对证据目录> <绝对输出版本目录>');
    await prepareBundledRetrievalModel({ inputDirectory: argv[2], evidenceDirectory: argv[3], outputDirectory: argv[4] });
  } catch (error) { stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
