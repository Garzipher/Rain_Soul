// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { chooseSelect } from './select-field-helper';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App';
import { operationError } from '../../src/shared/operation-errors';
import { createStructureAdapter } from './renderer-structure-adapter';

const adapters: ReturnType<typeof createStructureAdapter>[] = [];
afterEach(() => { cleanup(); adapters.splice(0).forEach(adapter => adapter.dispose()); });
async function setup() {
  const adapter = createStructureAdapter(); adapters.push(adapter);
  let source = await adapter.api.createWork('参考作品');
  for (const name of ['雨夜', '未匹配']) source = await adapter.api.manageAssets({ workId: source.id, expectedRevision: source.revision, operationId: crypto.randomUUID(), action: { type: 'createTag', name } });
  source = await adapter.api.manageAssets({ workId: source.id, expectedRevision: source.revision, operationId: crypto.randomUUID(), action: { type: 'createKnowledge', body: '雨落在窗边。', source: '参考作品第1章', categoryId: source.assets!.categories[1].id, tagIds: source.assets!.tags.map(tag => tag.id) } });
  let target = await adapter.api.createWork('当前作品');
  target = await adapter.api.manageAssets({ workId: target.id, expectedRevision: target.revision, operationId: crypto.randomUUID(), action: { type: 'createTag', name: '雨夜' } });
  const copy = vi.spyOn(adapter.api, 'copyKnowledge');
  render(<App api={adapter.api} />);
  fireEvent.click(await screen.findByRole('button', { name: '打开作品：当前作品' }));
  await screen.findByLabelText('章节标题'); fireEvent.click(screen.getByRole('button', { name: '知识库' }));
  fireEvent.click(await screen.findByRole('button', { name: /^作品知识库/ }));
  await chooseSelect(await screen.findByLabelText('作品范围'), '全部作品（只读）');
  const card = await screen.findByRole('article', { name: /知识：雨落在窗边/ });
  fireEvent.click(within(card).getByRole('button', { name: '复制到当前作品' }));
  return { adapter, source, target, copy };
}
it('跨作品复制先预览分类与标签映射，取消不写入', async () => {
  const { copy, adapter, target } = await setup();
  const dialog = await screen.findByRole('dialog', { name: '复制知识到当前作品' });
  expect(copy).not.toHaveBeenCalled();
  expect(dialog).toHaveTextContent('未匹配标签：未匹配');
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  expect(copy).not.toHaveBeenCalled(); expect(adapter.works.get(target.id)!.assets!.knowledge).toEqual([]);
});
it('确认后写入作者选定分类、目标标签ID，保留来源且不暗中创建标签', async () => {
  const { copy, adapter, source, target } = await setup();
  const dialog = await screen.findByRole('dialog', { name: '复制知识到当前作品' });
  const categoryId = target.assets!.categories.find(item => item.name === '景物描写')!.id;
  await chooseSelect(within(dialog).getByLabelText('目标主分类'), target.assets!.categories.find(item => item.id === categoryId)!.name);
  fireEvent.click(within(dialog).getByRole('button', { name: '确认复制' }));
  await waitFor(() => expect(adapter.works.get(target.id)!.assets!.knowledge).toHaveLength(1));
  expect(copy).toHaveBeenCalledOnce();
  expect(copy.mock.calls[0][0]).toMatchObject({ workId: target.id, categoryId, tagIds: [target.assets!.tags[0].id], sourceExpectedRevision: source.revision });
  const updated = adapter.works.get(target.id)!;
  expect(updated.assets!.knowledge[0]).toMatchObject({ categoryId, tagIds: [target.assets!.tags[0].id], origin: { workId: source.id, entryId: source.assets!.knowledge[0].id } });
  expect(updated.assets!.tags).toHaveLength(1); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
it('明确失败保留映射选择，手动确认可重试', async () => {
  const { copy, target } = await setup();
  const original = copy.getMockImplementation()!;
  copy.mockImplementationOnce(async () => { throw operationError('分类暂不可用', 'INVALID_INPUT'); }).mockImplementation(original);
  const dialog = await screen.findByRole('dialog', { name: '复制知识到当前作品' });
  const categoryId = target.assets!.categories[1].id;
  await chooseSelect(within(dialog).getByLabelText('目标主分类'), target.assets!.categories.find(item => item.id === categoryId)!.name);
  fireEvent.click(within(dialog).getByRole('button', { name: '确认复制' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('选择已保留');
  expect(within(dialog).getByLabelText('目标主分类')).toHaveTextContent(target.assets!.categories.find(item => item.id === categoryId)!.name);
  fireEvent.click(within(dialog).getByRole('button', { name: '确认复制' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(copy).toHaveBeenCalledTimes(2);
});
it('预览后来源变化被拒绝，不写入目标或自动重发', async () => {
  const { adapter, source, target, copy } = await setup();
  const dialog = await screen.findByRole('dialog', { name: '复制知识到当前作品' });
  await act(async () => {
    await adapter.api.openWork(source.id);
    await adapter.api.manageAssets({ workId: source.id, expectedRevision: source.revision, operationId: crypto.randomUUID(), action: { type: 'createTag', name: '新标签' } });
    await adapter.api.openWork(target.id);
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认复制' }));
  expect(await screen.findByText('来源作品已变化，请重新查看后确认复制。')).toBeInTheDocument();
  expect(copy).toHaveBeenCalledOnce(); expect(adapter.works.get(target.id)!.assets!.knowledge).toEqual([]);
  expect(within(dialog).getByLabelText('目标主分类')).not.toBeDisabled();
});
it('预览阻止切换目标作品和关闭，取消后可返回作品集', async () => {
  const { adapter } = await setup();
  const dialog = await screen.findByRole('dialog', { name: '复制知识到当前作品' });
  fireEvent.click(screen.getByRole('button', { name: '作品集' }));
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(await screen.findByText('请先确认或取消当前知识复制。')).toBeInTheDocument();
  await act(async () => { await expect(adapter.close()).rejects.toThrow('知识复制尚未确认'); });
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '作品集' }));
  expect(await screen.findByRole('button', { name: '打开作品：当前作品' })).toBeInTheDocument();
});
it('复制提交回执丢失时保留原请求并手动重试，不创建第二份副本', async () => {
  const { copy, adapter, target } = await setup();
  const original = copy.getMockImplementation()!;
  copy.mockImplementationOnce(async request => { await original(request); throw new Error('复制回执未收到'); }).mockImplementation(original);
  const dialog = await screen.findByRole('dialog', { name: '复制知识到当前作品' });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认复制' }));
  const retry = await within(dialog).findByRole('button', { name: '重试本次复制' });
  expect(within(dialog).getByRole('button', { name: '正在处理…' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(copy).toHaveBeenCalledTimes(2); expect(copy.mock.calls[0][0]).toEqual(copy.mock.calls[1][0]);
  expect(adapter.works.get(target.id)!.assets!.knowledge).toHaveLength(1);
});
it('全部作品中的当前作品知识显示归属，不提供自我复制入口', async () => {
  const { adapter, target, copy } = await setup();
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }));
  await act(async () => {
    await adapter.api.manageAssets({ workId: target.id, expectedRevision: target.revision, operationId: crypto.randomUUID(), action: { type: 'createKnowledge', body: '当前作品自己的知识。', source: '本作', categoryId: target.assets!.categories[0].id, tagIds: [] } });
  });
  await chooseSelect(screen.getByLabelText('作品范围'), `当前作品：${target.title}`);
  await screen.findByRole('article', { name: /知识：当前作品自己的/ });
  await chooseSelect(screen.getByLabelText('作品范围'), '全部作品（只读）');
  const card = await screen.findByRole('article', { name: /知识：当前作品自己的/ });
  expect(card).toHaveTextContent('已在当前作品');
  expect(within(card).queryByRole('button', { name: '复制到当前作品' })).not.toBeInTheDocument();
  expect(copy).not.toHaveBeenCalled();
});
it('未知失败重试被明确拒绝后解除待确认状态，保留映射并允许取消', async () => {
  const { copy } = await setup();
  copy.mockRejectedValueOnce(new Error('通信中断')).mockRejectedValueOnce(operationError('来源已删除', 'NOT_FOUND'));
  const dialog = await screen.findByRole('dialog', { name: '复制知识到当前作品' });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认复制' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: '重试本次复制' }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '取消' })).not.toBeDisabled());
  expect(copy).toHaveBeenCalledTimes(2); expect(copy.mock.calls[0][0]).toEqual(copy.mock.calls[1][0]);
  expect(within(dialog).getByRole('checkbox', { name: '雨夜' })).toBeChecked();
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
