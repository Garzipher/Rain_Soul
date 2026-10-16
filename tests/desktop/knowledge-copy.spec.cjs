const { test, expect } = require('@playwright/test');
const { chooseSelect, activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup } = require('./structure-helper.cjs');

test.setTimeout(120000);
const reference = '雨滴敲在窗沿，像逐渐密集的鼓点。';
async function sidebar(page, name) {
  const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
  if (await expand.isVisible()) await activate(expand);
  await activate(page.getByRole('button', { name, exact: true }));
}

test('离线跨作品复制预览映射目标字典，取消不写入，分类草稿保护其他操作', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    application = await launch(directory);
    let page = await offlineWindow(application);
    const seed = await page.evaluate(async body => {
      const api = window.rainSoul;
      const change = (work, action) => api.manageAssets({ workId: work.id, expectedRevision: work.revision, operationId: crypto.randomUUID(), action });
      let source = await api.createWork('素材来源作品');
      source = await change(source, { type: 'createTag', name: '雨夜' });
      source = await change(source, { type: 'createTag', name: '仅在来源' });
      source = await change(source, { type: 'createKnowledge', body, source: '作者自写参考句', categoryId: source.assets.categories.find(item => item.name === '景物描写').id, tagIds: source.assets.tags.map(item => item.id) });
      let target = await api.createWork('复制目标作品');
      target = await change(target, { type: 'createTag', name: '雨夜' });
      target = await change(target, { type: 'createTag', name: '写作参考' });
      return { source, target };
    }, reference);
    expect(seed.source.assets.tags.find(item => item.name === '雨夜').id).not.toBe(seed.target.assets.tags.find(item => item.name === '雨夜').id);
    // IPC 建立夹具后重启，界面从数据库加载；不切换主进程到来源作品来核验。
    await closeNormally(application);
    application = await launch(directory);
    page = await offlineWindow(application);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await sidebar(page, '知识库');
    await expect(page.getByRole('button', { name: '全局知识库', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^作品知识库/ })).toBeDisabled();
    await expect(page.getByText(/本功能尚未交付/)).toHaveCount(0);
    await sidebar(page, '作品集');
    await activate(page.getByRole('button', { name: '打开作品：复制目标作品', exact: true }));
    await sidebar(page, '知识库');
    await activate(page.getByRole('button', { name: /^作品知识库/ }));
    const scope = page.getByRole('combobox', { name: '作品范围', exact: true });
    await chooseSelect(scope, '全部作品（只读）');
    const card = page.getByRole('article', { name: `知识：${reference.slice(0, 20)}`, exact: true });
    await activate(card.getByRole('button', { name: /^展开知识：/ }));
    await expect(card).toContainText('素材来源作品');
    await activate(card.getByRole('button', { name: '复制到当前作品', exact: true }));
    let dialog = page.getByRole('dialog', { name: '复制知识到当前作品', exact: true });
    await expect(dialog).toContainText('来源分类：景物描写');
    await expect(dialog).toContainText('未匹配标签：仅在来源');
    await expect(dialog.getByRole('checkbox', { name: '雨夜', exact: true })).toBeChecked();
    const categoryId = seed.target.assets.categories.find(item => item.name === '景物描写').id;
    await chooseSelect(dialog.getByRole('combobox', { name: '目标主分类', exact: true }), '景物描写');
    await dialog.getByRole('checkbox', { name: '写作参考', exact: true }).check();
    await activate(dialog.getByRole('button', { name: '取消', exact: true }));
    await expect(dialog).toHaveCount(0);
    const cancelled = await page.evaluate(id => window.rainSoul.openWork(id), seed.target.id);
    expect(cancelled.assets.knowledge).toEqual([]);
    expect(cancelled.revision).toBe(seed.target.revision);

    await activate(card.getByRole('button', { name: '复制到当前作品', exact: true }));
    dialog = page.getByRole('dialog', { name: '复制知识到当前作品', exact: true });
    await chooseSelect(dialog.getByRole('combobox', { name: '目标主分类', exact: true }), '景物描写');
    await dialog.getByRole('checkbox', { name: '写作参考', exact: true }).check();
    await page.screenshot({ path: test.info().outputPath('knowledge-copy.png'), fullPage: true });
    await activate(dialog.getByRole('button', { name: '确认复制', exact: true }));
    await expect(dialog).toHaveCount(0);
    await expect(scope).toHaveText('当前作品：复制目标作品');
    await activate(card.getByRole('button', { name: /^展开知识：/ }));
    await expect(card).toContainText('来源作品：素材来源作品');
    const copied = await page.evaluate(id => window.rainSoul.openWork(id), seed.target.id);
    expect(copied.assets.knowledge).toHaveLength(1);
    expect(copied.assets.knowledge[0]).toMatchObject({ body: reference, source: '作者自写参考句', categoryId,
      origin: { workId: seed.source.id, entryId: seed.source.assets.knowledge[0].id, sourceRevision: seed.source.revision, workTitle: '素材来源作品' } });
    expect(copied.assets.knowledge[0].tagIds.slice().sort()).toEqual(seed.target.assets.tags.map(item => item.id).sort());
    expect(copied.assets.tags).toEqual(seed.target.assets.tags);
    const sourceScope = await page.evaluate(id => window.rainSoul.readKnowledgeScope(id), seed.source.id);
    expect(sourceScope.knowledge).toEqual(seed.source.assets.knowledge);
    expect(sourceScope.tags).toEqual(seed.source.assets.tags);
    expect(sourceScope.entryOwners[seed.source.assets.knowledge[0].id].sourceRevision).toBe(seed.source.revision);

    await sidebar(page, '设置');
    const dictionary = page.locator('#settings-dictionary').getByRole('region', { name: '知识分类与标签维护', exact: true });
    const otherEditor = dictionary.getByRole('button', { name: '编辑分类：人物描写', exact: true });
    const otherDelete = dictionary.getByRole('button', { name: '删除分类：人物描写', exact: true });
    const tagDelete = dictionary.getByRole('button', { name: '删除标签：雨夜', exact: true });
    await activate(dictionary.getByRole('button', { name: '编辑分类：景物描写', exact: true }));
    await dictionary.getByRole('textbox', { name: '分类名称', exact: true }).fill('未提交的分类草稿');
    await expect(dictionary).toContainText('请先保存或取消当前草稿');
    await expect(otherEditor).toBeDisabled();
    await expect(otherDelete).toBeDisabled();
    await expect(tagDelete).toBeDisabled();
    await activate(dictionary.getByRole('button', { name: '取消', exact: true }));
    await expect(otherEditor).toBeEnabled();
    await expect(otherDelete).toBeEnabled();
    await expect(tagDelete).toBeEnabled();
    const untouched = await page.evaluate(id => window.rainSoul.openWork(id), seed.target.id);
    expect(untouched.assets.categories).toEqual(copied.assets.categories);
    expect(untouched.assets.tags).toEqual(copied.assets.tags);
    expect(untouched.revision).toBe(copied.revision);
    expect(pageErrors).toEqual([]);
    await closeNormally(application);
  } finally { await cleanup(application, directory); }
});
