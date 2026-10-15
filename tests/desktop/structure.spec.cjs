const { test, expect } = require('@playwright/test');
const { activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup, createWork, writeChapter } = require('./structure-helper.cjs');

const chapterButton = (page, title) => page.getByRole('button', { name: `打开章节：${title}`, exact: true });
const chapterPane = page => page.getByRole('complementary', { name: '章节列表', exact: true });
const volumeGroup = (page, title) => page.getByRole('group', { name: `分卷：${title}`, exact: true });

async function expectNames(locator, names) {
  await expect.poll(() => locator.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual(names);
}

async function selectChapter(page, title) {
  const button = chapterButton(page, title);
  await activate(button);
  await expect(button).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue(title);
  await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toBeEnabled();
}

async function expandVolume(page, title) {
  const collapsed = page.getByRole('button', { name: `展开分卷：${title}`, exact: true });
  if (await collapsed.count()) await activate(collapsed);
  await expect(page.getByRole('button', { name: `收起分卷：${title}`, exact: true })).toBeVisible();
}

async function contextAction(page, target, name, keyboard = false, mouseMenu = false) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  if (keyboard) { await target.focus(); await target.press('Shift+F10'); }
  else await target.click({ button: 'right' });
  const item = page.getByRole('menuitem', { name, exact: true });
  if (mouseMenu) await item.click();
  else await activate(item);
}

async function createVolume(page, title) {
  const add = page.getByRole('button', { name: '添加分卷', exact: true });
  await expect(add).toBeVisible();
  await activate(add);
  const dialog = page.getByRole('dialog', { name: '新建分卷', exact: true });
  await dialog.getByRole('textbox', { name: '分卷名称', exact: true }).fill(title);
  await activate(dialog.getByRole('button', { name: '创建分卷', exact: true }));
  await expect(dialog).toHaveCount(0);
  await expandVolume(page, title);
}

async function deleteConfirmation(page, title) {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  // 避免此前出现的残留“删除作品”右键菜单；确认期间菜单必须已卸载。
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  return dialog;
}

async function openRecovery(page, workTitle) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await activate(page.getByRole('button', { name: '设置', exact: true }));
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await activate(page.getByRole('button', { name: '删除与恢复', exact: true }));
  const select = page.getByRole('combobox', { name: '选择恢复作品', exact: true });
  await select.press('Space');
  await page.getByRole('option', { name: workTitle, exact: true }).press('Enter');
  await expect(select).toHaveText(workTitle);
}

async function reopenFromShelf(page, title) {
  await activate(page.getByRole('button', { name: '作品集', exact: true }));
  await expect(page.getByRole('heading', { name: '作品集', exact: true })).toBeVisible();
  await activate(page.getByRole('button', { name: `打开作品：${title}`, exact: true }));
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toHaveAttribute('contenteditable', 'true');
}

test('离线卷章创建与同级排序在正常关闭后保持稳定', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    application = await launch(directory);
    let page = await offlineWindow(application);
    await createWork(page, '卷章顺序验收');
    await writeChapter(page, '无卷甲章', '甲章原稿');
    await createVolume(page, '第一卷');
    await selectChapter(page, '无卷甲章');
    await activate(page.getByRole('button', { name: '添加章节', exact: true }));
    await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue('第2章');
    await writeChapter(page, '无卷乙章', '乙章原稿');
    await contextAction(page, chapterButton(page, '无卷乙章'), '上移', true);
    await expectNames(chapterPane(page).getByRole('button', { name: /^打开章节：/ }), ['打开章节：无卷乙章', '打开章节：无卷甲章']);
    await contextAction(page, chapterButton(page, '无卷甲章'), '移至分卷：第一卷');
    await expect(volumeGroup(page, '第一卷').getByRole('button', { name: '打开章节：无卷甲章', exact: true })).toBeVisible();
    await contextAction(page, page.getByRole('button', { name: '收起分卷：第一卷', exact: true }), '添加章节');
    await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue('第3章');
    await writeChapter(page, '卷内乙章', '卷内第二段');
    await contextAction(page, chapterButton(page, '卷内乙章'), '上移');
    await expectNames(volumeGroup(page, '第一卷').getByRole('button', { name: /^打开章节：/ }), ['打开章节：卷内乙章', '打开章节：无卷甲章']);
    await createVolume(page, '第二卷');
    await contextAction(page, page.getByRole('button', { name: '收起分卷：第二卷', exact: true }), '上移');
    await expectNames(chapterPane(page).getByRole('button', { name: /^收起分卷：/ }), ['收起分卷：第二卷', '收起分卷：第一卷']);
    await page.screenshot({ path: test.info().outputPath('volumes-and-chapters.png'), fullPage: true });
    await selectChapter(page, '无卷乙章');
    await page.getByRole('textbox', { name: '章节正文', exact: true }).fill('乙章关闭前的最新稿件');
    await closeNormally(application);
    application = await launch(directory);
    page = await offlineWindow(application);
    await activate(page.getByRole('button', { name: '打开作品：卷章顺序验收', exact: true }));
    await expandVolume(page, '第二卷');
    await expandVolume(page, '第一卷');
    await expectNames(chapterPane(page).getByRole('button', { name: /^收起分卷：/ }), ['收起分卷：第二卷', '收起分卷：第一卷']);
    await expectNames(volumeGroup(page, '第一卷').getByRole('button', { name: /^打开章节：/ }), ['打开章节：卷内乙章', '打开章节：无卷甲章']);
    await selectChapter(page, '无卷乙章');
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toContainText('乙章关闭前的最新稿件');
    await selectChapter(page, '无卷甲章');
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toContainText('甲章原稿');
  } finally { await cleanup(application, directory); }
});

test('章节删除先确认且可从设置恢复原稿', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    application = await launch(directory);
    const page = await offlineWindow(application);
    await createWork(page, '卷章恢复验收');
    await writeChapter(page, '保留原稿', '删除后也必须恢复的原文');
    await contextAction(page, chapterButton(page, '保留原稿'), '删除章节', true);
    let dialog = await deleteConfirmation(page, '删除章节');
    await activate(dialog.getByRole('button', { name: '取消', exact: true }));
    await expect(chapterButton(page, '保留原稿')).toBeVisible();
    await expect(chapterButton(page, '保留原稿')).toBeFocused();
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toContainText('删除后也必须恢复的原文');
    await contextAction(page, chapterButton(page, '保留原稿'), '删除章节', false, true);
    dialog = await deleteConfirmation(page, '删除章节');
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(chapterButton(page, '保留原稿')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toHaveCount(0);
    await openRecovery(page, '卷章恢复验收');
    await page.screenshot({ path: test.info().outputPath('chapter-recovery.png'), fullPage: true });
    await activate(page.getByRole('group', { name: '已删除章节：保留原稿', exact: true }).getByRole('button', { name: '恢复', exact: true }));
    await expect(page.getByRole('group', { name: '已删除章节：保留原稿', exact: true })).toHaveCount(0);
    await reopenFromShelf(page, '卷章恢复验收');
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toContainText('删除后也必须恢复的原文');
  } finally { await cleanup(application, directory); }
});

test('删除分卷显示受影响章节并从设置恢复整卷原稿和归属', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    application = await launch(directory);
    const page = await offlineWindow(application);
    await createWork(page, '卷章恢复验收');
    await writeChapter(page, '保留原稿', '删除后也必须恢复的原文');
    await createVolume(page, '恢复整卷');
    await contextAction(page, chapterButton(page, '保留原稿'), '移至分卷：恢复整卷');
    await expect(volumeGroup(page, '恢复整卷').getByRole('button', { name: '打开章节：保留原稿', exact: true })).toBeVisible();
    await contextAction(page, page.getByRole('button', { name: '收起分卷：恢复整卷', exact: true }), '添加章节');
    await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue('第2章');
    await writeChapter(page, '第二份原稿', '第二章独立正文');
    await contextAction(page, page.getByRole('button', { name: '收起分卷：恢复整卷', exact: true }), '删除分卷');
    let dialog = await deleteConfirmation(page, '删除卷及章节');
    await expect(dialog).toContainText('保留原稿');
    await expect(dialog).toContainText('第二份原稿');
    await activate(dialog.getByRole('button', { name: '取消', exact: true }));
    await expect(volumeGroup(page, '恢复整卷').getByRole('button', { name: /^打开章节：/ })).toHaveCount(2);
    await contextAction(page, page.getByRole('button', { name: '收起分卷：恢复整卷', exact: true }), '删除分卷');
    dialog = await deleteConfirmation(page, '删除卷及章节');
    await activate(dialog.getByRole('button', { name: '确认删除', exact: true }));
    await expect(volumeGroup(page, '恢复整卷')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toHaveCount(0);
    await openRecovery(page, '卷章恢复验收');
    await activate(page.getByRole('group', { name: '已删除分卷：恢复整卷', exact: true }).getByRole('button', { name: '恢复', exact: true }));
    await expect(page.getByRole('group', { name: '已删除分卷：恢复整卷', exact: true })).toHaveCount(0);
    await reopenFromShelf(page, '卷章恢复验收');
    await expandVolume(page, '恢复整卷');
    await expectNames(volumeGroup(page, '恢复整卷').getByRole('button', { name: /^打开章节：/ }), ['打开章节：保留原稿', '打开章节：第二份原稿']);
    await selectChapter(page, '保留原稿');
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toContainText('删除后也必须恢复的原文');
    await selectChapter(page, '第二份原稿');
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toContainText('第二章独立正文');
  } finally { await cleanup(application, directory); }
});

test('同名作品删除和恢复按身份隔离，重启不串稿', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    application = await launch(directory);
    let page = await offlineWindow(application);
    await createWork(page, '同名作品');
    await writeChapter(page, '甲作品章', '甲作品独有正文');
    await activate(page.getByRole('button', { name: '返回作品集', exact: true }));
    await expect(page.getByRole('heading', { name: '作品集', exact: true })).toBeVisible();
    const firstId = await page.evaluate(async () => (await window.rainSoul.listWorks()).find(work => work.title === '同名作品').id);
    await createWork(page, '同名作品');
    await writeChapter(page, '乙作品章', '乙作品独有正文');
    await activate(page.getByRole('button', { name: '返回作品集', exact: true }));
    await expect(page.getByRole('heading', { name: '作品集', exact: true })).toBeVisible();
    const secondId = await page.evaluate(async first => (await window.rainSoul.listWorks()).find(work => work.title === '同名作品' && work.id !== first).id, firstId);
    const card = id => page.getByRole('button', { name: '打开作品：同名作品', exact: true }).and(page.locator(`[data-work-id="${id}"]`));
    await contextAction(page, card(firstId), '删除作品');
    let dialog = await deleteConfirmation(page, '删除作品');
    await activate(dialog.getByRole('button', { name: '取消', exact: true }));
    await expect(page.getByRole('button', { name: '打开作品：同名作品', exact: true })).toHaveCount(2);
    for (const id of [firstId, secondId]) {
      await contextAction(page, card(id), '删除作品');
      dialog = await deleteConfirmation(page, '删除作品');
      await activate(dialog.getByRole('button', { name: '确认删除', exact: true }));
      await expect(page.locator(`[data-work-id="${id}"]`)).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: '打开作品：项目全流程开发学习', exact: true })).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await activate(page.getByRole('button', { name: '设置', exact: true }));
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await activate(page.getByRole('button', { name: '删除与恢复', exact: true }));
    const deletedCard = id => page.getByRole('group', { name: '已删除作品：同名作品', exact: true }).and(page.locator(`[data-work-id="${id}"]`));
    await activate(deletedCard(firstId).getByRole('button', { name: '恢复作品：同名作品', exact: true }));
    await expect(deletedCard(firstId)).toHaveCount(0);
    await expect(deletedCard(secondId)).toBeVisible();
    await reopenFromShelf(page, '同名作品');
    await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue('甲作品章');
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toHaveText('甲作品独有正文');
    await activate(page.getByRole('button', { name: '设置', exact: true }));
    await activate(page.getByRole('button', { name: '删除与恢复', exact: true }));
    await activate(deletedCard(secondId).getByRole('button', { name: '恢复作品：同名作品', exact: true }));
    await expect(deletedCard(secondId)).toHaveCount(0);
    await activate(page.getByRole('button', { name: '作品集', exact: true }));
    await expect(page.getByRole('button', { name: '打开作品：同名作品', exact: true })).toHaveCount(2);
    await closeNormally(application);
    application = await launch(directory);
    page = await offlineWindow(application);
    await activate(card(firstId));
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toHaveText('甲作品独有正文');
    await activate(page.getByRole('button', { name: '返回作品集', exact: true }));
    await activate(card(secondId));
    await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue('乙作品章');
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toHaveText('乙作品独有正文');
  } finally { await cleanup(application, directory); }
});
