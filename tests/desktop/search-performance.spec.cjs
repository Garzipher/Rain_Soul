const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { seedSearchProject, expectedResults, queries } = require('../fixtures/search-performance.cjs');
const { activate, temporaryDirectory, launch, offlineWindow, closeNormally, cleanup, createWork } = require('./structure-helper.cjs');

// 总预算包含种库、400次准备/正式输入和200次真实渲染；单次P95门槛仍为1秒。
test.setTimeout(900000);
const runFile = promisify(execFile);
async function machineEnvironment() {
  const environment = { platform: os.platform(), release: os.release(), osVersion: os.version(), cpuModel: os.cpus()[0]?.model,
    logicalCpuCount: os.cpus().length, totalMemoryBytes: os.totalmem(), freeMemoryBytesAtStart: os.freemem(),
    testStoragePath: os.tmpdir(), note: '真实执行机器；此结果不冒充另行约定的四核验收机器。' };
  if (process.platform === 'win32') {
    try {
      const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-Command',
        '$ErrorActionPreference="Stop"; $cpu=Get-CimInstance Win32_Processor; $disks=Get-PhysicalDisk; $letter=[IO.Path]::GetPathRoot([IO.Path]::GetTempPath()).TrimEnd("\\",":"); $testDisk=Get-Partition -DriveLetter $letter|Get-Disk; [pscustomobject]@{cpu=@($cpu|Select-Object Name,NumberOfCores,NumberOfLogicalProcessors);disks=@($disks|Select-Object FriendlyName,MediaType,BusType,Size);testVolume=@($testDisk|Select-Object Number,FriendlyName,BusType,Size)}|ConvertTo-Json -Depth 5 -Compress'],
      { windowsHide: true, timeout: 20000 });
      environment.windowsHardware = JSON.parse(stdout);
    } catch (reason) { environment.diskInspection = `无法确认存储介质：${reason.message}`; }
  }
  return environment;
}

/** input 事件开始；真实搜索状态结束且正确结果已渲染后跨两帧完成。没有替换 IPC 或查询实现。 */
async function measureInput(page, text, expected, mode) {
  const sortedExpected = { ...expected, knowledge: (mode === 'knowledge' ? expected.knowledge.slice(0, 20) : [...expected.knowledge]).sort((left, right) => left.source.localeCompare(right.source)) };
  await page.evaluate(({ expected, total }) => {
    const input = document.querySelector('input[aria-label="模糊搜索知识与正文"]');
    const workspace = document.querySelector('.knowledge-workspace');
    window.__searchMeasurement = new Promise((resolve, reject) => {
      let start, sawSearching = false, sawMutation = false, finishing = false, finished = false, timer;
      const rendered = () => ({
        knowledge: [...workspace.querySelectorAll('.knowledge-entry')].map(card => ({ body: card.querySelector('.knowledge-snippet').textContent,
          source: card.querySelector('.knowledge-source span:last-of-type').textContent })).sort((left, right) => left.source.localeCompare(right.source)),
        paragraphs: [...workspace.querySelectorAll('.knowledge-paragraph-result')].map(card => ({ title: card.querySelector('button').textContent, snippet: card.querySelector('p').textContent })),
      });
      const searching = () => [...workspace.querySelectorAll('[role="status"]')].some(node => node.textContent === '正在搜索本机内容…');
      const isComplete = () => start !== undefined && sawMutation && !searching() && JSON.stringify(rendered()) === JSON.stringify(expected)
        && (total === null || workspace.querySelector('.knowledge-pagination span')?.textContent === `第 1 页 · 共 ${total} 条`);
      const observer = new MutationObserver(records => {
        if (start === undefined || finished) return;
        sawMutation = true;
        sawSearching ||= searching() || records.some(record => [...record.addedNodes].some(node => node.textContent === '正在搜索本机内容…'));
        if (!isComplete() || finishing) return;
        finishing = true;
        const domDurationMs = performance.now() - start;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          finishing = false;
          if (!isComplete() || finished) return;
          finished = true; observer.disconnect(); clearTimeout(timer);
          const durationMs = performance.now() - start;
          resolve({ durationMs, domDurationMs, frameDurationMs: durationMs - domDurationMs,
            renderedKnowledge: expected.knowledge.length, renderedParagraphs: expected.paragraphs.length });
        }));
      });
      observer.observe(workspace, { subtree: true, childList: true, characterData: true });
      input.addEventListener('input', () => {
        start = performance.now(); sawSearching ||= searching();
        timer = setTimeout(() => { observer.disconnect(); finished = true;
          reject(new Error(`真实搜索未完成：${JSON.stringify({ sawSearching, searching: searching(), actualKnowledge: rendered().knowledge.length,
            actualParagraphs: rendered().paragraphs.length, expectedKnowledge: expected.knowledge.length, expectedParagraphs: expected.paragraphs.length })}`));
        }, 20000);
      }, { once: true, capture: true });
    });
  }, { expected: sortedExpected, total: mode === 'knowledge' ? expected.knowledge.length : null });
  await page.getByRole('searchbox', { name: '模糊搜索知识与正文', exact: true }).fill(text);
  return page.evaluate(() => window.__searchMeasurement);
}

test('百万字/千条知识真实Electron输入至结果渲染200样本P95不超过1秒', async () => {
  const directory = await temporaryDirectory(), title = '搜索性能隔离作品';
  let application;
  const environment = await machineEnvironment(), samples = [], warmups = [];
  try {
    application = await launch(directory);
    let page = await offlineWindow(application);
    await createWork(page, title);
    const location = await page.evaluate(async title => ({ work: (await window.rainSoul.listWorks()).find(work => work.title === title),
      runtime: await window.rainSoul.getRuntimeInfo() }), title);
    await closeNormally(application); application = undefined;
    const fixture = seedSearchProject(path.join(location.runtime.dataDirectory, location.work.id, 'project.sqlite'), location.work.id);
    application = await launch(directory); page = await offlineWindow(application);
    // 测量前将隔离窗口置于前台，避免 Windows 遮挡检测对显示帧节流。
    environment.windowState = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.setBackgroundThrottling(false);
      window.show(); window.focus();
      return { visible: window.isVisible(), focused: window.isFocused(), backgroundThrottling: window.webContents.getBackgroundThrottling() };
    });
    await page.bringToFront();
    await page.setViewportSize({ width: 1280, height: 840 });
    environment.viewport = page.viewportSize();
    environment.electron = await application.evaluate(() => process.versions);
    await activate(page.getByRole('button', { name: `打开作品：${title}`, exact: true }));
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toBeEnabled();
    const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
    if (await expand.isVisible()) await activate(expand);
    await activate(page.getByRole('button', { name: '知识库', exact: true }));
    await expect(page.getByRole('searchbox', { name: '模糊搜索知识与正文', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('article', { name: /^知识：/ })).toHaveCount(1000);
    const expected = queries.map(query => expectedResults(fixture, query));
    let reset = 0;
    async function sample(index) {
      const query = queries[index];
      await page.getByRole('combobox', { name: '搜索范围', exact: true }).selectOption(query.mode);
      const group = page.getByRole('group', { name: '标签筛选', exact: true });
      for (const name of fixture.tagNames) {
        const button = group.getByRole('button', { name, exact: true });
        if ((await button.getAttribute('aria-pressed') === 'true') !== query.tags.includes(name)) await activate(button);
      }
      // 唯一出处稳定命中一条，确保正式查询的空结果也必须发生真实DOM变化，不能沿用旧空结果。
      reset++;
      await measureInput(page, '性能夹具参考0000', expectedResults(fixture, { ...query, text: '性能夹具参考0000' }), query.mode);
      return { queryIndex: index, text: query.text, mode: query.mode, tags: query.tags, ...await measureInput(page, query.text, expected[index], query.mode) };
    }
    for (let index = 0; index < queries.length; index++) warmups.push(await sample(index));
    console.log(`预热20查询完成；耗时范围 ${Math.min(...warmups.map(item => item.durationMs)).toFixed(2)}–${Math.max(...warmups.map(item => item.durationMs)).toFixed(2)}ms。`);
    for (let round = 0; round < 10; round++) {
      for (let index = 0; index < queries.length; index++) samples.push({ round, ...await sample(index) });
      console.log(`真实性能样本已完成 ${samples.length}/200。`);
    }
    // 分页改变的是首屏数量，性能门槛不变；另独立核对第二页没有遗漏或重复。
    const paginatedIndex = queries.findIndex((query, index) => query.mode === 'knowledge' && expected[index].knowledge.length > 20);
    expect(paginatedIndex).toBeGreaterThanOrEqual(0);
    await sample(paginatedIndex);
    await activate(page.getByRole('button', { name: '下一页检索结果', exact: true }));
    const secondPage = expected[paginatedIndex].knowledge.slice(20, 40).sort((left, right) => left.source.localeCompare(right.source));
    await expect.poll(() => page.locator('.knowledge-entry').evaluateAll(cards => cards.map(card => ({
      body: card.querySelector('.knowledge-snippet').textContent,
      source: card.querySelector('.knowledge-source span:last-of-type').textContent,
    })).sort((left, right) => left.source.localeCompare(right.source)))).toEqual(secondPage);
    await expect(page.getByRole('navigation', { name: '检索结果分页', exact: true })).toContainText(`第 2 页 · 共 ${expected[paginatedIndex].knowledge.length} 条`);
    const sorted = samples.map(sample => sample.durationMs).sort((left, right) => left - right);
    const rank = Math.ceil(0.95 * sorted.length), p95Ms = sorted[rank - 1];
    const report = { measuredAt: new Date().toISOString(), environment,
      fixture: { seed: fixture.seed, chapterCount: fixture.chapterCount, paragraphCount: fixture.paragraphCount,
        wordCount: fixture.wordCount, knowledgeCount: fixture.knowledgeCount },
      methodology: { start: '真实搜索输入框input事件', end: '正确真实DOM结果完成后跨两帧', warmupsExcluded: warmups.length,
        preparatoryResetQueriesExcluded: reset,
        queryCount: queries.length, samplesPerQuery: 10, sampleCount: samples.length, quantile: 'nearest-rank', percentile: 95, rank, thresholdMs: 1000 },
      p95Ms, maxMs: sorted.at(-1), medianMs: sorted[Math.ceil(sorted.length / 2) - 1], warmups, samples };
    const artifact = test.info().outputPath('search-performance.json');
    await writeFile(artifact, JSON.stringify(report, null, 2));
    await test.info().attach('真实Electron搜索性能证据', { path: artifact, contentType: 'application/json' });
    expect(samples).toHaveLength(200); expect(rank).toBe(190); expect(p95Ms).toBeLessThanOrEqual(1000);
    console.log(`真实Electron搜索：200样本，nearest-rank第190个，P95=${p95Ms.toFixed(2)}ms；预热${warmups.length}次另计。`);
    await page.bringToFront();
    await page.screenshot({ path: test.info().outputPath('search-performance.png') });
    await closeNormally(application);
  } finally { await cleanup(application, directory); }
});
