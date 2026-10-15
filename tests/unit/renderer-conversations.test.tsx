// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App';
import { createStructureAdapter } from './renderer-structure-adapter';
import { chooseSelect } from './select-field-helper';

afterEach(cleanup);
describe('正式会话接线', () => {
  it('新建作品立即进入会话目录，异步切换期间不能在旧作品创建会话', async () => {
    const adapter = createStructureAdapter();
    try {
      await adapter.api.createWork('作品甲');
      render(<App api={adapter.api} />);
      fireEvent.click(await screen.findByRole('button', { name: '新建作品' }));
      fireEvent.change(screen.getByRole('textbox', { name: '作品名称' }), { target: { value: '新作品乙' } });
      fireEvent.click(screen.getByRole('button', { name: '创建作品' }));
      await screen.findByRole('textbox', { name: '章节标题' });
      fireEvent.click(screen.getByRole('button', { name: '需求会话' }));
      const selector = await screen.findByRole('combobox', { name: '会话所属作品' });
      expect(selector).toHaveTextContent('新作品乙');
      let release!: () => void;
      const original = adapter.api.openWork;
      vi.spyOn(adapter.api, 'openWork').mockImplementation(async id => { await new Promise<void>(resolve => { release = resolve; }); return original(id); });
      await chooseSelect(selector, '作品甲');
      await waitFor(() => expect(screen.getByRole('button', { name: '新建会话' })).toBeDisabled());
      release();
      await waitFor(() => expect(screen.getByRole('button', { name: '新建会话' })).toBeEnabled());
    } finally { cleanup(); adapter.close(); }
  });
  it('作品下创建会话、保存草稿、重进仍在，并保护未保存草稿切换', async () => {
    const adapter = createStructureAdapter();
    try {
      await adapter.api.createWork('会话隔离作品');
      render(<App api={adapter.api} />);
      fireEvent.click(await screen.findByRole('button', { name: '打开作品：会话隔离作品' }));
      await screen.findByRole('textbox', { name: '章节标题' });
      fireEvent.click(screen.getByRole('button', { name: '需求会话' }));
      fireEvent.click(await screen.findByRole('button', { name: '新建会话' }));
      const input = await screen.findByRole('textbox', { name: '会话输入' });
      fireEvent.change(input, { target: { value: '第一章以雨声开场' } });
      fireEvent.click(screen.getByRole('button', { name: '作品集' }));
      expect(screen.getByRole('textbox', { name: '会话输入' })).toHaveValue('第一章以雨声开场');
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Enter 发送 · Shift+Enter 换行'));
      fireEvent.click(screen.getByRole('button', { name: '作品集' }));
      await screen.findByRole('heading', { name: '作品集' });
      fireEvent.click(screen.getByRole('button', { name: '需求会话' }));
      fireEvent.click(await screen.findByRole('button', { name: '打开会话：新会话' }));
      expect(await screen.findByRole('textbox', { name: '会话输入' })).toHaveValue('第一章以雨声开场');
    } finally { cleanup(); adapter.close(); }
  });
});
