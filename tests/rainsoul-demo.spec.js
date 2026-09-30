const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const demoUrl = pathToFileURL(path.resolve(__dirname, '../docs/demos/rainsoul-writing-style.html')).href;

test.beforeEach(async ({ page }) => {
  await page.goto(demoUrl);
});

test('页面切换时只显示当前页操作，保存失败不能切页绕过', async ({ page }) => {
  await page.locator('[data-demo="knowledge"]').click();
  await expect(page.locator('#new-work')).toBeHidden();
  await expect(page.locator('#save-status')).toBeHidden();

  await page.locator('[data-demo="error"]').click();
  await page.locator('[data-demo="knowledge"]').click();
  await expect(page.locator('#editor-view')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('保存失败');

  await page.locator('#retry-save').click();
  await expect(page.locator('#save-status')).toHaveText('已保存', { timeout: 2000 });
  await page.locator('[data-demo="knowledge"]').click();
  await expect(page.locator('#knowledge-view')).toBeVisible();
});

test('切换章节会保留自动保存间隔内的正文草稿', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('#editor').fill('切换章节前的正文草稿');
  await page.locator('#chapter-title').fill('临时章节标题');
  await page.locator('.tree-item[data-chapter="第二章 旧信"]').click();
  await page.locator('.tree-item[data-chapter="第一章 潮汐"]').click();
  await expect(page.locator('#editor')).toContainText('切换章节前的正文草稿');
  await expect(page.locator('#chapter-title')).toHaveValue('临时章节标题');
});

test('章节草稿回放会清洗危险 HTML', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('#editor').evaluate((element) => {
    element.innerHTML = '<p>安全内容</p><img data-onerror="window.__xss = true"><script type="text/plain">window.__xss = true</script>';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.tree-item[data-chapter="第二章 旧信"]').click();
  await page.locator('.tree-item[data-chapter="第一章 潮汐"]').click();
  await expect(page.locator('#editor img')).toHaveCount(0);
  await expect(page.locator('#editor script')).toHaveCount(0);
  await expect(page.locator('#editor')).toContainText('安全内容');
});

test('保存失败不会被旧定时器覆盖，并会拦截关闭或刷新', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('#editor').fill('一段等待自动保存的内容');
  await page.locator('[data-demo="error"]').click();
  await page.waitForTimeout(800);
  await expect(page.locator('#save-status')).toHaveText('保存失败');

  const unload = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    const allowed = window.dispatchEvent(event);
    return { allowed, prevented: event.defaultPrevented };
  });
  expect(unload.prevented || !unload.allowed).toBe(true);
});

test('自动保存未完成时会拦截关闭', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('#editor').fill('尚未完成自动保存的正文');
  const unload = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    const allowed = window.dispatchEvent(event);
    return { allowed, prevented: event.defaultPrevented };
  });
  expect(unload.prevented || !unload.allowed).toBe(true);
});

test('离开写作页前会保存导航中的当前草稿', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('#editor').fill('导航前应保存的正文');
  await page.locator('[data-demo="knowledge"]').click();
  await page.locator('[data-demo="shelf"]').click();
  await page.locator('.book[data-work="雾港来信"]').click();
  await expect(page.locator('#editor')).toContainText('导航前应保存的正文');
});

test('保存失败期间继续编辑，重试后保留最新正文', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('[data-demo="error"]').click();
  await page.locator('#editor').fill('保存失败期间的新正文');
  await page.locator('#chapter-title').fill('保存失败标题');
  await page.locator('#retry-save').click();
  await expect(page.locator('#save-status')).toHaveText('已保存', { timeout: 2000 });
  await page.locator('#back-shelf').click();
  await page.locator('.book[data-work="雾港来信"]').click();
  await expect(page.locator('#editor')).toContainText('保存失败期间的新正文');
  await expect(page.locator('#chapter-title')).toHaveValue('保存失败标题');
});

test('新的失败状态会取消旧的重试回调', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('[data-demo="error"]').click();
  await page.locator('#retry-save').click();
  await page.locator('[data-demo="error"]').click();
  await page.waitForTimeout(800);
  await page.locator('[data-demo="knowledge"]').click();
  await expect(page.locator('#editor-view')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('保存失败');
});

test('重试保存期间的新输入会重新排队保存', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('[data-demo="error"]').click();
  await page.locator('#retry-save').click();
  await page.locator('#editor').fill('重试期间的新正文');
  await page.waitForTimeout(800);
  await expect(page.locator('#save-status')).toHaveText('未保存');
  await expect(page.locator('#editor')).toContainText('重试期间的新正文');
  await page.waitForTimeout(600);
  await expect(page.locator('#save-status')).toHaveText('已保存');
});

test('作品结构和非当前章节草稿按作品隔离', async ({ page }) => {
  await page.locator('.book[data-work="长夜列车"]').click();
  await page.locator('.tree-item[data-volume="volume-1"]').click({ button: 'right' });
  await page.locator('#context-delete').click();
  await page.locator('#confirm-delete').click();
  await page.locator('[data-demo="shelf"]').click();
  await page.locator('.book[data-work="雾港来信"]').click();
  await expect(page.locator('.tree-item[data-volume="volume-1"]')).toHaveCount(1);
  await page.locator('.tree-item[data-chapter="第三章 灯塔"]').click();
  await page.locator('#editor').fill('当前章节草稿应保留');
  await page.locator('.tree-item[data-chapter="第二章 旧信"]').click({ button: 'right' });
  await page.locator('#context-delete').click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#editor')).toContainText('当前章节草稿应保留');
});

test('知识卡片支持多标签 AND 筛选与单字段正文', async ({ page }) => {
  await page.locator('[data-demo="knowledge"]').click();
  await page.locator('#knowledge-view .tag-row [data-tag="景物"]').click();
  await page.locator('#knowledge-view .tag-row [data-tag="伏笔"]').click();

  const visibleEntries = page.locator('.knowledge-entry:not([hidden])');
  await expect(visibleEntries).toHaveCount(1);
  await expect(visibleEntries.first()).toContainText('旧港北侧的灯塔');
  const lineClamp = await visibleEntries.first().locator('.entry-summary').evaluate((element) => getComputedStyle(element).webkitLineClamp);
  expect(lineClamp).toBe('2');
  await expect(visibleEntries.first().locator('.entry-summary')).toHaveCount(1);
  await expect(visibleEntries.first().locator('.entry-full')).toHaveCount(0);
});

test('模糊搜索匹配正文和出处', async ({ page }) => {
  await page.locator('[data-demo="knowledge"]').click();
  const search = page.locator('#knowledge-search');
  await search.fill('潮汐表');
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(1);
  await search.fill('经典引用 · 手工录入');
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(1);
});

test('知识库按当前作品隔离并支持全部作品汇总', async ({ page }) => {
  await page.locator('[data-demo="knowledge"]').click();
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(6);
  await page.locator('#knowledge-scope').selectOption({ value: 'all' });
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(8);

  await page.locator('[data-demo="shelf"]').click();
  await page.locator('.book[data-work="长夜列车"]').click();
  await page.locator('[data-demo="knowledge"]').click();
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(2);
  await expect(page.locator('.knowledge-entry:not([hidden])').first()).toContainText('长夜列车');
  await page.locator('#knowledge-scope').selectOption('all');
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(8);

  await page.locator('#new-entry').click();
  await page.locator('#knowledge-body-input').fill('只属于长夜列车的测试知识');
  await page.locator('#knowledge-source-input').fill('第三章');
  await page.locator('#knowledge-create').click();
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(9);
  await expect(page.locator('.knowledge-entry').first()).toHaveAttribute('data-owner-work', '长夜列车');
  await page.locator('#knowledge-scope').selectOption('current');
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(3);
});

test('可以在设置维护动态分类和标签，并立即用于筛选', async ({ page }) => {
  await page.locator('[data-demo="settings"]').click();
  await page.locator('#new-category').fill('叙事节奏');
  await page.locator('#add-category').click();
  await page.locator('[data-demo="knowledge"]').click();
  await page.getByRole('button', { name: /叙事节奏/ }).click();
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(0);
  await page.locator('[data-demo="settings"]').click();
  await page.getByRole('button', { name: '删除叙事节奏' }).click();
  await page.getByRole('button', { name: '删除人物描写' }).click();
  await expect(page.locator('#migration-dialog')).toBeVisible();
  await expect(page.locator('#migration-message')).toContainText('2 条');
  await page.locator('#migration-target').selectOption('mind');
  await page.locator('#migration-confirm').click();
  await expect(page.locator('#migration-dialog')).toBeHidden();
  await expect(page.locator('.knowledge-entry[data-category="mind"]')).toHaveCount(3);
  await expect(page.locator('#category-maintenance-list')).not.toContainText('人物描写');

  await page.locator('#new-maintenance-tag').fill('意象[雨]');
  await page.locator('#add-maintenance-tag').click();
  await page.locator('[data-demo="knowledge"]').click();
  await page.locator('#knowledge-view .tag-row [data-tag="意象[雨]"]').click();
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(0);
  await page.locator('[data-demo="settings"]').click();
  await page.getByRole('button', { name: '删除意象[雨]' }).click();
  await page.locator('[data-demo="knowledge"]').click();
  await expect(page.locator('#knowledge-view .tag-row [data-tag="意象[雨]"]')).toHaveCount(0);

  await page.locator('[data-demo="settings"]').click();
  await page.getByRole('button', { name: '删除人物' }).click();
  await expect(page.locator('#confirm-title')).toHaveText('删除标签');
  await expect(page.locator('#confirm-message')).toContainText('2 条');
  await page.locator('#confirm-delete').click();
  expect(await page.locator('.knowledge-entry').evaluateAll((entries) => entries.every((entry) => !JSON.parse(entry.dataset.tags).includes('人物')))).toBe(true);
  await expect(page.locator('.entry-tag').filter({ hasText: /^人物$/ })).toHaveCount(0);
});

test('新增知识后显示单一正文域和出处', async ({ page }) => {
  await page.locator('[data-demo="knowledge"]').click();
  await page.locator('#new-entry').click();
  await page.locator('#knowledge-body-input').fill('人物在听见旧站广播时，先停下脚步，再把信纸折回原来的痕迹。');
  await page.locator('#knowledge-category-input').selectOption('character');
  await page.locator('#knowledge-tags-input').fill('人物,动作');
  await page.locator('#knowledge-source-input').fill('雾港来信 · 第五章');
  await page.locator('#knowledge-create').click();
  await expect(page.locator('#toast')).toContainText('尚未在设置中创建');
  await expect(page.locator('#knowledge-dialog')).toBeVisible();
  await page.locator('#knowledge-cancel').click();
  await page.locator('[data-demo="settings"]').click();
  await page.locator('#new-maintenance-tag').fill('动作');
  await page.locator('#add-maintenance-tag').click();
  await page.locator('[data-demo="knowledge"]').click();
  await page.locator('#new-entry').click();
  await page.locator('#knowledge-body-input').fill('人物在听见旧站广播时，先停下脚步，再把信纸折回原来的痕迹。');
  await page.locator('#knowledge-category-input').selectOption('character');
  await page.locator('#knowledge-tags-input').fill('人物,动作');
  await page.locator('#knowledge-source-input').fill('雾港来信 · 第五章');
  await page.locator('#knowledge-create').click();

  const entry = page.locator('.knowledge-entry').filter({ hasText: '先停下脚步' });
  await expect(entry).toBeVisible();
  await expect(entry.locator('.entry-summary')).toHaveText('人物在听见旧站广播时，先停下脚步，再把信纸折回原来的痕迹。');
  await expect(entry.locator('.entry-full')).toHaveCount(0);
  await expect(entry.locator('.entry-source')).toHaveText('雾港来信 · 第五章');
});

test('拆书预览默认隐藏，确认导入后加入当前作品知识库', async ({ page }) => {
  await page.locator('[data-demo="knowledge"]').click();
  const beforeCount = await page.locator('#knowledge-list .knowledge-entry').count();
  await page.locator('#open-splitter').click();
  await expect(page.locator('#splitter-view')).toContainText('图片、表格');
  await expect(page.locator('#splitter-preview-list')).toBeHidden();
  await expect(page.locator('#splitter-confirm')).toBeDisabled();

  await page.locator('#splitter-file').setInputFiles({
    name: '雨夜手稿.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('第一章 雨夜\n她走进旧站。', 'utf8'),
  });
  await page.locator('#splitter-preview').click();
  await expect(page.locator('#splitter-preview-list')).toBeVisible();
  await page.locator('#splitter-confirm').click();
  await expect(page.locator('#knowledge-view')).toBeVisible();
  await expect(page.locator('#knowledge-list .knowledge-entry')).toHaveCount(beforeCount + 2);
  await expect(page.locator('#knowledge-list .knowledge-entry[data-owner-work="雾港来信"]')).toHaveCount(6 + 2);
  await expect(page.locator('#knowledge-list .knowledge-entry').first().locator('.entry-source')).toContainText('演示样例');
  await expect(page.locator('#knowledge-list .knowledge-entry').first().locator('.entry-source')).not.toContainText('雨夜手稿');
  await expect(page.locator('#work-total')).toHaveText('3');
});

test('拆书工具拒绝非 TXT 和 DOCX 文件', async ({ page }) => {
  await page.locator('[data-demo="knowledge"]').click();
  await page.locator('#open-splitter').click();
  await page.locator('#splitter-file').setInputFiles({
    name: '不支持.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7', 'ascii'),
  });
  await page.locator('#splitter-preview').click();
  await expect(page.locator('#splitter-preview-list')).toBeHidden();
  await expect(page.locator('#splitter-confirm')).toBeDisabled();
  await expect(page.locator('#toast')).toContainText('仅支持 TXT 或 DOCX');
});

test('重复导入同一手稿会追加知识条目而不新建作品', async ({ page }) => {
  await page.locator('[data-demo="knowledge"]').click();
  const beforeCount = await page.locator('#knowledge-list .knowledge-entry').count();
  for (let index = 0; index < 2; index += 1) {
    await page.locator('#open-splitter').click();
    await page.locator('#splitter-file').setInputFiles({
      name: '重复手稿.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('第一章 正文', 'utf8'),
    });
    await page.locator('#splitter-preview').click();
    await page.locator('#splitter-confirm').click();
    await expect(page.locator('#knowledge-view')).toBeVisible();
  }
  await expect(page.locator('#knowledge-list .knowledge-entry')).toHaveCount(beforeCount + 4);
  await expect(page.locator('#work-total')).toHaveText('3');
});

test('会话支持新建、删除确认和空状态', async ({ page }) => {
  await page.locator('[data-demo="conversation"]').click();
  const currentGroup = page.locator('#session-list [data-session-group][data-work="雾港来信"]');
  const initialCount = await currentGroup.locator('.session').count();
  await page.locator('#new-session').click();
  await expect(currentGroup.locator('.session')).toHaveCount(initialCount + 1);
  await page.locator('#message-input').fill('新的会话消息');
  await page.locator('#conversation-form button[type="submit"]').click();
  await expect(page.locator('#message-list')).toContainText('新的会话消息');
  await currentGroup.locator('.session-delete').last().click();
  await expect(page.locator('#confirm-title')).toHaveText('删除会话');
  await page.locator('#confirm-cancel').click();
  await expect(currentGroup.locator('.session')).toHaveCount(initialCount + 1);

  while (await currentGroup.locator('.session-delete').count()) {
    await currentGroup.locator('.session-delete').last().click();
    await expect(page.locator('#confirm-title')).toHaveText('删除会话');
    await page.locator('#confirm-delete').click();
  }
  await expect(currentGroup.locator('.session-empty')).toBeVisible();
});

test('需求会话按作品分组，并在切换作品后保留当前作品上下文', async ({ page }) => {
  await page.locator('[data-demo="conversation"]').click();

  const sessionGroups = page.locator('#session-list [data-session-group]');
  await expect(sessionGroups.filter({ has: page.getByText('雾港来信', { exact: true }) })).toBeVisible();
  await expect(sessionGroups.filter({ has: page.getByText('长夜列车', { exact: true }) })).toBeVisible();
  await expect(sessionGroups.filter({ has: page.getByText('学习路径', { exact: true }) })).toBeVisible();
  await expect(sessionGroups).toHaveCount(3);
  for (const group of await sessionGroups.all()) {
    await expect(group).toHaveAttribute('data-work', /.+/);
    await expect(group.locator('.session')).not.toHaveCount(0);
  }

  await page.locator('[data-demo="shelf"]').click();
  await page.locator('.book[data-work="长夜列车"]').click();
  await page.locator('[data-demo="conversation"]').click();
  await expect(page.locator('#conversation-project')).toHaveText('长夜列车');
  await expect(page.locator('#session-list .session.active')).toHaveAttribute('data-owner-work', '长夜列车');
});

test('空会话作品不显示其他作品消息，离开后仍保持选中', async ({ page }) => {
  await page.locator('[data-demo="conversation"]').click();
  const group = page.locator('.session-group[data-work="学习路径"]');
  await group.locator('.session-work-open').click();
  await group.locator('.session-delete').click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#conversation-project')).toHaveText('学习路径');
  await expect(page.locator('#conversation-empty')).toBeVisible();
  await expect(page.locator('.session.active')).toHaveCount(0);
  await page.locator('[data-demo="settings"]').click();
  await page.locator('[data-demo="conversation"]').click();
  await expect(page.locator('#conversation-project')).toHaveText('学习路径');
  await expect(page.locator('#conversation-empty')).toBeVisible();
});

test('知识库使用范围下拉框，卡片只保留单一正文域', async ({ page }) => {
  await page.locator('[data-demo="knowledge"]').click();

  const scope = page.locator('#knowledge-scope');
  await expect(scope).toHaveValue('current');
  await expect(scope.locator('option[value="current"]')).toHaveText(/当前作品/);
  await expect(scope.locator('option[value="all"]')).toHaveText(/全部作品/);
  const optionLabels = await scope.locator('option').allTextContents();
  expect(optionLabels.join(' ')).toContain('雾港来信');
  expect(optionLabels.join(' ')).toContain('长夜列车');
  expect(optionLabels.join(' ')).toContain('学习路径');

  const currentEntries = page.locator('.knowledge-entry:not([hidden])');
  await expect(currentEntries).toHaveCount(6);
  for (const entry of await currentEntries.all()) {
    await expect(entry.locator('.entry-summary')).toHaveCount(1);
    await expect(entry.locator('.entry-full')).toHaveCount(0);
  }

  await scope.selectOption('all');
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(8);
  const longNightValue = await scope.locator('option').evaluateAll((options) => {
    const option = options.find((item) => item.textContent.includes('长夜列车'));
    return option?.value;
  });
  expect(longNightValue).toBeTruthy();
  await scope.selectOption(longNightValue);
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(2);
  expect(await page.locator('.knowledge-entry:not([hidden])').evaluateAll((entries) => entries.every((entry) => entry.dataset.ownerWork === '长夜列车'))).toBe(true);
});

test('知识范围作品名不会与全部作品保留值冲突', async ({ page }) => {
  await page.locator('#new-work').click();
  await page.locator('#work-name').fill('all');
  await page.locator('#dialog-confirm').click();
  await page.locator('[data-demo="shelf"]').click();
  await page.locator('.book[data-work="长夜列车"]').click();
  await page.locator('[data-demo="knowledge"]').click();
  await page.locator('#knowledge-scope').selectOption('work:all');
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(0);
  await page.locator('#knowledge-scope').selectOption({ value: 'all' });
  await expect(page.locator('#knowledge-scope')).toHaveValue('all');
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(8);
});

test('知识分类侧栏可收起并重新展开', async ({ page }) => {
  await page.locator('[data-demo="knowledge"]').click();
  await page.locator('#category-collapse-toggle').click();
  await expect(page.locator('#knowledge-layout')).toHaveClass(/is-collapsed/);
  await expect(page.locator('#category-expand-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#category-expand-toggle').click();
  await expect(page.locator('#knowledge-layout')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('#category-collapse-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('正文编辑器获得焦点时不显示蓝色焦点框', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  const editor = page.locator('#editor');
  await editor.focus();
  const focusStyle = await editor.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor };
  });
  expect(focusStyle.outlineStyle).toBe('none');
  expect(focusStyle.outlineWidth).toBe('0px');
});

test('作品结构右键删除确认标题与目标准确', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('.tree-item[data-volume="volume-1"]').click({ button: 'right' });
  await page.locator('#context-delete').click();
  await expect(page.locator('#confirm-title')).toHaveText('删除卷及章节');
  await expect(page.locator('#confirm-message')).toContainText('第一卷');
  await page.locator('#confirm-delete').click();
  await page.locator('#tree-add').click();
  const parent = await page.locator('.tree-item.chapter').last().getAttribute('data-parent');
  await expect(page.locator(`.tree-item.volume[data-volume="${parent}"]`)).toHaveCount(1);
  await page.locator('.tree-item.volume[data-volume="unassigned"]').click({ button: 'right' });
  await page.locator('#context-delete').click();
  await page.locator('#confirm-delete').click();
  await page.locator('#tree-add').click();
  await expect(page.locator('.tree-item.volume[data-volume="unassigned"]')).toHaveCount(1);
  await expect(page.locator('.tree-item.chapter').last()).toHaveAttribute('data-parent', 'unassigned');
});

test('作品集中的作品卡支持右键删除', async ({ page }) => {
  const book = page.locator('.book[data-work="学习路径"]');
  await book.click({ button: 'right' });
  await page.locator('#context-delete').click();
  await expect(page.locator('#confirm-title')).toHaveText('删除作品');
  await expect(page.locator('#confirm-message')).toContainText('学习路径');
  await page.locator('#confirm-delete').click();
  await expect(page.locator('.book[data-work="学习路径"]')).toHaveCount(0);
  await expect(page.locator('#work-total')).toHaveText('2');
});

test('删除当前作品后清理知识和会话并切换到剩余作品', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('#back-shelf').click();
  await page.locator('.book[data-work="雾港来信"]').click({ button: 'right' });
  await page.locator('#context-delete').click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#work-total')).toHaveText('2');
  await expect(page.locator('.knowledge-entry[data-owner-work="雾港来信"]')).toHaveCount(0);
  await expect(page.locator('.session-group[data-work="雾港来信"]')).toHaveCount(0);
  await page.locator('[data-demo="knowledge"]').click();
  await expect(page.locator('#knowledge-scope option[value="current"]')).toHaveText('当前作品 · 长夜列车');
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(2);
});

test('作品结构右键菜单支持键盘打开、关闭与弹窗焦点循环', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  const volume = page.locator('.tree-item[data-volume="volume-1"]');
  await volume.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('#context-menu')).toBeVisible();
  await expect(page.locator('#context-delete')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#context-menu')).toBeHidden();
  await expect(volume).toBeFocused();

  await page.keyboard.press('ContextMenu');
  await page.keyboard.press('Enter');
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await expect(page.locator('#confirm-cancel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#confirm-delete')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#confirm-cancel')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-dialog')).toBeHidden();
  await expect(volume).toBeFocused();
});

test('折叠当前卷时新建章节仍归入当前卷', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('.tree-item[data-chapter="第二章 旧信"]').click();
  await page.locator('.tree-item[data-volume="volume-1"]').click();
  await page.locator('#tree-add').click();
  await expect(page.locator('.tree-item.chapter').last()).toHaveAttribute('data-parent', 'volume-1');
});

test('删除卷内章节会更新卷计数', async ({ page }) => {
  await page.locator('.book[data-work="雾港来信"]').click();
  await page.locator('.tree-item[data-chapter="第二章 旧信"]').click({ button: 'right' });
  await page.locator('#context-delete').click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('.tree-item[data-volume="volume-1"] .count')).toHaveText('1 章');
});

test('窄屏知识库和会话页面没有文档级横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(720);
  await page.locator('#sidebar-toggle').click();
  const railPosition = await page.locator('.rail').evaluate((element) => getComputedStyle(element).position);
  expect(railPosition).toBe('absolute');
  const mainWidth = await page.locator('.main').evaluate((element) => element.getBoundingClientRect().width);
  expect(mainWidth).toBeGreaterThan(200);
  await page.locator('#sidebar-toggle').click();
  await page.locator('[data-demo="knowledge"]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.locator('#knowledge-search').fill('不存在的知识');
  await expect(page.locator('#knowledge-empty')).toBeVisible();
  await page.locator('[data-demo="conversation"]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.locator('[data-demo="settings"]').click();
  const pathFits = await page.locator('#data-path').evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(pathFits).toBe(true);
  await page.locator('[data-demo="knowledge"]').click();
  await page.locator('#open-splitter').click();
  await expect(page.locator('#back-knowledge')).toHaveCSS('white-space', 'nowrap');
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(720);
});

test('窄屏首屏保留知识搜索和会话输入', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.locator('[data-demo="knowledge"]').click();
  await expect(page.locator('#knowledge-layout')).toHaveClass(/is-collapsed/);
  const search = await page.locator('#knowledge-search').boundingBox();
  expect(search.y + search.height).toBeLessThan(700);
  await page.locator('[data-demo="conversation"]').click();
  const composer = await page.locator('#conversation-form').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(700);
  await page.locator('#sidebar-toggle').click();
  await page.locator('#sidebar-scrim').click({ position: { x: 300, y: 400 } });
  await expect(page.locator('#app')).toHaveClass(/is-collapsed/);
});

test('较短窄屏的会话输入仍在首屏内', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('[data-nav="conversation"]').click();
  const composer = await page.locator('#conversation-form').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(568);
  const messages = await page.locator('#message-list').boundingBox();
  expect(messages.height).toBeGreaterThanOrEqual(100);
});

test('窄屏知识卡的长出处不会被裁切', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.locator('[data-demo="knowledge"]').click();
  await page.locator('#new-entry').click();
  await page.locator('#knowledge-body-input').fill('用一段正文记录写作技法。');
  const source = '很长的出处名称'.repeat(35);
  await page.locator('#knowledge-source-input').fill(source);
  await page.locator('#knowledge-create').click();

  const entry = page.locator('.knowledge-entry').first();
  const cardBox = await entry.boundingBox();
  const sourceBox = await entry.locator('.entry-source').boundingBox();
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(320);
  expect(sourceBox.x + sourceBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('新作品从自己的空白第一章开始，清空正文后不会回填示例', async ({ page }) => {
  await page.locator('#new-work').click();
  await page.locator('#work-name').fill('新故事');
  await page.locator('#dialog-confirm').click();

  await expect(page.locator('#chapter-tree [data-chapter]')).toHaveCount(1);
  await expect(page.locator('#chapter-title')).toHaveValue('第一章 新章节');
  await expect(page.locator('#editor')).toBeEmpty();
  await expect(page.locator('#chapter-count')).toHaveText('本章 0 字');
  await page.locator('#editor').fill('一段后来删掉的正文');
  await page.locator('#editor').fill('');
  await page.locator('#back-shelf').click();
  await expect(page.locator('.book[data-work="新故事"] .book-bottom')).toContainText('1 章 · 0 字');
  await page.locator('.book[data-work="新故事"]').click();
  await expect(page.locator('#editor')).toBeEmpty();
});

test('含空格标签可筛选并从关联知识中移除', async ({ page }) => {
  await page.locator('[data-demo="settings"]').click();
  await page.locator('#new-maintenance-tag').fill('人物 动作');
  await page.locator('#add-maintenance-tag').click();
  await page.locator('[data-demo="knowledge"]').click();
  await page.locator('#new-entry').click();
  await page.locator('#knowledge-body-input').fill('她扶住门框，等风从走廊尽头过去。');
  await page.locator('#knowledge-tags-input').fill('人物 动作');
  await page.locator('#knowledge-create').click();
  await page.locator('#knowledge-view .tag-row [data-tag="人物 动作"]').click();
  await expect(page.locator('.knowledge-entry:not([hidden])')).toHaveCount(1);
  await page.locator('[data-demo="settings"]').click();
  await page.getByRole('button', { name: '删除人物 动作' }).click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('.entry-tag').filter({ hasText: /^人物 动作$/ })).toHaveCount(0);
});
