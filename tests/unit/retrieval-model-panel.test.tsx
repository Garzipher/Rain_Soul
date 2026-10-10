// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RetrievalModelPanel } from '../../src/renderer/components/retrieval-model-panel';
import type { RetrievalModelStatus } from '../../src/shared/retrieval-model';
afterEach(cleanup);
const status: RetrievalModelStatus = { state: 'absent', installed: false, qualified: false, modelId: 'test', fingerprint: '', bytes: 0, message: '尚未安装模型' };
it('未安装或未验收模型明确说明原因，禁止启用，关键词继续可用', async () => {
  render(<RetrievalModelPanel api={{ getRetrievalModelStatus: async () => status }} busy={false} workId="work" />);
  expect(await screen.findByText('尚未安装模型')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '启用语义检索' })).toBeDisabled();
  expect(screen.getByText(/关键词检索始终可用/)).toBeInTheDocument();
});
it('导入失败保留当前状态并释放切换保护，可手动重试', async () => {
  const dirty = vi.fn(); const imported = { ...status, state: 'disabled' as const, installed: true, qualified: true, message: '已安装' };
  const api = { getRetrievalModelStatus: async () => status, importRetrievalModel: vi.fn().mockRejectedValueOnce(new Error('文件校验失败')).mockResolvedValueOnce(imported), setRetrievalModelEnabled: async () => ({ ...imported, state: 'ready' as const }) };
  render(<RetrievalModelPanel api={api} busy={false} workId="work" onBusyChange={dirty} />);
  await screen.findByText('尚未安装模型');
  fireEvent.click(screen.getByRole('button', { name: '导入本机模型目录' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('文件校验失败');
  expect(dirty).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: '导入本机模型目录' }));
  expect(await screen.findByText('已安装')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '启用语义检索' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '停用语义检索' })).toBeEnabled());
});
it('重建失败不宣称完成，错误可重试', async () => {
  const api = { getRetrievalModelStatus: async () => ({ ...status, state: 'ready' as const, installed: true, qualified: true }), rebuildKnowledgeIndex: vi.fn().mockRejectedValueOnce(new Error('磁盘空间不足')).mockResolvedValueOnce(undefined) };
  render(<RetrievalModelPanel api={api} busy={false} workId="work" />);
  fireEvent.click(await screen.findByRole('button', { name: '重建当前作品索引' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('磁盘空间不足');
  expect(screen.queryByText('索引重建完成')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重建当前作品索引' }));
  expect(await screen.findByText('索引重建完成')).toBeInTheDocument();
});
