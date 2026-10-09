// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
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

it('剧情脏草稿阻止标签、页面和关闭，保存后持久化且正文可继续保存', async () => {
  const adapter = await setup();
  fireEvent.click(screen.getByRole('tab', { name: '剧情架构' }));
  fireEvent.click(await screen.findByRole('button', { name: '新增章节点' }));
  fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '开篇来信' } });
  fireEvent.click(screen.getByRole('tab', { name: '正文' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('先保存或放弃');
  expect(screen.getByLabelText('节点名称')).toHaveValue('开篇来信');
  await act(async () => { await expect(adapter.close()).rejects.toThrow('资产编辑'); });
  fireEvent.click(screen.getByRole('button', { name: '创建节点' }));
  await screen.findByRole('button', { name: '选择剧情：开篇来信' });
  await waitFor(() => expect(screen.getByRole('tab', { name: '正文' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('tab', { name: '正文' }));
  fireEvent.change(await screen.findByLabelText('章节标题'), { target: { value: '第一封信' } });
  fireEvent.click(screen.getByRole('button', { name: '返回作品集' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开作品：雨落之后' }));
  expect(await screen.findByLabelText('章节标题')).toHaveValue('第一封信');
  fireEvent.click(screen.getByRole('tab', { name: '剧情架构' }));
  expect(await screen.findByRole('button', { name: '选择剧情：开篇来信' })).toBeInTheDocument();
});

it('知识页从真实 SQLite 搜索、保存失败保留草稿，取消后才能导航', async () => {
  const adapter = await setup();
  fireEvent.click(screen.getByRole('button', { name: '知识库' }));
  fireEvent.click(await screen.findByRole('button', { name: '新增知识' }));
  fireEvent.change(screen.getByLabelText('知识内容'), { target: { value: '雨水漫过旧站台。' } });
  const manage = adapter.api.manageAssets;
  adapter.api.manageAssets = async () => { throw new Error('磁盘不可写'); };
  fireEvent.click(screen.getByRole('button', { name: '保存知识' }));
  await screen.findByText('磁盘不可写');
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByLabelText('知识内容')).toHaveValue('雨水漫过旧站台。');
  adapter.api.manageAssets = manage;
  fireEvent.click(screen.getByRole('button', { name: '重试资产操作' }));
  await waitFor(() => expect(screen.queryByLabelText('知识内容')).not.toBeInTheDocument());
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '站' } });
  expect(await screen.findByRole('button', { name: /展开知识：雨水/ })).toBeInTheDocument();
});

it('搜索命中稳定段落后打开正文，段落 ID 在实际编辑器节点中可定位', async () => {
  await setup();
  fireEvent.paste(screen.getByLabelText('章节正文'), { clipboardData: { getData: () => '第一段\n灯光下的第二段', types: ['text/plain'], files: [] } });
  fireEvent.click(screen.getByRole('button', { name: '知识库' }));
  await screen.findByRole('searchbox');
  fireEvent.change(screen.getByLabelText('搜索范围'), { target: { value: 'all' } });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '灯光' } });
  fireEvent.click(await screen.findByRole('button', { name: '定位正文：第一章' }));
  const editor = await screen.findByLabelText('章节正文');
  expect(editor.querySelectorAll('[data-paragraph-id]')).toHaveLength(2);
});

it('设置维护知识字典与版本化写作特点，其他表单脏状态不会被清除', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(await screen.findByRole('button', { name: '新增分类' }));
  fireEvent.change(screen.getByLabelText('分类名称'), { target: { value: '灯光描写' } });
  fireEvent.change(screen.getByLabelText('节奏'), { target: { value: '紧凑' } });
  fireEvent.click(screen.getByRole('button', { name: '发布新版本' }));
  await screen.findByText(/作品默认：版本 1/);
  fireEvent.click(screen.getByRole('button', { name: '作品集' }));
  expect(screen.getByLabelText('分类名称')).toHaveValue('灯光描写');
  fireEvent.click(screen.getByRole('button', { name: '保存分类' }));
  await screen.findByRole('button', { name: '编辑分类：灯光描写' });
  await waitFor(() => expect(screen.queryByLabelText('分类名称')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '作品集' }));
  await screen.findByRole('heading', { name: '作品集' });
});

it('资产提交回执丢失后固定请求手动重试，不产生重复节点', async () => {
  const adapter = await setup();
  const manage = adapter.api.manageAssets; let lost = true;
  adapter.api.manageAssets = async request => { const updated = await manage(request); if (lost) { lost = false; throw new Error('资产回执未收到'); } return updated; };
  fireEvent.click(screen.getByRole('tab', { name: '剧情架构' }));
  fireEvent.click(await screen.findByRole('button', { name: '新增章节点' }));
  fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '唯一来信' } });
  fireEvent.click(screen.getByRole('button', { name: '创建节点' }));
  await screen.findByText('资产回执未收到');
  fireEvent.click(screen.getByRole('button', { name: '重试资产操作' }));
  await screen.findByRole('button', { name: '选择剧情：唯一来信' });
  expect(adapter.works.values().next().value!.assets!.outlines).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: '正文' }));
  expect(await screen.findByLabelText('章节标题')).toBeInTheDocument();
});

