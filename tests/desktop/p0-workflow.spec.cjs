const { test, expect } = require('@playwright/test');
const { writeFile, readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');
const yauzl = require('yauzl');
const { chooseSelect, activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup, createWork, writeChapter } = require('./structure-helper.cjs');

test.setTimeout(120000);
async function openWorkActions(page) {
  const menu = page.locator('details.work-more');
  if (!await menu.evaluate(node => node.open)) await activate(menu.locator('summary'));
  await expect(page.getByRole('group', { name: '作品操作', exact: true })).toBeVisible();
}
const reference = '雨滴敲在窗沿，像逐渐密集的鼓点。';
const prose = '雨落在旧车站。她从口袋里取出一把旧钥匙。';
async function capture(page, name) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
  if (process.env.RAINSOUL_CAPTURE_LEARNING === '1') {
    const directory = path.resolve('learning/项目全流程开发学习/images');
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
  }
}
async function sidebar(page, name) {
  const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
  if (await expand.isVisible()) await activate(expand);
  await activate(page.getByRole('button', { name, exact: true }));
}
async function currentWork(page, title) {
  return page.evaluate(async title => {
    const item = (await window.rainSoul.listWorks()).find(item => item.title === title);
    return window.rainSoul.openWork(item.id);
  }, title);
}
async function setDialogFile(application, filename, save = false) {
  await application.evaluate(({ dialog }, { filename, save }) => {
    if (save) dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
    else dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, { filename, save });
}
async function docxText(filename) {
  const bytes = await readFile(filename);
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.on('error', reject);
      zip.on('entry', entry => {
        if (entry.fileName !== 'word/document.xml') return zip.readEntry();
        zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(error);
          const chunks = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => { zip.close(); resolve(Buffer.concat(chunks).toString('utf8').replace(/<[^>]+>/g, '')); });
        });
      });
      zip.on('end', () => reject(new Error('导出的 DOCX 缺少正文 XML')));
      zip.readEntry();
    });
  });
}

test('离线知识、剧情、伏笔书签与整部作品恢复通过真实 IPC 保留关系', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    application = await launch(directory);
    let page = await offlineWindow(application);
    await createWork(page, '雨落之后');
    await writeChapter(page, '第一章 旧车站', prose);
    await sidebar(page, '知识库');
    await activate(page.getByRole('button', { name: /^作品知识库/ }));
    await activate(page.getByRole('button', { name: '新增知识', exact: true }));
    const form = page.getByRole('form', { name: '新添知识', exact: true });
    await form.getByRole('textbox', { name: '知识内容', exact: true }).fill(reference);
    await form.getByRole('textbox', { name: '出处', exact: true }).fill('自写练习句');
    await chooseSelect(form.getByRole('combobox', { name: '主分类', exact: true }), '景物描写');
    await activate(form.getByRole('button', { name: '保存知识', exact: true }));
    await expect(form).toHaveCount(0);
    const card = page.getByRole('article', { name: `知识：${reference.slice(0, 20)}`, exact: true });
    await expect(card).toContainText('自写练习句');
    await activate(card.getByRole('button', { name: /^展开知识：/ }));
    await page.getByRole('searchbox', { name: '模糊搜索知识与正文', exact: true }).fill('雨');
    await expect(card).toBeVisible();
    await capture(page, 'knowledge');
    await sidebar(page, '作品集');
    await activate(page.getByRole('button', { name: '打开作品：雨落之后', exact: true }));
    await activate(page.getByRole('tab', { name: '剧情架构', exact: true }));
    await activate(page.getByRole('button', { name: '新增章节点', exact: true }));
    await page.getByRole('textbox', { name: '节点名称', exact: true }).fill('车站发现旧钥匙');
    await activate(page.getByRole('button', { name: '创建节点', exact: true }));
    await page.getByRole('textbox', { name: '剧情摘要', exact: true }).fill('在雨夜让人物找到旧钥匙，留下身份谜团。');
    await chooseSelect(page.getByRole('combobox', { name: '关联正文章节', exact: true }), '第一章 旧车站');
    await activate(page.getByRole('button', { name: '保存剧情', exact: true }));
    await capture(page, 'plot');
    await activate(page.getByRole('tab', { name: '伏笔架构', exact: true }));
    await page.getByRole('textbox', { name: '新伏笔名称', exact: true }).fill('旧钥匙');
    await activate(page.getByRole('button', { name: '添加伏笔', exact: true }));
    await chooseSelect(page.getByRole('combobox', { name: '伏笔状态', exact: true }), '已埋设');
    await chooseSelect(page.getByRole('combobox', { name: '归属剧情节点', exact: true }), '车站发现旧钥匙');
    await page.getByRole('textbox', { name: '伏笔说明', exact: true }).fill('钥匙纹样与后续人物身份相关。');
    await activate(page.getByRole('button', { name: '保存伏笔', exact: true }));
    await chooseSelect(page.getByRole('combobox', { name: '证据章节', exact: true }), '第一章 旧车站');
    await chooseSelect(page.getByRole('combobox', { name: '证据段落', exact: true }), { index: 1 });
    await page.getByRole('textbox', { name: '证据摘录', exact: true }).fill('她从口袋里取出一把旧钥匙。');
    await activate(page.getByRole('button', { name: '添加证据', exact: true }));
    await expect(page.getByRole('region', { name: '埋设、触发与回收证据', exact: true })).toContainText('原出处：第一章 旧车站');
    await capture(page, 'foreshadow');
    await activate(page.getByRole('tab', { name: '正文', exact: true }));
    const editor = page.getByRole('textbox', { name: '章节正文', exact: true });
    await editor.press('Control+End');
    await page.getByText('引用与伏笔书签', { exact: true }).press('Enter');
    await activate(page.getByRole('button', { name: '插入书签', exact: true }));
    await chooseSelect(page.getByRole('combobox', { name: '书签类型', exact: true }), '伏笔标记');
    await activate(page.getByRole('button', { name: '插入书签', exact: true }));
    await editor.getByRole('button', { name: '伏笔书签：旧钥匙', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '旧钥匙', exact: true })).toContainText('钥匙纹样');
    await activate(page.getByRole('button', { name: '关闭书签详情', exact: true }));
    await openWorkActions(page);
    await activate(page.getByRole('button', { name: '版本历史', exact: true }));
    await page.getByRole('textbox', { name: '快照名称', exact: true }).fill('第一稿');
    await activate(page.getByRole('button', { name: '创建快照', exact: true }));
    await expect(page.getByRole('button', { name: '预览并恢复：第一稿', exact: true })).toBeVisible();
    const original = await currentWork(page, '雨落之后');
    expect(original.chapters[0].document.content.flatMap(item => item.content ?? []).filter(item => item.type === 'bookmark')).toHaveLength(2);
    await activate(page.getByRole('button', { name: '关闭版本历史', exact: true }));
    await writeChapter(page, '修改稿章节', '这是恢复前必须保留的修改稿。');
    await openWorkActions(page);
    await activate(page.getByRole('button', { name: '版本历史', exact: true }));
    const beforeHistoricalExport = await currentWork(page, '雨落之后');
    const beforeHistory = await page.evaluate(id => window.rainSoul.listSnapshots(id), original.id);
    for (const format of ['TXT', 'DOCX']) {
      const filename = path.join(directory, `第一稿历史.${format.toLowerCase()}`);
      await setDialogFile(application, filename, true);
      await activate(page.getByRole('button', { name: `导出快照 ${format}：第一稿`, exact: true }));
      await expect.poll(async () => (await readFile(filename).catch(() => Buffer.alloc(0))).length).toBeGreaterThan(100);
      const text = format === 'TXT' ? await readFile(filename, 'utf8') : await docxText(filename);
      expect(text).toContain(prose);
      expect(text).toContain(reference);
      expect(text).toContain('旧钥匙');
      expect(text).not.toContain('这是恢复前必须保留的修改稿。');
      expect(text).not.toContain('修改稿章节');
    }
    const afterHistoricalExport = await currentWork(page, '雨落之后');
    expect(afterHistoricalExport.chapters).toEqual(beforeHistoricalExport.chapters);
    expect(afterHistoricalExport.revision).toBe(beforeHistoricalExport.revision);
    expect(await page.evaluate(id => window.rainSoul.listSnapshots(id), original.id)).toEqual(beforeHistory);
    await activate(page.getByRole('button', { name: '预览并恢复：第一稿', exact: true }));
    await expect(page.getByRole('region', { name: '恢复预览', exact: true })).toContainText('第一章 旧车站');
    await capture(page, 'snapshots');
    await activate(page.getByRole('button', { name: '恢复为新版本', exact: true }));
    await activate(page.getByRole('dialog', { name: '确认恢复快照', exact: true }).getByRole('button', { name: '确认恢复', exact: true }));
    await expect(page.getByRole('button', { name: /^预览并恢复：/ })).toHaveCount(3);
    const restored = await currentWork(page, '雨落之后');
    expect(restored.chapters[0].document).toEqual(original.chapters[0].document);
    expect(restored.assets.knowledge).toEqual(original.assets.knowledge);
    expect(restored.assets.foreshadows).toEqual(original.assets.foreshadows);
    expect(restored.assets.evidence[0].paragraphId).toBe(original.chapters[0].document.content[0].attrs.id);
    await activate(page.getByRole('button', { name: '关闭版本历史', exact: true }));
    const archive = path.join(directory, '完整关系.rainsoul');
    await setDialogFile(application, archive, true);
    await openWorkActions(page);
    await activate(page.getByRole('button', { name: '备份项目', exact: true }));
    await expect.poll(async () => (await readFile(archive).catch(() => Buffer.alloc(0))).length).toBeGreaterThan(100);
    await activate(page.getByRole('button', { name: '返回作品集', exact: true }));
    await setDialogFile(application, archive);
    await activate(page.getByRole('button', { name: '导入项目', exact: true }));
    await activate(page.getByRole('dialog', { name: '导入项目归档', exact: true }).getByRole('button', { name: '导入为新作品', exact: true }));
    await expect(page.getByRole('heading', { name: '雨落之后', exact: true })).toBeVisible();
    const copy = await page.evaluate(async originalId => {
      const item = (await window.rainSoul.listWorks()).find(item => item.title === '雨落之后' && item.id !== originalId);
      return window.rainSoul.openWork(item.id);
    }, original.id);
    expect(copy.chapters).toEqual(restored.chapters);
    expect(copy.assets).toEqual(restored.assets);
    expect(await page.evaluate(id => window.rainSoul.listSnapshots(id), copy.id)).toHaveLength(3);
    await closeNormally(application);
    application = await launch(directory);
    page = await offlineWindow(application);
    const reopened = await currentWork(page, '雨落之后');
    expect(reopened.chapters[0].document).toEqual(original.chapters[0].document);
    expect(await page.evaluate(id => window.rainSoul.listSnapshots(id), reopened.id)).toHaveLength(3);
  } finally { await cleanup(application, directory); }
});

test('手稿预览、TXT与DOCX导出和归档导入为新作品在离线重启后保持', async () => {
  const directory = await temporaryDirectory();
  const manuscript = path.join(directory, '雨落之后.txt');
  const txtExport = path.join(directory, '导出.txt');
  const docxExport = path.join(directory, '导出.docx');
  const archive = path.join(directory, '作品备份.rainsoul');
  let application;
  try {
    await writeFile(manuscript, `第一章 旧车站\n${prose}\n第二章 雨停\n她收好钥匙。`, 'utf8');
    application = await launch(directory);
    let page = await offlineWindow(application);
    await setDialogFile(application, manuscript);
    await activate(page.getByRole('button', { name: '导入手稿', exact: true }));
    const preview = page.getByRole('dialog', { name: '导入预览', exact: true });
    await expect(preview.getByRole('textbox', { name: '导入章节 1 标题', exact: true })).toHaveValue('第一章 旧车站');
    await expect(preview.getByRole('textbox', { name: '导入章节 2 标题', exact: true })).toHaveValue('第二章 雨停');
    await capture(page, 'manuscript-import');
    await activate(preview.getByRole('button', { name: '创建新作品', exact: true }));
    await expect(page.getByRole('heading', { name: '雨落之后', exact: true })).toBeVisible();
    await expect(page.locator('dialog[aria-label="导入预览"]')).toHaveCount(0);
    await setDialogFile(application, txtExport, true);
    await openWorkActions(page);
    await activate(page.getByRole('button', { name: '导出 TXT', exact: true }));
    await expect.poll(async () => readFile(txtExport, 'utf8').catch(() => '')).toContain(prose);
    await setDialogFile(application, docxExport, true);
    await openWorkActions(page);
    await activate(page.getByRole('button', { name: '导出 DOCX', exact: true }));
    await expect.poll(async () => (await readFile(docxExport).catch(() => Buffer.alloc(0))).subarray(0, 2).toString()).toBe('PK');
    const original = await currentWork(page, '雨落之后');
    await setDialogFile(application, archive, true);
    await openWorkActions(page);
    await activate(page.getByRole('button', { name: '备份项目', exact: true }));
    await expect.poll(async () => (await readFile(archive).catch(() => Buffer.alloc(0))).length).toBeGreaterThan(100);
    await activate(page.getByRole('button', { name: '返回作品集', exact: true }));
    await setDialogFile(application, archive);
    await activate(page.getByRole('button', { name: '导入项目', exact: true }));
    await activate(page.getByRole('dialog', { name: '导入项目归档', exact: true }).getByRole('button', { name: '导入为新作品', exact: true }));
    await expect(page.getByRole('heading', { name: '雨落之后', exact: true })).toBeVisible();
    const copies = await page.evaluate(async () => {
      const works = (await window.rainSoul.listWorks()).filter(item => item.title === '雨落之后');
      return Promise.all(works.map(item => window.rainSoul.openWork(item.id)));
    });
    expect(copies).toHaveLength(2);
    expect(copies.find(item => item.id !== original.id).chapters).toEqual(original.chapters);
    expect(await readFile(manuscript, 'utf8')).toContain(prose);
    await activate(page.getByRole('button', { name: '返回作品集', exact: true }));
    const sourceDocx = path.join(directory, 'DOCX手稿.docx');
    await writeFile(sourceDocx, await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ text: '第一章 DOCX导入', heading: HeadingLevel.HEADING_1 }), new Paragraph('这是可识别的正文。')] }] })));
    await setDialogFile(application, sourceDocx);
    await activate(page.getByRole('button', { name: '导入手稿', exact: true }));
    await expect(preview.getByRole('textbox', { name: '导入章节 1 标题', exact: true })).toHaveValue('第一章 DOCX导入');
    await activate(preview.getByRole('button', { name: '创建新作品', exact: true }));
    await expect(page.getByRole('textbox', { name: '章节正文', exact: true })).toContainText('这是可识别的正文。');
    await closeNormally(application);
    application = await launch(directory);
    page = await offlineWindow(application);
    await expect(page.getByRole('button', { name: '打开作品：雨落之后', exact: true })).toHaveCount(2);
    await expect(page.getByRole('button', { name: '打开作品：DOCX手稿', exact: true })).toBeVisible();
  } finally { await cleanup(application, directory); }
});

test('云端设置与发送范围预览可离线取消且不修改原稿', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    application = await launch(directory);
    const page = await offlineWindow(application);
    await createWork(page, 'AI授权演练');
    await writeChapter(page, '第一章', prose);
    await sidebar(page, '设置');
    await page.getByRole('textbox', { name: '服务名称', exact: true }).fill('离线验收服务');
    await page.getByRole('textbox', { name: '服务地址', exact: true }).fill('https://api.example.com/v1');
    await page.getByRole('textbox', { name: '模型名称', exact: true }).fill('test-model');
    // 仅用于临时数据目录安全存储，不是真实服务密钥；本测试从不确认发送。
    await page.getByLabel('API Key', { exact: true }).fill('temporary-test-credential');
    await page.getByRole('textbox', { name: '计费说明', exact: true }).fill('测试配置，请勿确认发送。');
    await activate(page.getByRole('button', { name: '保存云端模型配置', exact: true }));
    await expect(page.getByRole('status').filter({ hasText: '云端模型配置已保存' })).toBeVisible();
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
    await page.evaluate(async () => {
      const item = (await window.rainSoul.listWorks()).find(item => item.title === 'AI授权演练');
      const work = await window.rainSoul.openWork(item.id);
      await window.rainSoul.manageAssets({ workId: work.id, expectedRevision: work.revision, operationId: crypto.randomUUID(),
        action: { type: 'createKnowledge', body: '雨落在旧车站，路灯把人影拉长。', source: '自写参考句', categoryId: work.assets.categories.find(item => item.name === '景物描写').id, tagIds: [] } });
    });
    await sidebar(page, '作品集');
    await activate(page.getByRole('button', { name: '打开作品：AI授权演练', exact: true }));
    const before = await currentWork(page, 'AI授权演练');
    await activate(page.getByRole('button', { name: 'AI 工具', exact: true }));
    await page.getByText('知识参考 · 作者选用', { exact: true }).press('Enter');
    await page.getByRole('textbox', { name: '本机参考查询', exact: true }).fill('雨落');
    await activate(page.getByRole('button', { name: '查找写作参考', exact: true }));
    await page.getByRole('checkbox', { name: '雨落在旧车站，路灯把人影拉长。', exact: true }).check();
    await activate(page.getByRole('button', { name: '预览 AI 请求', exact: true }));
    const confirmation = page.getByRole('dialog', { name: '确认云端 AI 操作', exact: true });
    await expect(confirmation).toContainText('离线验收服务');
    await expect(confirmation).toContainText('test-model');
    await expect(confirmation).toContainText(prose);
    await expect(confirmation).toContainText('自写参考句');
    await expect(confirmation).toContainText('测试配置，请勿确认发送。');
    await expect(confirmation).not.toContainText('temporary-test-credential');
    await activate(confirmation.getByRole('button', { name: '取消', exact: true }));
    await expect(confirmation).toHaveCount(0);
    const after = await currentWork(page, 'AI授权演练');
    expect(after.chapters).toEqual(before.chapters);
    expect(await page.evaluate(id => window.rainSoul.listSnapshots(id), after.id)).toHaveLength(0);
    await activate(page.getByRole('button', { name: '关闭AI工具', exact: true }));
    const editor = page.getByRole('textbox', { name: '章节正文', exact: true });
    await editor.press('Control+Home');
    for (let index = 0; index < 3; index++) await editor.press('Shift+ArrowRight');
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(prose.slice(0, 3));
    await editor.dispatchEvent('contextmenu', { clientX: 360, clientY: 230 });
    await activate(page.getByRole('menuitem', { name: 'AI 单句润色', exact: true }));
    await expect(page.getByRole('textbox', { name: '目标单句', exact: true })).toHaveValue(prose.slice(0, 3));
    await expect(page.getByRole('combobox', { name: 'AI 操作', exact: true })).toHaveText('单句润色');
    // 从写作进入知识页选参考，再返回时保留同正文版本的单句目标。
    await activate(page.getByRole('button', { name: '关闭AI工具', exact: true }));
    await sidebar(page, '知识库');
    await activate(page.getByRole('button', { name: /^作品知识库/ }));
    await activate(page.getByRole('article', { name: '知识：雨落在旧车站，路灯把人影拉长。', exact: true }).getByRole('button', { name: /^展开知识：/ }));
    await activate(page.getByRole('button', { name: '选作参考', exact: true }));
    await activate(page.getByRole('button', { name: '返回写作', exact: true }));
    await activate(page.getByRole('button', { name: 'AI 工具', exact: true }));
    await expect(page.getByRole('textbox', { name: '目标单句', exact: true })).toHaveValue(prose.slice(0, 3));
    await expect(page.getByRole('combobox', { name: 'AI 操作', exact: true })).toHaveText('单句润色');
    await activate(page.getByRole('button', { name: '预览 AI 请求', exact: true }));
    await expect(confirmation).toContainText(prose.slice(0, 3));
    await expect(confirmation).toContainText('自写参考句');
    await activate(confirmation.getByRole('button', { name: '取消', exact: true }));
    expect((await currentWork(page, 'AI授权演练')).chapters).toEqual(before.chapters);
  } finally { await cleanup(application, directory); }
});

test('最小窗口的写作入口和AI面板可在侧栏展开与收起时触达', async () => {
  const directory = await temporaryDirectory();
  let application;
  try {
    application = await launch(directory);
    const page = await offlineWindow(application);
    await createWork(page, '小窗口验收');
    await writeChapter(page, '第一章', prose);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 540));
    for (const expanded of [false, true]) {
      if (expanded) await activate(page.getByRole('button', { name: '展开侧栏', exact: true }));
      await activate(page.getByRole('button', { name: 'AI 工具', exact: true }));
      await page.evaluate(() => { document.scrollingElement.scrollTop = 0; document.querySelector('dialog[aria-label="AI工具"]').scrollTop = 0; });
      await page.screenshot({ path: test.info().outputPath(`small-window-${expanded ? 'expanded' : 'collapsed'}.png`), fullPage: true });
      const geometry = await page.evaluate(() => {
        const items = [...document.querySelectorAll('button')].filter(item => ['备份项目', '导出 TXT', '导出 DOCX', '预览 AI 请求'].includes(item.textContent.trim()));
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        const main = document.querySelector('main').getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, main: { left: main.left, width: main.width }, controls: [...items, ...tabs].map(item => {
          const box = item.getBoundingClientRect();
          return { label: item.textContent.trim(), left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        }) };
      });
      await test.info().attach(`geometry-${expanded ? 'expanded' : 'collapsed'}`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
      await writeFile(test.info().outputPath(`geometry-${expanded ? 'expanded' : 'collapsed'}.json`), JSON.stringify(geometry, null, 2));
      expect.soft(geometry.scrollWidth, `${expanded ? '展开' : '收起'}侧栏：页面宽度`).toBeLessThanOrEqual(geometry.width);
      expect.soft(geometry.main.width, `${expanded ? '展开' : '收起'}侧栏：主区域不能掉入60px导航列`).toBeGreaterThanOrEqual(geometry.width - 236);
      for (const control of geometry.controls) {
        expect.soft(control.left, `${expanded ? '展开' : '收起'}侧栏：${control.label}左边界`).toBeGreaterThanOrEqual(0);
        expect.soft(control.right, `${expanded ? '展开' : '收起'}侧栏：${control.label}右边界`).toBeLessThanOrEqual(geometry.width);
      }
      await page.getByRole('button', { name: '预览 AI 请求', exact: true }).scrollIntoViewIfNeeded();
      await expect.soft(page.getByRole('button', { name: '预览 AI 请求', exact: true })).toBeInViewport();
      await activate(page.getByRole('button', { name: '关闭AI工具', exact: true }));
    }
  } finally { await cleanup(application, directory); }
});
