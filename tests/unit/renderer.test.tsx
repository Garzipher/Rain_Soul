// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../../src/renderer/App';
import { createAdapter } from './renderer-adapter';


export async function createWork(title = '雨落之后') {
  fireEvent.click(screen.getByRole('button', { name: '新建作品' }));
  const dialog = screen.getByRole('dialog', { name: '新建作品' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: '作品名称' }), { target: { value: title } });
  fireEvent.click(within(dialog).getByRole('button', { name: '创建作品' }));
  await screen.findByRole('textbox', { name: '章节标题' });
}

afterEach(cleanup);

describe('真实桌面写作界面', () => {
  it('作品集默认收起侧栏，展开后能导航到后置入口', async () => {
    render(<App api={createAdapter().api} />);
    await screen.findByRole('heading', { name: '作品集' });
    expect(screen.getByRole('button', { name: '展开侧栏' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('已保存')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
    expect(screen.getByText('未设置名称')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '需求会话' }));
    expect(await screen.findByText('后续开发：本功能尚未交付')).toBeTruthy();
  });

  it('新建作品使用空正文，不携带演示内容，工作区保留三个标签', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    expect(screen.getByRole('heading', { name: '雨落之后' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '章节正文' }).textContent).toBe('');
    expect(screen.getByRole('tab', { name: '剧情架构' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '伏笔架构' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '新建作品' })).toBeNull();
  });

  it('离开章节会保存最新标题，再打开同名作品时仍按 ID 隔离', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork('同名作品');
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '属于第一部的章节' } });
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    await screen.findByRole('heading', { name: '作品集' });
    await createWork('同名作品');
    expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('第一章');
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    const cards = await screen.findAllByRole('button', { name: /打开作品：同名作品/ });
    fireEvent.click(cards[0]);
    await waitFor(() => expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('属于第一部的章节'));
  });

  it('保存失败保留草稿并阻止离开，作者重试成功后才能返回', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    adapter.failSave(true);
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '不能丢失的标题' } });
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('磁盘空间不足'));
    expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('不能丢失的标题');
    expect(screen.queryByRole('heading', { name: '作品集' })).toBeNull();
    adapter.failSave(false);
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await screen.findByText('已保存');
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    await screen.findByRole('heading', { name: '作品集' });
    fireEvent.click(screen.getByRole('button', { name: '打开作品：雨落之后' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('不能丢失的标题'));
  });

  it('粘贴正文实时统计汉字字母数字，并在重新打开后保留正文', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    const editor = screen.getByRole('textbox', { name: '章节正文' });
    fireEvent.paste(editor, { clipboardData: { getData: (type: string) => type === 'text/plain' ? '雨A1， B2' : '', types: ['text/plain'], files: [] } });
    await screen.findByText('本章 5 字');
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开作品：雨落之后' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '章节正文' }).textContent).toBe('雨A1， B2'));
  });

  it('添加新章节先保存当前草稿，切回原章节可继续编辑', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '开篇' } });
    fireEvent.click(screen.getByRole('button', { name: '添加章节' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).not.toBe('开篇'));
    fireEvent.click(screen.getByRole('button', { name: '打开章节：开篇' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('开篇'));
  });

  it('取消新建后恢复触发按钮焦点且不创建作品', async () => {
    render(<App api={createAdapter().api} />);
    const trigger = await screen.findByRole('button', { name: '新建作品' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '新建作品' });
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: '作品名称' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('button', { name: /打开作品：/ })).toBeNull();
  });

  it('作品集加载失败提供重试，不把错误当作空作品集', async () => {
    const adapter = createAdapter();
    const listWorks = adapter.api.listWorks;
    adapter.api.listWorks = async () => { throw new Error('本机目录不可访问'); };
    render(<App api={adapter.api} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('本机目录不可访问'));
    adapter.api.listWorks = listWorks;
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('还没有作品')).toBeTruthy();
  });

  it('关闭握手保存最新草稿，失败时拒绝关闭并保留可重试状态', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    adapter.failSave(true);
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '关闭前必须保存' } });
    await expect(adapter.close()).rejects.toThrow('磁盘空间不足');
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('磁盘空间不足'));
    adapter.failSave(false);
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await screen.findByText('已保存');
    await expect(adapter.close()).resolves.toBeUndefined();
    expect([...adapter.works.values()][0].chapters[0].title).toBe('关闭前必须保存');
  });

  it('工作区标签支持键盘左右切换并在保存失败时保持正文', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    const body = screen.getByRole('tab', { name: '正文' });
    body.focus();
    fireEvent.keyDown(body, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('tab', { name: '剧情架构' }).getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '剧情架构' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: '剧情架构' }), { key: 'Home' });
    await screen.findByRole('textbox', { name: '章节标题' });
    adapter.failSave(true);
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '留在正文' } });
    fireEvent.keyDown(screen.getByRole('tab', { name: '正文' }), { key: 'ArrowRight' });
    await screen.findByRole('alert');
    expect(screen.getByRole('tab', { name: '正文' }).getAttribute('aria-selected')).toBe('true');
  });

  it('关闭保存期间锁定输入，失败后恢复编辑并保留新草稿', async () => {
    const adapter = createAdapter();
    let rejectSave: (error: Error) => void = () => {};
    adapter.api.saveChapter = async () => new Promise((_resolve, reject) => { rejectSave = reject; });
    render(<App api={adapter.api} />);
    await createWork();
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '关闭前草稿' } });
    let closing: Promise<void> = Promise.resolve();
    await act(async () => { closing = adapter.close(); });
    expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('textbox', { name: '章节正文' }).getAttribute('contenteditable')).toBe('false');
    await act(async () => { rejectSave(new Error('磁盘空间不足')); await expect(closing).rejects.toThrow('磁盘空间不足'); });
    expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '失败后继续写' } });
    expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('失败后继续写');
  });

  it('输入法组词尚未结束时阻止关闭，提交后仍可保存', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    const title = screen.getByRole('textbox', { name: '章节标题' });
    fireEvent.compositionStart(title);
    await act(async () => { await expect(adapter.close()).rejects.toThrow('输入法'); });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('输入法'));
    fireEvent.compositionEnd(title);
    await act(async () => { await expect(adapter.close()).resolves.toBeUndefined(); });
  });

  it('切换作品等待存储读取期间锁定原正文，失败后恢复可编辑', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    let rejectList: (error: Error) => void = () => {};
    adapter.api.listWorks = async () => new Promise((_resolve, reject) => { rejectList = reject; });
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).disabled).toBe(true));
    expect(screen.getByRole('textbox', { name: '章节正文' }).getAttribute('contenteditable')).toBe('false');
    await act(async () => { rejectList(new Error('目录暂不可用')); });
    await screen.findByRole('alert');
    expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '继续留在当前作品' } });
    expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe('继续留在当前作品');
  });

  it('关闭等待正在添加的章节完成，不提前放行窗口关闭', async () => {
    const adapter = createAdapter();
    const add = adapter.api.addChapter;
    let finishAdd: () => void = () => {};
    adapter.api.addChapter = async (...args) => {
      await new Promise<void>((resolve) => { finishAdd = resolve; });
      return add(...args);
    };
    render(<App api={adapter.api} />);
    await createWork();
    fireEvent.click(screen.getByRole('button', { name: '添加章节' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '添加章节' }).hasAttribute('disabled')).toBe(true));
    let closed = false;
    let closing: Promise<void> = Promise.resolve();
    await act(async () => { closing = adapter.close().then(() => { closed = true; }); });
    expect(closed).toBe(false);
    await act(async () => { finishAdd(); await closing; });
    expect(closed).toBe(true);
    expect([...adapter.works.values()][0].chapters).toHaveLength(2);
  });

  it('空章节标题保存失败后，修正标题可重试成功并离开', async () => {
    render(<App api={createAdapter().api} />);
    await createWork();
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '' } });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('章节标题不能为空'));
    fireEvent.change(screen.getByRole('textbox', { name: '章节标题' }), { target: { value: '修正后的章节' } });
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await screen.findByText('已保存');
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    await screen.findByRole('heading', { name: '作品集' });
  });

  it('正文撤销重做恢复内容和字数，保存的多段正文 ID 仍唯一', async () => {
    const adapter = createAdapter();
    render(<App api={adapter.api} />);
    await createWork();
    const editor = screen.getByRole('textbox', { name: '章节正文' });
    fireEvent.paste(editor, { clipboardData: { getData: (type: string) => type === 'text/plain' ? '雨A1， B2\n下一段' : '', types: ['text/plain'], files: [] } });
    await screen.findByText('本章 8 字');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    await screen.findByText('本章 0 字');
    fireEvent.keyDown(editor, { key: 'y', ctrlKey: true });
    await screen.findByText('本章 8 字');
    fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
    await screen.findByRole('heading', { name: '作品集' });
    const saved = [...adapter.works.values()][0].chapters[0].document;
    const ids = saved.content.map((paragraph) => paragraph.attrs.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(saved.content.flatMap((paragraph) => paragraph.content ?? []).filter((node) => node.type === 'text').map((node) => node.text)).toEqual(['雨A1， B2', '下一段']);
  });
});
