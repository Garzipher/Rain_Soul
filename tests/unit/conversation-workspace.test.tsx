// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { operationError } from '../../src/shared/operation-errors';
import { setup, stamp } from './conversation-workspace-fixture';
import type { ConversationApi } from '../../src/renderer/components/conversation-workspace';
afterEach(cleanup);
describe('需求会话工作区', () => {
  it('删除当前会话后打开同作品的剩余会话', async () => {
    const { api } = setup();
    const second = { id: '会话乙', title: '第二会话', revision: 1, draft: '剩余草稿', createdAt: stamp, updatedAt: stamp, messageCount: 0, hasMore: false, messages: [] };
    vi.mocked(api.listConversations).mockResolvedValue([second]);
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    await screen.findByRole('textbox', { name: '会话输入' });
    await waitFor(() => expect(screen.getByRole('button', { name: '删除会话：开篇讨论' })).toBeEnabled());
    vi.mocked(api.readConversation).mockImplementation(async (_workId, id) => ({ ...second, id }));
    fireEvent.click(screen.getByRole('button', { name: '删除会话：开篇讨论' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除会话' }));
    expect(await screen.findByRole('heading', { name: '第二会话' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '会话输入' })).toHaveValue('剩余草稿');
  });
  it('删除已完成但列表读取失败时，只重试读取仍能打开剩余会话', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    await screen.findByRole('textbox', { name: '会话输入' });
    await waitFor(() => expect(screen.getByRole('button', { name: '删除会话：开篇讨论' })).toBeEnabled());
    vi.mocked(api.listConversations).mockRejectedValueOnce(new Error('列表读取中断'));
    fireEvent.click(screen.getByRole('button', { name: '删除会话：开篇讨论' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除会话' }));
    await screen.findByText('列表读取中断');
    vi.mocked(api.listConversations).mockResolvedValue([{ id: '会话乙', title: '剩余会话', revision: 1, createdAt: stamp, updatedAt: stamp, messageCount: 0 }]);
    vi.mocked(api.readConversation).mockResolvedValue({ id: '会话乙', title: '剩余会话', draft: '', revision: 1, createdAt: stamp, updatedAt: stamp, messageCount: 0, hasMore: false, messages: [] });
    fireEvent.click(screen.getByRole('button', { name: '重新读取会话列表' }));
    expect(await screen.findByRole('heading', { name: '剩余会话' })).toBeVisible();
    expect(api.manageConversation).toHaveBeenCalledTimes(1);
  });
  it('离线仅记录消息不请求模型，正文当纯文本展示', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '会话输入' }), { target: { value: '<script>构思</script>' } });
    fireEvent.click(screen.getByRole('button', { name: '仅记录' }));
    expect(await screen.findByText('<script>构思</script>')).toBeVisible();
    expect(api.prepareConversationAi).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '会话输入' })).toHaveValue('');
  });
  it('明确显示最近消息范围，并按需加载更早历史', async () => {
    const { api } = setup();
    vi.mocked(api.readConversation).mockResolvedValueOnce({ id: '会话甲', title: '开篇讨论', revision: 1, draft: '', createdAt: stamp, updatedAt: stamp, messageCount: 101, hasMore: true, nextBeforeMessageId: 'recent', messages: [{ id: 'recent', role: 'user', content: '最近消息', createdAt: stamp }] });
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    expect(await screen.findByText('云端预览仅发送最近100条历史；更早消息可在本机阅读。')).toBeVisible();
    vi.mocked(api.readConversation).mockResolvedValueOnce({ id: '会话甲', title: '开篇讨论', revision: 1, draft: '', createdAt: stamp, updatedAt: stamp, messageCount: 101, hasMore: false, messages: [{ id: 'early', role: 'user', content: '早期消息', createdAt: stamp }] });
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    expect(await screen.findByText('早期消息')).toBeVisible();
    expect(api.readConversation).toHaveBeenLastCalledWith('作品甲', '会话甲', 'recent');
  });
  it('确定拒绝保留可编辑草稿，重新读取后能保存，不重放冲突版本', async () => {
    const { api } = setup();
    vi.mocked(api.manageConversation).mockRejectedValueOnce(operationError('会话版本冲突', 'REVISION_CONFLICT'));
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '会话输入' }), { target: { value: '保留这份草稿' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('会话版本冲突');
    expect(screen.getByRole('textbox', { name: '会话输入' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '重新读取会话并保留草稿' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('草稿已存本机'));
    expect(screen.getByRole('textbox', { name: '会话输入' })).toHaveValue('保留这份草稿');
  });
  it('新建结果不明时保留原操作ID，重试不重复创建', async () => {
    const { api } = setup();
    vi.mocked(api.manageConversation).mockRejectedValueOnce(new Error('连接中断'));
    fireEvent.click(await screen.findByRole('button', { name: '新建会话' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('连接中断');
    expect(screen.getByRole('button', { name: '新建会话' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重试会话操作' }));
    await screen.findByRole('textbox', { name: '会话输入' });
    expect(vi.mocked(api.manageConversation).mock.calls[0][0]).toEqual(vi.mocked(api.manageConversation).mock.calls[1][0]);
  });
  it('保存A未返回时输入B，发送前必须补保存最新B', async () => {
    const { api } = setup();
    let complete!: (value: Awaited<ReturnType<ConversationApi['manageConversation']>>) => void;
    vi.mocked(api.manageConversation).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '会话输入' }), { target: { value: 'A' } });
    await waitFor(() => expect(api.manageConversation).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox', { name: '会话输入' }), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: '预览发送' }));
    await act(async () => { complete({ id: '会话甲', title: '开篇讨论', revision: 2, draft: 'A', createdAt: stamp, updatedAt: stamp, messageCount: 0, messages: [], hasMore: false }); });
    await screen.findByText('合成授权材料');
    expect(api.manageConversation).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ type: 'saveDraft', draft: 'B', expectedRevision: 2 }) }));
  });
  it('授权弹窗接管焦点，Escape取消并保留输入', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '会话输入' }), { target: { value: '合成测试' } });
    fireEvent.click(screen.getByRole('button', { name: '预览发送' }));
    const dialog = await screen.findByRole('dialog', { name: '云端会话发送确认' });
    expect(screen.getByRole('button', { name: '取消发送' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(api.cancelConversationAi).toHaveBeenCalledWith('token'));
    expect(screen.getByRole('textbox', { name: '会话输入' })).toHaveValue('合成测试');
  });
  it('按作品展示会话，读取持久化草稿并在停顿后保存', async () => {
    const { api, dirty } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '会话输入' }), { target: { value: '离线构思' } });
    await waitFor(() => expect(api.manageConversation).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ type: 'saveDraft', draft: '离线构思' }) })));
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  });
  it('发送只打开授权预览，取消不执行云调用且保留草稿', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '会话输入' }), { target: { value: '合成测试' } });
    fireEvent.click(screen.getByRole('button', { name: '预览发送' }));
    expect(await screen.findByText('合成授权材料')).toBeVisible();
    expect(api.executeConversationAi).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消发送' }));
    await waitFor(() => expect(api.cancelConversationAi).toHaveBeenCalled());
    expect(screen.getByRole('textbox', { name: '会话输入' })).toHaveValue('合成测试');
  });
  it('确认后保存回复；失败仍保留草稿，不自动重发', async () => {
    const { api } = setup();
    vi.mocked(api.executeConversationAi).mockRejectedValueOnce(new Error('额度不足'));
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '会话输入' }), { target: { value: '不要丢失' } });
    fireEvent.click(screen.getByRole('button', { name: '预览发送' }));
    await screen.findByText('合成授权材料');
    fireEvent.click(screen.getByRole('button', { name: '确认发送' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('额度不足');
    expect(screen.getByRole('textbox', { name: '会话输入' })).toHaveValue('不要丢失');
    expect(api.executeConversationAi).toHaveBeenCalledTimes(1);
  });
  it('删除必须确认，取消不调用存储', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '删除会话：开篇讨论' }));
    expect(screen.getByRole('dialog', { name: '删除会话' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消删除' }));
    expect(api.manageConversation).not.toHaveBeenCalled();
  });
  it('未保存失败时阻止切换与发送，显式重试原操作', async () => {
    const { api, dirty } = setup();
    vi.mocked(api.manageConversation).mockRejectedValueOnce(new Error('磁盘已满'));
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '会话输入' }), { target: { value: '原稿' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘已满');
    expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '预览发送' }));
    expect(api.prepareConversationAi).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重试保存草稿' }));
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
    const requests = vi.mocked(api.manageConversation).mock.calls;
    expect(requests[0][0]).toEqual(requests[1][0]);
  });
  it('卸载时取消已打开的授权，避免晚回复进入其他作品', async () => {
    const { api, unmount } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '打开会话：开篇讨论' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '会话输入' }), { target: { value: '合成测试' } });
    fireEvent.click(screen.getByRole('button', { name: '预览发送' }));
    await screen.findByText('合成授权材料');
    await act(async () => { unmount(); });
    expect(api.cancelConversationAi).toHaveBeenCalledWith('token');
  });
});
