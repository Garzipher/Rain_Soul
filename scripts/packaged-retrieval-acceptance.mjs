import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { extractFile, uncache } from '@electron/asar';

const digest = body => createHash('sha256').update(body).digest('hex');
export const qualificationFixtureHash = '787abac3aaaed9ddd30ca2e49b24da979d504ceecda88dd0e750c8a7789f2c61';
export function assertQualificationFixture(fixture) {
  assert.equal(digest(JSON.stringify(fixture)), qualificationFixtureHash, '验收必须使用既定原创标注夹具；实验夹具不可冒充资格');
  assert.equal(fixture.knowledge.length, 100); assert.equal(fixture.acceptance.length, 30);
  assert.equal(fixture.calibration.length, 20);
}
async function localFile(path) {
  const absolute = resolve(path), root = parse(absolute).root;
  let segment = root;
  for (const part of absolute.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    segment = join(segment, part);
    if ((await lstat(segment)).isSymbolicLink()) throw new Error('验收路径不能包含链接。');
  }
  const info = await lstat(absolute);
  if (!info.isFile()) throw new Error('验收成员不是普通文件。');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(absolute)) hash.update(bytes);
  return { bytes: info.size, sha256: hash.digest('hex') };
}

/** 在启动EXE之前固定模型、包内推理运行库与解包WASM的内容身份。 */
export async function inspectPackagedRetrieval(executable, manifest) {
  if (!isAbsolute(executable)) throw new Error('必须提供真实目录包的绝对EXE路径。');
  if (basename(executable) !== 'RainSoul.exe') throw new Error('验收入口必须是RainSoul.exe。');
  if (!/^[a-f0-9]{40}$/.test(manifest.revision)) throw new Error('模型修订无效。');
  const resources = join(dirname(executable), 'resources'), asarPath = join(resources, 'app.asar');
  const asar = await localFile(asarPath), modelDirectory = join(resources, 'retrieval-model', manifest.revision, 'weights');
  const weights = [];
  for (const expected of manifest.files) {
    if (!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(expected.path) || expected.path.split('/').some(part => part === '.' || part === '..')) throw new Error('权重路径无效。');
    const actual = await localFile(join(modelDirectory, expected.path));
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw new Error(`包内权重校验失败：${expected.path}`);
    weights.push({ path: expected.path, ...actual });
  }
  const runtimeFiles = [];
  uncache(asarPath);
  for (const name of ['retrieval-runtime.cjs', 'retrieval-worker.cjs', 'retrieval-ort-wasm.cjs']) {
    const path = `dist/desktop/${name}`, bytes = extractFile(asarPath, join('dist', 'desktop', name));
    runtimeFiles.push({ path, bytes: bytes.length, sha256: digest(bytes) });
  }
  for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    const path = `dist/desktop/retrieval-wasm/${name}`;
    runtimeFiles.push({ path, ...await localFile(join(`${asarPath}.unpacked`, path)) });
  }
  return { executable: { path: executable, ...await localFile(executable) }, asar: { path: asarPath, ...asar }, manifestSha256: digest(JSON.stringify(manifest)), modelDirectory,
    runtimePath: join(asarPath, 'dist/desktop/retrieval-runtime.cjs'), runtimeFiles, weights };
}

function keywordTop5(knowledge, text) {
  const terms = new Set();
  for (const match of text.toLowerCase().matchAll(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu)) {
    if (/\p{Script=Han}/u.test(match[0])) for (let index = 0; index < match[0].length - 1; index++) terms.add(match[0].slice(index, index + 2));
    else terms.add(match[0]);
  }
  return knowledge.map(entry => ({ id: entry.id, score: [...terms].filter(term => entry.body.toLowerCase().includes(term)).length }))
    .filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 5).map(entry => entry.id);
}

/** 使用既定阈值；验收查询不参与阈值调参，记录遗漏和负例而不掩盖失败。 */
export function evaluateRetrievalQuality(fixture, documents, queries, threshold) {
  assert.ok(Number.isFinite(threshold) && threshold >= -1 && threshold <= 1, '阈值无效');
  assert.equal(documents.length, fixture.knowledge.length); assert.equal(queries.length, fixture.acceptance.length);
  assert.ok(documents.length > 0 && queries.length > 0);
  const width = documents[0].length;
  for (const vector of [...documents, ...queries]) assert.ok(vector.length === width && vector.every(Number.isFinite), '向量数据无效');
  const results = fixture.acceptance.map((query, index) => {
    const semantic = fixture.knowledge.map((entry, offset) => ({ id: entry.id,
      score: queries[index].reduce((sum, value, dimension) => sum + value * documents[offset][dimension], 0) }))
      .filter(hit => hit.score >= threshold).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 5);
    const keywords = keywordTop5(fixture.knowledge, query.text);
    const recall = ids => query.relevantIds.length ? query.relevantIds.filter(id => ids.includes(id)).length / query.relevantIds.length : null;
    return { ...query, semantic, keywords, semanticRecall: recall(semantic.map(hit => hit.id)), keywordRecall: recall(keywords),
      falsePositive: query.relevantIds.length === 0 && semantic.length > 0 };
  });
  const paraphrases = results.filter(query => query.group === '语义'); assert.ok(paraphrases.length > 0);
  const average = field => paraphrases.reduce((sum, query) => sum + query[field], 0) / paraphrases.length;
  const semanticParaphraseRecall = average('semanticRecall'), keywordParaphraseRecall = average('keywordRecall');
  const noRelevantFalsePositiveQueries = results.filter(query => query.falsePositive).length;
  return { threshold, semanticParaphraseRecall, keywordParaphraseRecall, noRelevantFalsePositiveQueries, results,
    meetsNumericTargets: semanticParaphraseRecall >= .8 && semanticParaphraseRecall >= keywordParaphraseRecall && noRelevantFalsePositiveQueries <= 1 };
}

export function assertPackagedAcceptance(identity, result) {
  assert.deepEqual(result.identity, identity, '验收期间包内容变化');
  assert.equal(result.dimensions, 512); assert.equal(result.networkAttempts, 0, '推理触发联网');
  assert.ok(Number.isFinite(result.coldLoadMs) && result.coldLoadMs <= 30000, '冷加载超过30秒');
  assert.equal(result.quality.meetsNumericTargets, true, '真实中文质量未达门槛');
}
