import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { expect, it, vi } from 'vitest';
import { textbookPlugin } from '../../scripts/textbook-vite-plugin.mjs';

it('真实开发服务器刷新 Markdown 与截图，失败不提供旧教材，修复后恢复', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rainsoul-textbook-dev-'));
  const outside = `${directory}-outside.md`;
  let server: ViteDevServer | undefined;
  try {
    await mkdir(join(directory, 'images'));
    await writeFile(join(directory, 'course.json'), JSON.stringify({ title: '项目全流程开发学习', volumes: [
      { key: 'v1', title: '卷', chapters: [{ key: 'v1/c1', title: '实验', file: 'chapter.md' }] },
    ] }));
    const initial = '# 初始教材\n\n练习\n\n![截图](images/screen.png)';
    await writeFile(join(directory, 'chapter.md'), initial);
    await writeFile(join(directory, 'images/screen.png'), await readFile('assets/rainsoul.png'));
    server = await createServer({ configFile: false, root: directory, plugins: [textbookPlugin(directory)],
      server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { noDiscovery: true } });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('开发测试端口未分配');
    const origin = `http://127.0.0.1:${address.port}`;
    const moduleUrl = '/@id/__x00__virtual:rainsoul-textbook';
    const getModule = () => fetch(`${origin}${moduleUrl}?t=${Date.now()}`);
    const before = await (await getModule()).text();
    expect(before).toContain('初始教材');
    const oldImage = before.match(/\/learning\/[a-f0-9]+\.png/)![0];
    expect((await fetch(origin + oldImage)).headers.get('content-type')).toBe('image/png');

    await writeFile(join(directory, 'chapter.md'), initial.replace('初始教材', '修订教材'));
    await expect.poll(async () => (await (await getModule()).text()).includes('修订教材'), { timeout: 2500 }).toBe(true);

    await writeFile(join(directory, 'images/screen.png'), await readFile('learning/项目全流程开发学习/images/shelf.png'));
    let newImage = '';
    await expect.poll(async () => {
      newImage = (await (await getModule()).text()).match(/\/learning\/[a-f0-9]+\.png/)?.[0] ?? '';
      return newImage !== '' && newImage !== oldImage;
    }, { timeout: 2500 }).toBe(true);
    expect((await fetch(origin + newImage)).headers.get('content-type')).toBe('image/png');

    // 连续修改同一图片之间留出文件监听器去重窗口，避免测试把两次保存合并。
    await new Promise((done) => setTimeout(done, 150));
    await writeFile(join(directory, 'images/screen.png'), '损坏截图');
    await expect.poll(async () => (await getModule()).status, { timeout: 2500 }).toBe(500);
    expect((await fetch(origin + newImage)).headers.get('content-type')).not.toBe('image/png');
    await new Promise((done) => setTimeout(done, 150));
    await writeFile(join(directory, 'images/screen.png'), await readFile('assets/rainsoul.png'));
    await expect.poll(async () => (await getModule()).status, { timeout: 2500 }).toBe(200);
    expect(await (await getModule()).text()).toContain('修订教材');

    // 外部文件不属于教材资源，不能触发读取或改变虚拟教材。
    const beforeOutside = await (await getModule()).text();
    await writeFile(outside, '外部旧内容');
    server.watcher.add(outside);
    await new Promise((done) => setTimeout(done, 150));
    const broadcasts = vi.spyOn(server.ws, 'send');
    await writeFile(outside, '外部新内容');
    await new Promise((done) => setTimeout(done, 150));
    expect(broadcasts).not.toHaveBeenCalled();
    expect(await (await getModule()).text()).toBe(beforeOutside);
    broadcasts.mockRestore();
    expect(resolve(directory)).not.toBe(resolve('learning/项目全流程开发学习'));
    await new Promise((done) => setTimeout(done, 150));
    await rm(join(directory, 'images/screen.png'));
    await expect.poll(async () => (await getModule()).status, { timeout: 2500 }).toBe(500);
  } finally {
    await server?.close();
    await rm(outside, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
