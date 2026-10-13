const { test, expect } = require('@playwright/test');
const { createHash } = require('node:crypto');
const { createReadStream, existsSync, readFileSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { listPackage } = require('@electron/asar');
const { activate, temporaryDirectory, dataDirectory, launch, offlineWindow, closeNormally, cleanup, createWork, writeChapter } = require('./structure-helper.cjs');

test.setTimeout(120000);
test.skip(!process.env.RAINSOUL_TEST_EXECUTABLE, '本场景需要显式指定新的无模型研究包EXE，不使用开发入口代替实际包验收。');
async function sha256(file) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
async function navigate(page, name) {
  const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
  if (await expand.isVisible()) await activate(expand);
  await activate(page.getByRole('button', { name, exact: true }));
}

test('实际无模型研究包离线回退、只读资源边界及停用偏好重启保持', async () => {
  const executable = process.env.RAINSOUL_TEST_EXECUTABLE;
  expect(path.isAbsolute(executable)).toBe(true);
  const resources = path.join(path.dirname(executable), 'resources'), asar = path.join(resources, 'app.asar');
  expect(existsSync(path.join(resources, 'retrieval-model'))).toBe(false);
  const members = listPackage(asar).map(member => member.replaceAll('\\', '/'));
  expect(members.some(member => member.includes('/dist/retrieval-model/'))).toBe(false);
  const { checkDesktopBuild, auditDesktopPackage } = await import('../../scripts/desktop-package-audit.mjs');
  const packageAudit = await auditDesktopPackage(resources, await checkDesktopBuild(path.resolve('dist')), { vendorDefaultAsar: path.resolve('node_modules/electron/dist/resources/default_app.asar') });
  const savedAudit = JSON.parse(readFileSync(path.resolve(resources, '../../acceptance/desktop-package-audit.json'), 'utf8'));
  expect(savedAudit.mode).toBe('research-without-model'); expect(savedAudit.asarSha256).toBe(packageAudit.asarSha256);
  expect(savedAudit.membersSha256).toBe(packageAudit.membersSha256); expect(savedAudit.buildMembersSha256).toBe(packageAudit.buildMembersSha256);
  expect(savedAudit.files).toEqual(packageAudit.files); expect(savedAudit.resourceFiles).toEqual(packageAudit.resourceFiles);
  const manifest = JSON.parse(readFileSync(path.resolve('assets/retrieval-model-manifest.json'), 'utf8'));
  expect(Object.values(manifest.qualification)).toEqual([false, false, false, false, false]);
  const directory = await temporaryDirectory(); let application;
  const report = {
    schemaVersion: 1, kind: 'research-without-model', timestamp: new Date().toISOString(),
    executable, executableSha256: await sha256(executable), asarSha256: packageAudit.asarSha256,
    packageAudit: { memberCount: packageAudit.memberCount, membersSha256: packageAudit.membersSha256, buildMembersSha256: packageAudit.buildMembersSha256, unpackedFiles: packageAudit.unpackedFiles, resourceFiles: packageAudit.resourceFiles },
    expectedRevision: manifest.revision, qualificationFlags: manifest.qualification,
    evidence: { packaged: false, rendererOffline: false, actualPackageMembersVerified: true, modelAbsentFromResourcesAndAsar: true, keywordFallback: false, disabledPreferencePersisted: false, writingPersisted: false },
    pending: ['固定官方来源与转换证明', '系统网络观测零出站', '真实模型冷加载与内存', '千条索引与200查询P95', '独立人工质量复核', '干净Windows安装升级卸载'],
  };
  try {
    application = await launch(directory); let page = await offlineWindow(application);
    const identity = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), executable: process.execPath, resourcesPath: process.resourcesPath, versions: process.versions }));
    expect(identity.packaged).toBe(true); expect(path.resolve(identity.executable).toLowerCase()).toBe(path.resolve(executable).toLowerCase());
    report.identity = identity; report.evidence.packaged = true; report.evidence.rendererOffline = true;
    await createWork(page, '无模型研究验收作品');
    await writeChapter(page, '离线写作保持', '未捆绑模型时，雨声中的写作仍可保存。');
    await navigate(page, '设置');
    const panel = page.getByLabel('本机知识检索模型', { exact: true });
    await expect(panel).toContainText('本构建未捆绑模型'); await expect(panel).toContainText('内置来源');
    await expect(panel).toContainText('偏好开启'); await expect(panel).toContainText('当前使用关键词');
    await expect(panel.getByRole('button', { name: '改用内置模型', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: '重建当前作品索引', exact: true })).toBeDisabled();
    report.before = await page.evaluate(() => window.rainSoul.getRetrievalModelStatus());
    expect(report.before).toMatchObject({ source: 'bundled', state: 'absent', bundledPresent: false, installed: false, enabled: true, qualified: false });
    expect(report.before.fingerprint).toContain(manifest.revision);
    await activate(panel.getByRole('button', { name: '停用语义检索', exact: true }));
    await expect(panel).toContainText('偏好停用');
    await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: test.info().outputPath('bundled-model-absent-disabled.png'), fullPage: true });
    const workId = await page.evaluate(async () => {
      const api = window.rainSoul, works = await api.listWorks();
      let work = await api.openWork(works.find(work => work.title === '无模型研究验收作品').id);
      work = await api.manageAssets({ workId: work.id, expectedRevision: work.revision, operationId: crypto.randomUUID(), action: { type: 'createKnowledge', body: '窗外的雨声映照孤独心情。', source: '验收原创知识', categoryId: work.assets.categories.find(item => item.name === '景物描写').id, tagIds: [] } });
      return work.id;
    });
    for (const mode of ['keyword', 'hybrid', 'semantic']) {
      const reply = await page.evaluate(({ workId, mode }) => window.rainSoul.queryKnowledge({ workId, queryId: crypto.randomUUID(), query: '雨声', mode, tagIds: [], page: 1, pageSize: 20 }), { workId, mode });
      expect(reply.total).toBe(1); expect(reply.modelFingerprint).toBeNull(); expect(reply.hits[0].matchedBy).toEqual(['keyword']);
      expect(reply.status).toBe(mode === 'keyword' ? 'ready' : 'fallback');
    }
    report.evidence.keywordFallback = true;
    expect(existsSync(path.join(dataDirectory(directory), 'RetrievalCache'))).toBe(false);
    await closeNormally(application); application = await launch(directory); page = await offlineWindow(application);
    report.after = await page.evaluate(() => window.rainSoul.getRetrievalModelStatus());
    expect(report.after).toMatchObject({ source: 'bundled', bundledPresent: false, enabled: false, installed: false, qualified: false });
    report.evidence.disabledPreferencePersisted = true;
    await activate(page.getByRole('button', { name: '打开作品：无模型研究验收作品', exact: true }));
    await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue('离线写作保持');
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toContainText('未捆绑模型时，雨声中的写作仍可保存。');
    report.evidence.writingPersisted = true;
    await navigate(page, '设置'); await expect(page.getByLabel('本机知识检索模型', { exact: true })).toContainText('偏好停用');
    await closeNormally(application); report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.message = error.message; throw error; }
  finally {
    const file = test.info().outputPath('bundled-model-research-report.json'); await writeFile(file, JSON.stringify(report, null, 2));
    await test.info().attach('无模型研究包验收记录', { path: file, contentType: 'application/json' });
    await cleanup(application, directory);
  }
});
