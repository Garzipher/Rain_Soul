import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** 保留原始字节摘要，研究资格与校准均不得悄悄修改产品清单。 */
export async function readResearchModelState(path) {
  const bytes = await readFile(path);
  return { manifest: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex') };
}
export async function assertResearchModelUnchanged(path, expectedSha256) {
  const after = await readResearchModelState(path);
  assert.equal(after.sha256, expectedSha256, '研究期间模型清单发生变化');
  return after.sha256;
}
