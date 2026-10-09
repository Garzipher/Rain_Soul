const { test, expect } = require('@playwright/test');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup } = require('./structure-helper.cjs');

test('离线作者资料可直接改名、清除头像，关闭重启后保留且不改变作品', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    const avatar = await readFile('assets/rainsoul.png');
    await writeFile(path.join(directory, 'author-profile.json'), JSON.stringify({ penName: '雨夜作者', avatarDataUrl: `data:image/png;base64,${avatar.toString('base64')}` }));
    application = await launch(directory);
    const jpeg = (await readFile('tests/unit/fixtures/avatar-valid.jpg')).toString('base64');
    expect(await application.evaluate(({ nativeImage }, data) => {
      const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
      return { empty: image.isEmpty(), size: image.getSize() };
    }, jpeg)).toEqual({ empty: false, size: { width: 16, height: 8 } });
    let page = await offlineWindow(application);
    await activate(page.getByRole('button', { name: '展开侧栏', exact: true }));
    await expect(page.getByRole('img', { name: '作者头像', exact: true })).toBeVisible();
    await activate(page.getByRole('button', { name: '编辑显示名称：雨夜作者', exact: true }));
    await page.getByRole('textbox', { name: '修改显示名称', exact: true }).fill('听雨');
    await activate(page.getByRole('button', { name: '保存名称', exact: true }));
    await expect(page.getByRole('button', { name: '编辑显示名称：听雨', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '打开作品：项目全流程开发学习', exact: true })).toHaveCount(1);
    await activate(page.getByRole('button', { name: '设置', exact: true }));
    await activate(page.getByRole('button', { name: '移除头像', exact: true }));
    await expect(page.getByRole('img', { name: '作者头像', exact: true })).toHaveCount(0);
    await closeNormally(application);
    application = await launch(directory);
    page = await offlineWindow(application);
    await activate(page.getByRole('button', { name: '展开侧栏', exact: true }));
    await expect(page.getByRole('button', { name: '编辑显示名称：听雨', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: '作者头像', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '打开作品：项目全流程开发学习', exact: true })).toHaveCount(1);
  } finally { await cleanup(application, directory); }
});
