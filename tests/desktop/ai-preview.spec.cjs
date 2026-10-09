const { test, expect } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { activate, temporaryDirectory, launch, offlineWindow, cleanup, createWork, writeChapter } = require('./structure-helper.cjs');

test.setTimeout(120000);

test('真实窗口保护写作特点草稿，离线预览授权材料并取消，正文与快照不变', async () => {
  const directory = await temporaryDirectory(); let application;
  try {
    application = await launch(directory);
    const page = await offlineWindow(application);
    await createWork(page, 'AI 授权练习');
    await writeChapter(page, '第一章 雨夜', '窗外的雨落在旧站台。');
    await activate(page.getByRole('button', { name: '展开侧栏', exact: true }));
    await activate(page.getByRole('button', { name: '设置', exact: true }));
    await page.getByRole('textbox', { name: '节奏', exact: true }).fill('舒缓，保留停顿');
    await expect(page.getByRole('combobox', { name: '第一章 雨夜写作特点', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '发布新版本', exact: true })).toBeEnabled();
    await activate(page.getByRole('button', { name: '放弃更改', exact: true }));
    await expect(page.getByRole('combobox', { name: '第一章 雨夜写作特点', exact: true })).toBeEnabled();
    // 虚构凭据只写入本测试隔离目录；本用例永不点击确认发送。
    await page.getByRole('textbox', { name: '服务名称', exact: true }).fill('教材测试服务');
    await page.getByRole('textbox', { name: '服务地址', exact: true }).fill('https://api.example.com/v1');
    await page.getByRole('textbox', { name: '模型名称', exact: true }).fill('textbook-test-model');
    await page.getByLabel('API Key', { exact: true }).fill('textbook-fake-key-no-network');
    await page.getByRole('textbox', { name: '计费说明', exact: true }).fill('测试预览，不发送请求，不产生费用。');
    await activate(page.getByRole('button', { name: '保存云端模型配置', exact: true }));
    await expect(page.getByText('云端模型配置已保存，密钥不会在界面回显。', { exact: true })).toBeVisible();
    await activate(page.getByRole('button', { name: '作品集', exact: true }));
    await activate(page.getByRole('button', { name: '打开作品：AI 授权练习', exact: true }));
    const before = await page.evaluate(async () => {
      const item = (await window.rainSoul.listWorks()).find(work => work.title === 'AI 授权练习');
      return { work: await window.rainSoul.openWork(item.id), snapshots: await window.rainSoul.listSnapshots(item.id) };
    });
    await activate(page.getByRole('button', { name: 'AI 工具', exact: true }));
    await page.getByRole('combobox', { name: 'AI 操作', exact: true }).selectOption('extractKnowledge');
    await activate(page.getByRole('button', { name: '预览 AI 请求', exact: true }));
    const dialog = page.getByRole('dialog', { name: '确认云端 AI 操作', exact: true });
    await expect(dialog).toContainText('教材测试服务');
    await expect(dialog).toContainText('窗外的雨落在旧站台。');
    await expect(dialog).toContainText('测试预览，不发送请求，不产生费用。');
    await expect(dialog).not.toContainText('textbook-fake-key-no-network');
    await page.screenshot({ path: test.info().outputPath('ai-authorization-preview.png'), fullPage: true });
    if (process.env.RAINSOUL_CAPTURE_LEARNING === '1') {
      const images = path.resolve('learning/项目全流程开发学习/images');
      await mkdir(images, { recursive: true });
      await page.screenshot({ path: path.join(images, 'ai-authorization-preview.png'), fullPage: true });
    }
    await activate(dialog.getByRole('button', { name: '取消', exact: true }));
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '待审核候选', exact: true })).toHaveCount(0);
    const after = await page.evaluate(async id => ({ work: await window.rainSoul.openWork(id), snapshots: await window.rainSoul.listSnapshots(id) }), before.work.id);
    expect(after).toEqual(before);
  } finally { await cleanup(application, directory); }
});
