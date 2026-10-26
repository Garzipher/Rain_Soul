const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const yauzl = require('yauzl');
const { activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup } = require('./structure-helper.cjs');

test.setTimeout(120000);

async function exportedText(filename, format) {
  const bytes = await readFile(filename);
  if (format === 'TXT') return bytes.toString('utf8');
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
      zip.on('end', () => reject(new Error('导出文件缺少正文 XML')));
      zip.readEntry();
    });
  });
}

test('当前净稿与历史净稿通过真实界面导出TXT和DOCX，保留历史身份且完整稿仍有资料', async () => {
  const directory = await temporaryDirectory(); let application;
  try {
    application = await launch(directory);
    let page = await offlineWindow(application);
    const seed = await page.evaluate(async () => {
      const api = window.rainSoul;
      let work = await api.createWork('test α净稿导出');
      const change = async action => { work = await api.manageAssets({ workId: work.id, expectedRevision: work.revision, operationId: crypto.randomUUID(), action }); };
      await change({ type: 'createKnowledge', body: 'test 仅属于创作资料的知识原句', source: 'test 原创参考', categoryId: work.assets.categories[0].id, tagIds: [] });
      await change({ type: 'createForeshadow', name: 'test 旧钥匙线索' });
      const chapter = work.chapters[0], document = window.structuredClone(chapter.document);
      document.content[0].content = [{ type: 'text', text: 'test 历史正文：雨停了。' },
        { type: 'bookmark', attrs: { id: crypto.randomUUID(), kind: 'knowledge', targetId: work.assets.knowledge[0].id } },
        { type: 'bookmark', attrs: { id: crypto.randomUUID(), kind: 'foreshadow', targetId: work.assets.foreshadows[0].id } }];
      await api.saveChapter(work.id, chapter.id, 'test 历史章节', document, work.revision, crypto.randomUUID());
      return { id: work.id };
    });
    // 种库仅建立夹具；重启后从真实界面操作、IPC 导出并解析真实文件。
    await closeNormally(application); application = await launch(directory); page = await offlineWindow(application);
    await activate(page.getByRole('button', { name: '打开作品：test α净稿导出', exact: true }));
    const actions = page.locator('details.work-more');
    const openActions = async () => { if (!await actions.evaluate(node => node.open)) await activate(actions.locator('summary')); };
    await openActions(); await activate(page.getByRole('button', { name: '版本历史', exact: true }));
    await page.getByRole('textbox', { name: '快照名称', exact: true }).fill('test 历史净稿');
    await activate(page.getByRole('button', { name: '创建快照', exact: true }));
    await expect(page.getByRole('button', { name: '预览并恢复：test 历史净稿', exact: true })).toBeVisible();
    await activate(page.getByRole('button', { name: '关闭版本历史', exact: true }));
    await page.getByRole('textbox', { name: '章节正文', exact: true }).press('Control+End');
    await page.getByRole('textbox', { name: '章节正文', exact: true }).pressSequentially('test 当前新增正文。');
    const exported = async (label, format, historical, full = false) => {
      const filename = test.info().outputPath(`${label}.${format.toLowerCase()}`);
      await application.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, filename);
      if (!historical) await openActions();
      const name = historical ? `导出快照 ${format}：test 历史净稿` : `导出正文净稿 ${format}`;
      await activate(page.getByRole('button', { name, exact: true }));
      await expect.poll(async () => (await readFile(filename).catch(() => Buffer.alloc(0))).length).toBeGreaterThan(50);
      const text = await exportedText(filename, format);
      expect(text).toContain('test 历史正文：雨停了。'); expect(text).toContain('test 历史章节');
      if (historical) expect(text).not.toContain('test 当前新增正文。');
      else expect(text).toContain('test 当前新增正文。');
      for (const marker of ['引用清单', '伏笔清单', 'test 仅属于创作资料的知识原句', '[伏笔：']) {
        if (full) expect(text).toContain(marker); else expect(text).not.toContain(marker);
      }
    };
    for (const format of ['TXT', 'DOCX']) await exported('test-current-clean', format, false);
    const saved = await page.evaluate(async id => ({ work: await window.rainSoul.openWork(id), snapshots: await window.rainSoul.listSnapshots(id) }), seed.id);
    expect(JSON.stringify(saved.work.chapters)).toContain('test 当前新增正文。');
    await openActions(); await activate(page.getByRole('button', { name: '版本历史', exact: true }));
    await page.getByRole('radio', { name: '正文净稿', exact: true }).check();
    await page.screenshot({ path: test.info().outputPath('test-historical-clean-export.png'), fullPage: true });
    for (const format of ['TXT', 'DOCX']) await exported('test-historical-clean', format, true);
    await page.getByRole('radio', { name: '含创作资料', exact: true }).check();
    for (const format of ['TXT', 'DOCX']) await exported('test-historical-full', format, true, true);
    expect(await page.evaluate(async id => ({ work: await window.rainSoul.openWork(id), snapshots: await window.rainSoul.listSnapshots(id) }), seed.id)).toEqual(saved);
  } finally { await cleanup(application, directory); }
});
