const { test, expect } = require('@playwright/test');
const { activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup } = require('./structure-helper.cjs');
test.setTimeout(120000);
async function navigate(page, name) {
  const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
  if (await expand.isVisible()) await activate(expand);
  await activate(page.getByRole('button', { name, exact: true }));
}
test('未安装模型时关键词及混合回退真实IPC可用，全局卡片可定位来源', async () => {
  const directory = await temporaryDirectory(); let application;
  try {
    application = await launch(directory); let page = await offlineWindow(application);
    const ids = await page.evaluate(async () => {
      const api = window.rainSoul;
      let source = await api.createWork('检索来源作品');
      source = await api.manageAssets({ workId: source.id, expectedRevision: source.revision, operationId: crypto.randomUUID(), action: { type: 'createKnowledge', body: '雨敲窗沿，水光在灯下摇晃。', source: '作者自写练习', categoryId: source.assets.categories.find(item => item.name === '景物描写').id, tagIds: [] } });
      const target = await api.createWork('本机检索验收');
      return { source: source.id, target: target.id };
    });
    await closeNormally(application); application = await launch(directory); page = await offlineWindow(application);
    await activate(page.getByRole('button', { name: '打开作品：本机检索验收', exact: true }));
    await navigate(page, '知识库');
    await page.getByRole('combobox', { name: '作品范围', exact: true }).selectOption('all');
    await page.getByRole('searchbox', { name: '模糊搜索知识与正文', exact: true }).fill('雨');
    const card = page.getByRole('article', { name: /知识：雨敲窗沿/ });
    await expect(card).toContainText('检索来源作品');
    await expect(card).toContainText('关键词命中');
    await page.getByRole('combobox', { name: '检索方式', exact: true }).selectOption('hybrid');
    await expect(card).toBeVisible();
    await expect(page.getByRole('region', { name: '知识工作区' })).toContainText(/回退|关键词/);
    await page.screenshot({ path: test.info().outputPath('knowledge-local-fallback.png'), fullPage: true });
    await activate(card.getByRole('button', { name: '复制到当前作品', exact: true }));
    await expect(page.getByRole('dialog', { name: '复制知识到当前作品', exact: true })).toContainText('检索来源作品');
    await activate(page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }));
    await navigate(page, '设置');
    const panel = page.getByLabel('本机知识检索模型', { exact: true });
    await expect(panel).toContainText('未安装');
    await expect(panel).toContainText('偏好开启');
    await expect(panel).toContainText('当前使用关键词');
    await expect(panel.getByRole('button', { name: '停用语义检索', exact: true })).toBeEnabled();
    await expect(panel.getByRole('button', { name: '重建当前作品索引', exact: true })).toBeDisabled();
    const status = await page.evaluate(() => window.rainSoul.getRetrievalModelStatus());
    expect(status).toMatchObject({ enabled: true, qualified: false, installed: false, source: 'bundled' });
    await expect(panel).toContainText('关键词检索始终可用');
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('settings-local-model.png'), fullPage: true });
    expect(ids.source).not.toBe(ids.target);
    await closeNormally(application);
  } finally { await cleanup(application, directory); }
});
