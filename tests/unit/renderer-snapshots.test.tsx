// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App';
import { createStructureAdapter } from './renderer-structure-adapter';
const adapters: ReturnType<typeof createStructureAdapter>[] = [];
async function setup() {
  const adapter = createStructureAdapter(); adapters.push(adapter); render(<App api={adapter.api} />);
  fireEvent.click(await screen.findByRole('button', { name: '新建作品' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('作品名称'), { target: { value: '雨落之后' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '创建作品' }));
  await screen.findByLabelText('章节标题'); return adapter;
}
afterEach(() => { cleanup(); adapters.splice(0).forEach(adapter => adapter.dispose()); });
it('历史快照导出按钮传递快照身份且不创建或恢复版本', async () => {
  const adapter = await setup();
  fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
  fireEvent.change(await screen.findByLabelText('快照名称'), { target: { value: '导出旧稿' } });
  fireEvent.click(screen.getByRole('button', { name: '创建快照' }));
  await screen.findByText('导出旧稿');
  const work = (await adapter.api.listWorks())[0], before = await adapter.api.openWork(work.id);
  const snapshots = await adapter.api.listSnapshots(work.id);
  adapter.api.exportManuscript = vi.fn(async () => true);
  // 在同一同步回合核对并点击，避免等待结束后列表刷新移除按钮。
  await waitFor(() => {
    const button = screen.getByRole('button', { name: '导出快照 TXT：导出旧稿' });
    expect(button).toBeEnabled(); fireEvent.click(button);
  });
  await waitFor(() => expect(adapter.api.exportManuscript).toHaveBeenCalledExactlyOnceWith(work.id, 'txt', snapshots[0].id, 'full'));
  await waitFor(() => {
    const button = screen.getByRole('button', { name: '导出快照 DOCX：导出旧稿' });
    expect(button).toBeEnabled(); fireEvent.click(button);
  });
  await waitFor(() => expect(adapter.api.exportManuscript).toHaveBeenLastCalledWith(work.id, 'docx', snapshots[0].id, 'full'));
  expect(await adapter.api.openWork(work.id)).toEqual(before);
  expect(await adapter.api.listSnapshots(work.id)).toEqual(snapshots);
});
it('手动快照先落盘，恢复旧快照刷新同 ID 正文且保留恢复前状态', async () => {
  const adapter = await setup();
  fireEvent.change(screen.getByLabelText('章节标题'), { target: { value: '初稿' } });
  fireEvent.paste(screen.getByLabelText('章节正文'), { clipboardData: { getData: () => '第一稿内容', types: ['text/plain'], files: [] } });
  fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
  fireEvent.change(await screen.findByLabelText('快照名称'), { target: { value: '原始版本' } });
  fireEvent.click(screen.getByRole('button', { name: '创建快照' }));
  await screen.findByText('原始版本');
  fireEvent.click(screen.getByRole('button', { name: '关闭版本历史' }));
  fireEvent.change(await screen.findByLabelText('章节标题'), { target: { value: '修改稿' } });
  fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
  fireEvent.click(await screen.findByRole('button', { name: '预览并恢复：原始版本' }));
  await screen.findByText('初稿');
  fireEvent.click(screen.getByRole('button', { name: '恢复为新版本' }));
  fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
  await screen.findByText('恢复：原始版本');
  fireEvent.click(screen.getByRole('button', { name: '关闭版本历史' }));
  expect(await screen.findByLabelText('章节标题')).toHaveValue('初稿');
  expect(screen.getByLabelText('章节正文')).toHaveTextContent('第一稿内容');
  const id = adapter.api.listWorks().then(works => works[0].id);
  const snapshots = await adapter.api.listSnapshots(await id);
  expect(snapshots).toHaveLength(3);
});
it('快照回执丢失保留原请求，关闭阻止且重试不会重复创建', async () => {
  const adapter = await setup(); const original = adapter.api.createSnapshot;
  adapter.api.createSnapshot = async request => { await original(request); throw new Error('回执丢失'); };
  fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
  fireEvent.change(await screen.findByLabelText('快照名称'), { target: { value: '安全稿' } });
  fireEvent.click(screen.getByRole('button', { name: '创建快照' }));
  await screen.findByText('回执丢失');
  await act(async () => { await expect(adapter.close()).rejects.toThrow('操作'); });
  adapter.api.createSnapshot = original;
  fireEvent.click(screen.getByRole('button', { name: '重试快照操作' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '重试快照操作' })).toBeNull());
  const work = (await adapter.api.listWorks())[0];
  expect(await adapter.api.listSnapshots(work.id)).toHaveLength(1);
});
