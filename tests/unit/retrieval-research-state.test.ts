import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readResearchModelState, assertResearchModelUnchanged } from '../../scripts/retrieval-research-state.mjs';
import { fixedManifest, isRetrievalModelQualified } from '../../src/shared/retrieval-model';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rainsoul-research-state-')); roots.push(root);
  const manifest = structuredClone(fixedManifest);
  Object.assign(manifest.qualification, { publicSourceRecorded: true, officialSourceVerified: false, conversionRevisionVerified: false, networkAuditPassed: true, packagedRuntimePassed: true, qualityCalibrated: true });
  const path = join(root, 'manifest.json'); writeFileSync(path, JSON.stringify(manifest)); return path;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('允许已资格产品研究，真实字节前后不变才报告配置保持', async () => {
  const path = fixture(), before = await readResearchModelState(path);
  expect(isRetrievalModelQualified(before.manifest)).toBe(true);
  expect(before.manifest.qualification.officialSourceVerified).toBe(false);
  expect(await assertResearchModelUnchanged(path, before.sha256)).toBe(before.sha256);
});
it('研究期间资格、校准或格式字节变化均拒绝未修改声明', async () => {
  const path = fixture(), before = await readResearchModelState(path);
  for (const change of ['qualification', 'threshold', 'format']) {
    const manifest = structuredClone(before.manifest);
    if (change === 'qualification') manifest.qualification.networkAuditPassed = false;
    if (change === 'threshold') manifest.similarityThreshold = 0.8;
    writeFileSync(path, JSON.stringify(manifest, null, change === 'format' ? 2 : undefined));
    await expect(assertResearchModelUnchanged(path, before.sha256)).rejects.toThrow('研究期间模型清单发生变化');
  }
});
