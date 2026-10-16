const { test, expect } = require('@playwright/test');
const { temporaryDirectory, launch, offlineWindow, cleanup, createWork, activate } = require('./structure-helper.cjs');

test('真实窗口灰字不落盘，Tab接受可撤销，AI打开时暂停', async () => {
  const directory = await temporaryDirectory(); let application, page;
  try {
    application = await launch(directory); page = await offlineWindow(application);
    await createWork(page, '灰字参考验收');
    await activate(page.getByRole('button', { name: '展开侧栏', exact: true }));
    await activate(page.getByRole('button', { name: '知识库', exact: true }));
    await activate(page.getByRole('button', { name: /^作品知识库/ }));
    await activate(page.getByRole('button', { name: '新增知识', exact: true }));
    await page.getByLabel('知识内容', { exact: true }).fill('雨夜里，灯光像一枚孤独的星。');
    await page.getByLabel('出处', { exact: true }).fill('原创练习');
    await activate(page.getByRole('button', { name: '保存知识', exact: true }));
    await expect(page.getByLabel('知识内容', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('article', { name: '知识：雨夜里，灯光像一枚孤独的星。', exact: true })).toBeVisible();
    await activate(page.getByRole('button', { name: '作品集', exact: true }));
    await activate(page.getByRole('button', { name: '打开作品：灰字参考验收', exact: true }));
    const editor = page.getByRole('textbox', { name: '章节正文' });
    await editor.evaluate(element => {
      window.__ghostEvents = [];
      const record = event => {
        const instance = element.editor, selection = instance?.state.selection;
        const plugin = instance?.state.plugins.find(item => item.key.startsWith('knowledgeGhost$'));
        window.__ghostEvents.push({ time: performance.now(), type: event.type, key: event.key,
          focused: element.ownerDocument.activeElement === element, documentFocused: document.hasFocus(),
          from: selection?.from, to: selection?.to, candidate: !!plugin?.getState(instance.state),
          text: instance?.getText() });
        if (window.__ghostEvents.length > 200) window.__ghostEvents.shift();
      };
      for (const type of ['keydown', 'keyup', 'focus', 'blur', 'selectionchange']) document.addEventListener(type, record, true);
      new MutationObserver(() => record({ type: 'editor-mutation' })).observe(element, { subtree: true, childList: true, characterData: true });
    });
    await editor.fill('雨夜'); await editor.press('End');
    const ghost = page.locator('[data-knowledge-ghost]');
    await expect(ghost).toContainText('里，灯光像一枚孤独的星。');
    await expect(ghost).toContainText('原创练习');
    await expect(page.getByText('本章 2 字', { exact: true })).toBeVisible();
    await expect(page.getByText('已保存', { exact: true })).toBeVisible();
    const savedText = await page.evaluate(async () => {
      const work = (await window.rainSoul.listWorks()).find(item => item.title === '灰字参考验收');
      return (await window.rainSoul.openWork(work.id)).chapters[0].document.content[0].content[0].text;
    }); expect(savedText).toBe('雨夜');
    // 自动保存回执刷新作品资产并使旧候选失效；接受前必须确认当前候选已经重新生成。
    await expect(editor).toBeFocused(); await expect(ghost).toContainText('里，灯光像一枚孤独的星。');
    await page.screenshot({ path: test.info().outputPath('knowledge-ghost.png') });
    await expect(editor).toBeFocused(); await expect(ghost).toContainText('里，灯光像一枚孤独的星。');
    await editor.press('Tab'); await expect(ghost).toHaveCount(0);
    await expect(editor).toHaveText('雨夜里，灯光像一枚孤独的星。');
    await editor.press('Control+z'); await expect(editor).toContainText('雨夜');
    await expect(ghost).toHaveCount(1); await editor.press('Escape'); await expect(ghost).toHaveCount(0);
    await activate(page.getByRole('button', { name: 'AI 工具', exact: true }));
    await expect(ghost).toHaveCount(0);
    await activate(page.getByRole('button', { name: '关闭AI工具', exact: true }));
    await expect(page.getByRole('dialog', { name: 'AI工具', exact: true })).not.toBeVisible();
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await editor.focus(); await expect(editor).toBeFocused();
    // 关闭工具需等待保存及焦点恢复，再用真实按键解除 Esc 对当前位置的抑制。
    const caretOffset = () => editor.evaluate(element => {
      const instance = element.editor, selection = element.ownerDocument.getSelection();
      if (!instance || element.ownerDocument.activeElement !== element || !selection?.isCollapsed || !selection.anchorNode || !element.contains(selection.anchorNode)) return null;
      const domPosition = instance.view.posAtDOM(selection.anchorNode, selection.anchorOffset), current = instance.state.selection;
      return current.empty && domPosition === current.from ? current.$from.parentOffset : null;
    });
    await editor.press('ArrowLeft'); await expect.poll(caretOffset).toBe(1);
    await editor.press('ArrowRight'); await expect.poll(caretOffset).toBe(2);
    await expect(ghost).toHaveCount(1);
  } finally {
    try {
      if (page && !page.isClosed()) await test.info().attach('灰字事件诊断', {
        body: JSON.stringify(await page.evaluate(() => window.__ghostEvents ?? []), null, 2), contentType: 'application/json',
      });
    } finally { await cleanup(application, directory); }
  }
});
