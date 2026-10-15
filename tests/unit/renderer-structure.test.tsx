// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../../src/renderer/App';
import { createStructureAdapter } from './renderer-structure-adapter';
const adapters: ReturnType<typeof createStructureAdapter>[] = [];
function createAdapter() { const adapter = createStructureAdapter(); adapters.push(adapter); return adapter; }

async function createWork(title = '雨落之后') {
  fireEvent.click(await screen.findByRole('button', { name: '新建作品' }));
  const dialog = screen.getByRole('dialog', { name: '新建作品' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: '作品名称' }), { target: { value: title } });
  fireEvent.click(within(dialog).getByRole('button', { name: '创建作品' }));
  await screen.findByRole('textbox', { name: '章节标题' });
}
async function createVolume(title = '雨季') {
  fireEvent.click(screen.getByRole('button', { name: '添加分卷' }));
  const dialog = screen.getByRole('dialog', { name: '新建分卷' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: '分卷名称' }), { target: { value: title } });
  fireEvent.click(within(dialog).getByRole('button', { name: '创建分卷' }));
  await screen.findByRole('button', { name: `收起分卷：${title}` });
}
async function chooseMenu(trigger: HTMLElement, name: string) {
  fireEvent.contextMenu(trigger, { clientX: 40, clientY: 90 });
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}
afterEach(() => { cleanup(); for (const adapter of adapters.splice(0)) adapter.dispose(); });

describe('作品与卷章结构管理', () => {
  it('键盘菜单取消归还焦点，删除确认前菜单已关闭且取消不改变数据', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    const chapter = screen.getByRole('button', { name: '打开章节：第一章' });
    chapter.focus();
    fireEvent.keyDown(chapter, { key: 'F10', shiftKey: true });
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(chapter);
    await chooseMenu(chapter, '删除章节');
    const dialog = screen.getByRole('dialog', { name: '删除章节' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '取消' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(adapter.works.values().next().value!.chapters).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(chapter);
  });

  it('创建卷与章节移动后继续写作可保存，折叠卷隐藏章节但保留字数', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    await createVolume();
    await chooseMenu(screen.getByRole('button', { name: '打开章节：第一章' }), '移至分卷：雨季');
    await waitFor(() => expect(adapter.works.values().next().value!.chapters[0].volumeId).not.toBeNull());
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '卷内开篇' } });
    fireEvent.paste(screen.getByRole('textbox', { name: '章节正文' }), { clipboardData: { getData: () => '雨落A1', types: ['text/plain'], files: [] } });
    await screen.findByText('本章 4 字');
    fireEvent.click(screen.getByRole('button', { name: '收起分卷：雨季' }));
    expect(screen.queryByRole('button', { name: '打开章节：第一章' })).toBeNull();
    expect(screen.getByRole('button', { name: '展开分卷：雨季' }).textContent).toContain('4');
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开作品：雨落之后' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('卷内开篇'));
    expect(screen.getByRole('textbox', { name: '章节正文' }).textContent).toBe('雨落A1');
  });

  it('删除最后章节进入空态，设置恢复后原正文与同名 ID 一并保留', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    fireEvent.paste(screen.getByRole('textbox', { name: '章节正文' }), { clipboardData: { getData: () => '必须保留的段落', types: ['text/plain'], files: [] } });
    await chooseMenu(screen.getByRole('button', { name: '打开章节：第一章' }), '删除章节');
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除章节' })).getByRole('button', { name: '确认删除' }));
    await screen.findByRole('heading', { name: '尚无章节' });
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const deleted = await screen.findByRole('group', { name: '已删除章节：第一章' });
    fireEvent.click(within(deleted).getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: '已删除章节：第一章' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '作品集' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开作品：雨落之后' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '章节正文' }).textContent).toBe('必须保留的段落'));
  });

  it('保存失败时确认删除不改结构并保留草稿，重试后可以删除', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    adapter.failSave(true);
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '不能丢稿' } });
    await chooseMenu(screen.getByRole('button', { name: '打开章节：第一章' }), '删除章节');
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除章节' })).getByRole('button', { name: '确认删除' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('不能丢稿');
    expect(adapter.works.values().next().value!.chapters).toHaveLength(1);
  });

  it('同名作品删除只作用于选中 ID，设置可恢复作品', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork('同名作品');
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    await createWork('同名作品');
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    const cards = await screen.findAllByRole('button', { name: '打开作品：同名作品' });
    await chooseMenu(cards[0], '删除作品');
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除作品' })).getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '打开作品：同名作品' })).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '恢复作品：同名作品' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '恢复作品：同名作品' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '作品集' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '打开作品：同名作品' })).toHaveLength(2));
  });

  it('结构读取期间锁定草稿，关闭等待操作结束后再保存', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    const manage = adapter.api.manageStructure;
    let finish: () => void = () => {};
    adapter.api.manageStructure = async (request) => { await new Promise<void>((resolve) => { finish = resolve; }); return manage(request); };
    fireEvent.click(screen.getByRole('button', { name: '添加分卷' }));
    const dialog = screen.getByRole('dialog', { name: '新建分卷' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '分卷名称' }), { target: { value: '等待卷' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建分卷' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).disabled).toBe(true));
    let closed = false;
    let closing = Promise.resolve();
    await act(async () => { closing = adapter.close().then(() => { closed = true; }); });
    expect(closed).toBe(false);
    await act(async () => { finish(); await closing; });
    expect(closed).toBe(true);
  });

  it('折叠选中卷后主添加仍归该卷，并自动展开新章节', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    await createVolume();
    fireEvent.click(screen.getByRole('button', { name: '收起分卷：雨季' }));
    fireEvent.click(screen.getByRole('button', { name: '添加章节' }));
    await waitFor(() => expect(adapter.works.values().next().value!.chapters).toHaveLength(2));
    const work = adapter.works.values().next().value!;
    expect(work.chapters[1].volumeId).toBe(work.volumes[0].id);
    await screen.findByRole('button', { name: '收起分卷：雨季' });
    expect(screen.getByRole('button', { name: '打开章节：第2章' })).toBeTruthy();
  });

  it('输入法组词期间拒绝切换章节与页面，已提交后可以继续', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    const title = screen.getByRole('textbox', { name: '章节标题' });
    fireEvent.compositionStart(title);
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('输入法'));
    expect(screen.getByRole('textbox', { name: '章节标题' })).toBe(title);
    fireEvent.compositionEnd(title);
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    await screen.findByRole('heading', { name: '作品集' });
  });

  it('卷操作成功但回执丢失时固定请求重取回执，继续写作不会版本冲突', async () => {
    const adapter = createAdapter();
    const manage = adapter.api.manageStructure;
    let loseReceipt = true;
    adapter.api.manageStructure = async (request) => {
      const detail = await manage(request);
      if (loseReceipt) { loseReceipt = false; throw new Error('操作回执未收到'); }
      return detail;
    };
    render(<App api={adapter.api} />);
    await createWork();
    fireEvent.click(screen.getByRole('button', { name: '添加分卷' }));
    const dialog = screen.getByRole('dialog', { name: '新建分卷' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '分卷名称' }), { target: { value: '唯一分卷' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建分卷' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试结构操作' }));
    await screen.findByRole('button', { name: '收起分卷：唯一分卷' });
    expect(adapter.works.values().next().value!.volumes).toHaveLength(1);
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '继续写作' } });
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    await screen.findByRole('heading', { name: '作品集' });
    expect(adapter.works.values().next().value!.chapters[0].title).toBe('继续写作');
  });

  it('添加章节提交后丢失回执，手動重取只新增一章且可以继续写作', async () => {
    const adapter = createAdapter();
    const add = adapter.api.addChapter;
    let loseReceipt = true;
    adapter.api.addChapter = async (...args) => {
      const detail = await add(...args);
      if (loseReceipt) { loseReceipt = false; throw new Error('章节回执未收到'); }
      return detail;
    };
    render(<App api={adapter.api} />);
    await createWork();
    fireEvent.click(screen.getByRole('button', { name: '添加章节' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试结构操作' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('第2章'));
    expect(adapter.works.values().next().value!.chapters).toHaveLength(2);
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '回执补齐后' } });
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    await screen.findByRole('heading', { name: '作品集' });
    expect(adapter.works.values().next().value!.chapters[1].title).toBe('回执补齐后');
  });

  it('删除作品提交后回执丢失可重取，取消不了解状态的关闭并可恢复', async () => {
    const adapter = createAdapter();
    const manage = adapter.api.manageStructure;
    let loseReceipt = true;
    adapter.api.manageStructure = async (request) => {
      const detail = await manage(request);
      if (request.action.type === 'deleteWork' && loseReceipt) { loseReceipt = false; throw new Error('删除回执未收到'); }
      return detail;
    };
    render(<App api={adapter.api} />);
    await createWork();
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    await chooseMenu(await screen.findByRole('button', { name: '打开作品：雨落之后' }), '删除作品');
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除作品' })).getByRole('button', { name: '确认删除' }));
    await screen.findByRole('button', { name: '重试结构操作' });
    await act(async () => { await expect(adapter.close()).rejects.toThrow('结构操作'); });
    fireEvent.click(screen.getByRole('button', { name: '重试结构操作' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试结构操作' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '恢复作品：雨落之后' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '恢复作品：雨落之后' })).toBeNull());
  });

  it('删除分卷影响清单立即采用未保存的当前章节标题', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    await createVolume('受影响的卷');
    fireEvent.click(screen.getByRole('button', { name: '添加章节' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('第2章'));
    adapter.failSave(true);
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '第二份原稿' } });
    await chooseMenu(screen.getByRole('button', { name: '收起分卷：受影响的卷' }), '删除分卷');
    const dialog = screen.getByRole('dialog', { name: '删除卷及章节' });
    expect(dialog.textContent).toContain('第二份原稿');
    expect(dialog.textContent).not.toContain('第2章');
    expect(adapter.works.values().next().value!.chapters.find((chapter) => chapter.volumeId !== null)!.title).toBe('第2章');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('第二份原稿');
  });
});
