const { test, expect, _electron } = require('@playwright/test');
const { existsSync, readFileSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { chooseSelect, activate, temporaryDirectory, offlineWindow, closeNormally, cleanup, createWork, writeChapter } = require('./structure-helper.cjs');

test.setTimeout(180000);
test.skip(!process.env.RAINSOUL_TEST_MODEL_EXECUTABLE, '须显式指定已经通过底层资格实测的含模型RainSoul目录包。');
const childProcesses = new WeakMap();
async function start(directory) {
  const env = { ...process.env, LOCALAPPDATA: directory, APPDATA: directory };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const application = await _electron.launch({ executablePath: process.env.RAINSOUL_TEST_MODEL_EXECUTABLE, args: [`--user-data-dir=${path.join(directory, 'ElectronProfile')}`], env });
  childProcesses.set(application, application.process());
  return application;
}
async function navigate(page, name) {
  const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
  if (await expand.isVisible()) await activate(expand);
  await activate(page.getByRole('button', { name, exact: true }));
}
async function addKnowledge(page, body, category) {
  await activate(page.getByRole('button', { name: '新增知识', exact: true }));
  const form = page.getByRole('form', { name: '新添知识', exact: true });
  await form.getByLabel('知识内容', { exact: true }).fill(body);
  await form.getByLabel('出处', { exact: true }).fill('原创含模型验收夹具');
  await chooseSelect(form.getByRole('combobox'), category);
  await activate(form.getByRole('button', { name: '保存知识', exact: true }));
  await expect(form).not.toBeVisible();
}

test('真实含模型包离线启用、知识改写检索与停用回退重启保持', async () => {
  const executable = process.env.RAINSOUL_TEST_MODEL_EXECUTABLE;
  expect(path.isAbsolute(executable)).toBe(true);
  const resources = path.join(path.dirname(executable), 'resources');
  const manifest = JSON.parse(readFileSync(path.resolve('assets/retrieval-model-manifest.json'), 'utf8'));
  expect(existsSync(path.join(resources, 'retrieval-model', manifest.revision, 'weights', 'onnx', 'model_quantized.onnx'))).toBe(true);
  const { inspectPackagedRetrieval } = await import('../../scripts/packaged-retrieval-acceptance.mjs');
  const identity = await inspectPackagedRetrieval(executable, manifest);
  const directory = await temporaryDirectory(); let application;
  const report = { schemaVersion: 1, timestamp: new Date().toISOString(), identity, evidence: {}, scope: '真实含模型目录包UI/IPC与重启；renderer Context离线，无全系统抓包及干净安装声明。' };
  try {
    application = await start(directory); let page = await offlineWindow(application);
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true);
    await createWork(page, '含模型语义验收'); await writeChapter(page, '第一章', '离线验证后原稿仍然保持。');
    await navigate(page, '设置'); const panel = page.getByLabel('本机知识检索模型', { exact: true });
    report.initial = await page.evaluate(() => window.rainSoul.getRetrievalModelStatus());
    expect(report.initial).toMatchObject({ source: 'bundled', bundledPresent: true, installed: true, qualified: true });
    if (!report.initial.enabled) await activate(panel.getByRole('button', { name: '启用语义检索', exact: true }));
    await expect(panel).toContainText('语义检索可用'); report.evidence.enabled = true;
    await navigate(page, '知识库');
    await activate(page.getByRole('button', { name: /^作品知识库/ }));
    const target = '环境烘托：人物独坐空房，窗外冷雨打在玻璃上，用阴冷景物映照寂寞心情。';
    await addKnowledge(page, target, '景物描写');
    await addKnowledge(page, '人物弧光：曾经逃避责任的人在高潮主动保护同伴，以行动完成价值选择的变化。', '人物描写');
    const workId = await page.evaluate(async () => (await window.rainSoul.listWorks()).find(work => work.title === '含模型语义验收').id);
    await navigate(page, '设置'); await activate(panel.getByRole('button', { name: '重建当前作品索引', exact: true }));
    await expect(panel.getByRole('status').filter({ hasText: '索引重建完成' })).toBeVisible({ timeout: 90000 }); report.evidence.indexed = true;
    const query = '想让空荡房间里的冷天气映出一个人的寂寞，有什么写法？';
    report.semantic = await page.evaluate(({ workId, query }) => window.rainSoul.queryKnowledge({ workId, queryId: crypto.randomUUID(), query, mode: 'semantic', tagIds: [], page: 1, pageSize: 20 }), { workId, query });
    expect(report.semantic.status).toBe('ready'); expect(report.semantic.modelFingerprint).not.toBeNull();
    expect(report.semantic.hits.some(hit => hit.excerpt === target && hit.reliable && hit.matchedBy.includes('semantic'))).toBe(true);
    await navigate(page, '知识库');
    await activate(page.getByRole('button', { name: /^作品知识库/ })); await chooseSelect(page.getByRole('combobox', { name: '检索方式', exact: true }), '语义');
    await page.getByRole('searchbox', { name: '模糊搜索知识与正文', exact: true }).fill(query);
    const card = page.getByRole('article', { name: /^知识：环境烘托/ });
    await expect(card).toContainText('语义相关', { timeout: 60000 }); await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('bundled-semantic-result.png'), fullPage: true }); report.evidence.semanticUi = true;
    await navigate(page, '设置'); await activate(panel.getByRole('button', { name: '停用语义检索', exact: true }));
    await expect(panel.getByRole('button', { name: '启用语义检索', exact: true })).toBeEnabled();
    report.disabled = await page.evaluate(() => window.rainSoul.getRetrievalModelStatus());
    expect(report.disabled).toMatchObject({ installed: true, qualified: true, enabled: false, state: 'disabled' });
    const fallback = await page.evaluate(workId => window.rainSoul.queryKnowledge({ workId, queryId: crypto.randomUUID(), query: '冷雨', mode: 'hybrid', tagIds: [], page: 1, pageSize: 20 }), workId);
    expect(fallback.status).toBe('fallback'); expect(fallback.modelFingerprint).toBeNull(); expect(fallback.hits[0].matchedBy).toEqual(['keyword']);
    report.evidence.disabledFallback = true;
    await closeNormally(application); application = await start(directory); page = await offlineWindow(application);
    report.reopened = await page.evaluate(() => window.rainSoul.getRetrievalModelStatus());
    expect(report.reopened).toMatchObject({ installed: true, qualified: true, enabled: false, state: 'disabled' });
    await activate(page.getByRole('button', { name: '打开作品：含模型语义验收', exact: true }));
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toContainText('离线验证后原稿仍然保持。');
    report.evidence.restartPersisted = true;
    await closeNormally(application);
    expect(await inspectPackagedRetrieval(executable, manifest)).toEqual(identity); report.status = 'passed';
  } catch(error) { report.status = 'failed'; report.error = error.message; throw error; }
  finally {
    const output = test.info().outputPath('bundled-semantic-model-report.json'); await writeFile(output, JSON.stringify(report, null, 2));
    await test.info().attach('实际含模型UI验收', { path: output, contentType: 'application/json' });
    const child = application && childProcesses.get(application);
    if (child?.exitCode === null) await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
    if(application) await application.close().catch(() => {});
    await cleanup(application, directory);
  }
});
