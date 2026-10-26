const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { chooseSelect, activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup, createWork, writeChapter } = require('./structure-helper.cjs');

test.setTimeout(120000);
async function sidebar(page, name) {
  const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
  if (await expand.isVisible()) await activate(expand);
  await activate(page.getByRole('button', { name, exact: true }));
}
async function workId(page, title) {
  return page.evaluate(async title => (await window.rainSoul.listWorks()).find(item => item.title === title).id, title);
}
async function renameConversation(page, name) {
  await activate(page.getByRole('button', { name: '重命名', exact: true }));
  await page.getByRole('textbox', { name: '会话名称', exact: true }).fill(name);
  await activate(page.getByRole('button', { name: '保存名称', exact: true }));
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function capture(page, name) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}
async function assertNarrowControls(page, names) {
  const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(result.scrollWidth).toBeLessThanOrEqual(result.width + 1);
  for (const name of names) {
    const role = name === '会话输入' ? 'textbox' : name === '会话所属作品' ? 'combobox' : 'button';
    const control = page.getByRole(role, { name, exact: true });
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box, name).not.toBeNull();
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(result.width + 1);
    expect(box.width, name).toBeGreaterThan(0);
  }
}

test('P1会话离线记录与草稿真实持久化，重启不串作品且删除需确认', async () => {
  const directory = await temporaryDirectory(); let application;
  try {
    application = await launch(directory); let page = await offlineWindow(application);
    await createWork(page, 'P1会话作品甲'); await writeChapter(page, '第一章', '正文不会成为会话消息。');
    await sidebar(page, '作品集'); await createWork(page, 'P1会话作品乙');
    const firstId = await workId(page, 'P1会话作品甲'), secondId = await workId(page, 'P1会话作品乙');
    await sidebar(page, '需求会话');
    await chooseSelect(page.getByRole('combobox', { name: '会话所属作品', exact: true }), 'P1会话作品甲');
    await expect(page.getByRole('combobox', { name: '会话所属作品', exact: true })).toHaveText('P1会话作品甲');
    await activate(page.getByRole('button', { name: '新建会话', exact: true }));
    await renameConversation(page, '离线构思');
    const composer = page.getByRole('textbox', { name: '会话输入', exact: true });
    await composer.fill('一条只存在本机的讨论记录。');
    await activate(page.getByRole('button', { name: '仅记录', exact: true }));
    await expect(page.getByRole('log', { name: '会话消息', exact: true })).toContainText('一条只存在本机的讨论记录。');
    await expect(composer).toHaveValue('');
    await composer.fill('重启后还在的离线草稿。');
    await expect.poll(() => page.evaluate(async id => {
      const items = await window.rainSoul.listConversations(id); const detail = await window.rainSoul.readConversation(id, items[0].id); return detail.draft;
    }, firstId)).toBe('重启后还在的离线草稿。');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 540));
    const collapse = page.getByRole('button', { name: '收起侧栏', exact: true }); if (await collapse.isVisible()) await activate(collapse);
    const expandList = page.getByRole('button', { name: '展开会话列表', exact: true });
    if (await expandList.isVisible()) await activate(expandList);
    await assertNarrowControls(page, ['会话所属作品', '会话输入', '仅记录', '发送']);
    await capture(page, 'p1-conversation-narrow');
    await closeNormally(application); application = await launch(directory); page = await offlineWindow(application);
    await activate(page.getByRole('button', { name: '打开作品：P1会话作品甲', exact: true }));
    await sidebar(page, '需求会话'); await activate(page.getByRole('button', { name: '打开会话：离线构思', exact: true }));
    await expect(page.getByRole('textbox', { name: '会话输入', exact: true })).toHaveValue('重启后还在的离线草稿。');
    await expect(page.getByRole('log', { name: '会话消息', exact: true })).toContainText('一条只存在本机的讨论记录。');
    await chooseSelect(page.getByRole('combobox', { name: '会话所属作品', exact: true }), 'P1会话作品乙');
    await expect(page.getByRole('combobox', { name: '会话所属作品', exact: true })).toHaveText('P1会话作品乙');
    await expect(page.getByRole('button', { name: '打开会话：离线构思', exact: true })).toHaveCount(0);
    await activate(page.getByRole('button', { name: '新建会话', exact: true })); await renameConversation(page, '作品乙会话');
    await page.getByRole('textbox', { name: '会话输入', exact: true }).fill('乙作品独立草稿。');
    await expect.poll(() => page.evaluate(async id => {
      const items = await window.rainSoul.listConversations(id); return (await window.rainSoul.readConversation(id, items[0].id)).draft;
    }, secondId)).toBe('乙作品独立草稿。');
    await chooseSelect(page.getByRole('combobox', { name: '会话所属作品', exact: true }), 'P1会话作品甲');
    await expect(page.getByRole('combobox', { name: '会话所属作品', exact: true })).toHaveText('P1会话作品甲');
    const row = page.getByRole('button', { name: '打开会话：离线构思', exact: true }); await row.hover();
    await activate(page.getByRole('button', { name: '删除会话：离线构思', exact: true }));
    await activate(page.getByRole('dialog', { name: '删除会话', exact: true }).getByRole('button', { name: '取消删除', exact: true }));
    await expect(row).toBeVisible(); await row.hover();
    await activate(page.getByRole('button', { name: '删除会话：离线构思', exact: true }));
    await activate(page.getByRole('dialog', { name: '删除会话', exact: true }).getByRole('button', { name: '确认删除会话', exact: true }));
    await expect(row).toHaveCount(0);
    expect(await page.evaluate(id => window.rainSoul.listConversations(id), firstId)).toHaveLength(0);
    await chooseSelect(page.getByRole('combobox', { name: '会话所属作品', exact: true }), 'P1会话作品乙');
    await expect(page.getByRole('button', { name: '打开会话：作品乙会话', exact: true })).toBeVisible();
    expect(await page.evaluate(id => window.rainSoul.listConversations(id), secondId)).toHaveLength(1);
    await capture(page, 'p1-conversation-delete');
  } finally { await cleanup(application, directory); }
});

test('P1本地拆书默认零选择，取消不写库，两段审核真实入库与重启保留出处', async () => {
  const directory = await temporaryDirectory(); let application;
  const filename = path.join(directory, '优秀作品.txt');
  await writeFile(filename, '第一章 安静的雨夜\n细雨落在窗上，灯光被揉成柔软的金色。\n她把旧信折好，像把一个季节藏入口袋。\n未选内容不得进入知识库。', 'utf-8');
  try {
    application = await launch(directory); let page = await offlineWindow(application);
    await createWork(page, 'P1拆书练习'); const id = await workId(page, 'P1拆书练习');
    await sidebar(page, '知识库');
    await activate(page.getByRole('button', { name: /^作品知识库/ }));
    await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, filename);
    await activate(page.getByRole('button', { name: '拆书工具', exact: true }));
    await activate(page.getByRole('button', { name: '选择 TXT / DOCX', exact: true }));
    await expect(page.getByRole('textbox', { name: '摘选内容 1', exact: true })).toHaveValue('细雨落在窗上，灯光被揉成柔软的金色。');
    await expect(page.getByRole('button', { name: '确认入库（0）', exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: '审核通过段落 1', exact: true })).not.toBeChecked();
    await activate(page.getByRole('button', { name: '返回知识库', exact: true }));
    await activate(page.getByRole('button', { name: '保存草稿并返回', exact: true }));
    expect((await page.evaluate(id => window.rainSoul.openWork(id), id)).assets.knowledge).toHaveLength(0);
    await activate(page.getByRole('button', { name: '拆书工具', exact: true }));
    await expect(page.getByRole('textbox', { name: '摘选内容 1', exact: true })).toHaveValue('细雨落在窗上，灯光被揉成柔软的金色。');
    await activate(page.getByRole('button', { name: '更换素材', exact: true }));
    await activate(page.getByRole('button', { name: '放弃草稿并更换', exact: true }));
    await expect(page.getByRole('dialog', { name: '更换拆书素材？', exact: true })).toHaveCount(0);
    await activate(page.getByRole('button', { name: '选择 TXT / DOCX', exact: true }));
    await page.getByRole('textbox', { name: '来源作品名', exact: true }).fill('雨夜练习原作');
    await page.getByRole('textbox', { name: '来源作者', exact: true }).fill('合成测试作者');
    await chooseSelect(page.getByRole('combobox', { name: '摘选分类 1', exact: true }), '景物描写');
    await chooseSelect(page.getByRole('combobox', { name: '摘选分类 2', exact: true }), '内心描写');
    await page.getByRole('checkbox', { name: '审核通过段落 1', exact: true }).check();
    await page.getByRole('checkbox', { name: '审核通过段落 2', exact: true }).check();
    await page.getByRole('checkbox', { name: '确认有权使用摘选内容', exact: true }).check();
    await capture(page, 'p1-book-extraction-review');
    await activate(page.getByRole('button', { name: '确认入库（2）', exact: true }));
    await expect(page.getByRole('checkbox', { name: '审核通过段落 1', exact: true })).toBeDisabled();
    await activate(page.getByRole('button', { name: '返回知识库', exact: true }));
    await activate(page.getByRole('button', { name: '保存草稿并返回', exact: true }));
    await expect(page.getByRole('article', { name: /^知识：/ })).toHaveCount(2);
    const first = page.getByRole('article', { name: /^知识：细雨落在窗上/ });
    await activate(first.getByRole('button', { name: /^展开知识：/ }));
    await expect(first).toContainText('合成测试作者'); await expect(first).toContainText('优秀作品.txt');
    await expect(first).toContainText('第1段'); await expect(first).not.toContainText('SHA-256');
    const verification = first.getByText('来源校验详情', { exact: true });
    await verification.press('Enter');
    await expect(first).toContainText('文件 SHA-256：'); await expect(first).toContainText('段落 SHA-256：');
    await capture(page, 'p1-book-source-verification');
    await verification.press('Enter'); await expect(first).not.toContainText('SHA-256');
    const state = await page.evaluate(id => window.rainSoul.openWork(id), id);
    expect(state.assets.knowledge).toHaveLength(2); expect(state.assets.knowledge.some(entry => entry.body.includes('未选内容'))).toBe(false);
    expect(await page.evaluate(id => window.rainSoul.listSnapshots(id), id)).toEqual(expect.arrayContaining([expect.objectContaining({ title: '拆书入库前安全快照' })]));
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 540));
    const collapse = page.getByRole('button', { name: '收起侧栏', exact: true }); if (await collapse.isVisible()) await activate(collapse);
    await assertNarrowControls(page, ['拆书工具', '新增知识']);
    const collapseCategories = page.getByRole('button', { name: '收起分类', exact: true });
    if (await collapseCategories.isVisible()) await activate(collapseCategories);
    await expect(page.getByRole('button', { name: '展开分类', exact: true })).toBeVisible();
    await first.scrollIntoViewIfNeeded();
    await first.getByLabel(/^知识操作：/).press('Enter');
    await expect(first.getByRole('group', { name: '知识操作', exact: true })).toBeVisible();
    const cardGeometry = await first.evaluate(card => {
      const outer = card.getBoundingClientRect();
      const buttons = [...card.querySelectorAll('.knowledge-entry-menu-items button')].map(button => {
        const box = button.getBoundingClientRect(); return { width: box.width, height: box.height, left: box.left, right: box.right };
      });
      return { width: innerWidth, cardLeft: outer.left, cardRight: outer.right, cardWidth: card.clientWidth, cardScrollWidth: card.scrollWidth, buttons };
    });
    expect(cardGeometry.cardScrollWidth).toBeLessThanOrEqual(cardGeometry.cardWidth + 1);
    expect(cardGeometry.cardLeft).toBeGreaterThanOrEqual(0); expect(cardGeometry.cardRight).toBeLessThanOrEqual(cardGeometry.width);
    expect(cardGeometry.buttons).toHaveLength(2);
    for (const button of cardGeometry.buttons) { expect(button.width).toBeGreaterThan(35); expect(button.height).toBeLessThan(35); expect(button.right).toBeLessThanOrEqual(cardGeometry.cardRight); }
    await capture(page, 'p1-book-knowledge-narrow');
    await closeNormally(application); application = await launch(directory); page = await offlineWindow(application);
    await activate(page.getByRole('button', { name: '打开作品：P1拆书练习', exact: true })); await sidebar(page, '知识库');
    await activate(page.getByRole('button', { name: /^作品知识库/ }));
    await expect(page.getByRole('article', { name: /^知识：/ })).toHaveCount(2);
    await activate(page.getByRole('article', { name: /^知识：细雨落在窗上/ }).getByRole('button', { name: /^展开知识：/ }));
    await capture(page, 'p1-book-knowledge-reopened');
    expect((await page.evaluate(id => window.rainSoul.openWork(id), id)).assets.knowledge).toEqual(state.assets.knowledge);
  } finally { await cleanup(application, directory); }
});

test('P1会话直接发送仅含当前会话，停止生成不改正文或追加消息', async () => {
  const directory = await temporaryDirectory(); let application;
  try {
    application = await launch(directory); const page = await offlineWindow(application);
    await createWork(page, 'P1会话云授权'); await writeChapter(page, '第一章', '绝不应进入会话授权范围的正文哨兵。');
    const id = await workId(page, 'P1会话云授权');
    await sidebar(page, '设置');
    await page.getByRole('textbox', { name: '服务名称', exact: true }).fill('P1离线演练服务');
    await page.getByRole('textbox', { name: '服务地址', exact: true }).fill('https://8.8.8.8/v1');
    await page.getByRole('textbox', { name: '模型名称', exact: true }).fill('test-conversation-model');
    await page.getByLabel('API Key', { exact: true }).fill('temporary-p1-test-credential');
    await page.getByRole('textbox', { name: '计费说明', exact: true }).fill('虚构配置，HTTPS 已替身隔离，不发送真实网络。');
    await activate(page.getByRole('button', { name: '保存云端模型配置', exact: true }));
    await expect(page.getByRole('status').filter({ hasText: '云端模型配置已保存' })).toBeVisible();
    await sidebar(page, '需求会话'); await activate(page.getByRole('button', { name: '新建会话', exact: true })); await renameConversation(page, '另一个私密会话');
    await page.getByRole('textbox', { name: '会话输入', exact: true }).fill('不能发送的另一个会话哨兵。');
    await activate(page.getByRole('button', { name: '仅记录', exact: true }));
    await expect(page.getByRole('log', { name: '会话消息', exact: true })).toContainText('不能发送的另一个会话哨兵。');
    await activate(page.getByRole('button', { name: '新建会话', exact: true })); await renameConversation(page, '授权范围演练');
    await page.getByRole('textbox', { name: '会话输入', exact: true }).fill('本会话历史讨论。');
    await activate(page.getByRole('button', { name: '仅记录', exact: true }));
    await expect(page.getByRole('log', { name: '会话消息', exact: true })).toContainText('本会话历史讨论。');
    await page.getByRole('textbox', { name: '会话输入', exact: true }).fill('这次拟发送的合成测试问题。');
    // 截获主进程全部 HTTPS，不调用原实现；保留待完成请求以实测停止按钮。
    await application.evaluate(() => {
      const { EventEmitter } = process.getBuiltinModule('node:events');
      globalThis.p1Requests = [];
      process.getBuiltinModule('node:https').request = (_url, options) => {
        const request = new EventEmitter();
        request.end = body => { globalThis.p1Requests.push(JSON.parse(body)); };
        options.signal.addEventListener('abort', () => request.emit('error', new Error('隔离会话停止')), { once: true });
        return request;
      };
    });
    await activate(page.getByRole('button', { name: '发送', exact: true }));
    await expect.poll(() => application.evaluate(() => globalThis.p1Requests.length)).toBe(1);
    const outgoing = await application.evaluate(() => globalThis.p1Requests[0]);
    const material = JSON.stringify(outgoing);
    expect(outgoing.model).toBe('test-conversation-model');
    expect(material).toContain('本会话历史讨论。'); expect(material).toContain('这次拟发送的合成测试问题。');
    expect(material).not.toContain('绝不应进入会话授权范围的正文哨兵。'); expect(material).not.toContain('temporary-p1-test-credential');
    expect(material).not.toContain('不能发送的另一个会话哨兵。');
    await expect(page.getByRole('dialog', { name: '云端会话发送确认', exact: true })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'P1离线演练服务 正在思考' })).toBeVisible();
    await activate(page.getByRole('button', { name: '停止生成', exact: true }));
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
    await capture(page, 'p1-conversation-direct-stop');
    expect(await application.evaluate(() => globalThis.p1Requests.length)).toBe(1);
    await expect(page.getByRole('textbox', { name: '会话输入', exact: true })).toHaveValue('这次拟发送的合成测试问题。');
    const list = await page.evaluate(id => window.rainSoul.listConversations(id), id);
    const detail = await page.evaluate(({ id, conversationId }) => window.rainSoul.readConversation(id, conversationId), { id, conversationId: list.find(item => item.title === '授权范围演练').id });
    expect(detail.messages).toHaveLength(1); expect(detail.messages[0].role).toBe('user');
    expect((await page.evaluate(id => window.rainSoul.openWork(id), id)).chapters[0].document.content[0].content[0].text).toBe('绝不应进入会话授权范围的正文哨兵。');
  } finally { await cleanup(application, directory); }
});
