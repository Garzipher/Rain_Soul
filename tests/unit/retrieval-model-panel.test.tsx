// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { RetrievalModelPanel } from '../../src/renderer/components/retrieval-model-panel';
import { fixedManifest, type RetrievalModelStatus } from '../../src/shared/retrieval-model';
afterEach(cleanup);
const status: RetrievalModelStatus = { state: 'absent', installed: false, qualified: false, modelId: 'test', fingerprint: '', bytes: 0, message: '尚未安装模型' };
it('显示固定模型来源修订许可和真实文件总量，空间只标估算', async () => {
  render(<RetrievalModelPanel api={{ getRetrievalModelStatus: async () => ({ ...status, bytes: 1234567 }) }} busy={false} workId="work" />);
  await screen.findByText('尚未安装模型');
  expect(screen.getByText(fixedManifest.modelId)).toBeInTheDocument();
  expect(screen.getByText(fixedManifest.revision.slice(0, 12))).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'MIT 许可证' })).toHaveAttribute('href', fixedManifest.licenseUrl);
  expect(screen.getByRole('link', { name: '固定版本来源' })).toHaveAttribute('href', `https://huggingface.co/${fixedManifest.repository}/tree/${fixedManifest.revision}`);
  expect(screen.getByText('1.18 MiB（1,234,567 字节）')).toBeInTheDocument();
  expect(screen.getByText(/可用磁盘空间尚未测量/)).toBeInTheDocument();
  expect(screen.getByText(/取消导入尚未接入/)).toBeInTheDocument();
});
it('已安装但资格待核验不显示已启用并禁止重建', async () => {
  render(<RetrievalModelPanel api={{ getRetrievalModelStatus: async () => ({ ...status, state: 'ready', installed: true }), rebuildKnowledgeIndex: async () => {} }} busy={false} workId="work" />);
  expect(await screen.findByText('已安装，资格待核验')).toBeInTheDocument();
  expect(screen.queryByText('已启用')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重建当前作品索引' })).toBeDisabled();
});
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

it('下载只在作者点击后开始，显示本次进度并用同一操作编号取消', async () => {
  let complete!: (value: RetrievalModelStatus) => void;
  let operationId = '';
  const busy = vi.fn();
  const download = vi.fn(({ operationId: id }: { operationId: string }) => { operationId = id; return new Promise<RetrievalModelStatus>(resolve => { complete = resolve; }); });
  const cancel = vi.fn(async () => { complete({ ...status, message: '安装已取消，原模型保留' }); });
  const api = {
    getRetrievalModelStatus: vi.fn(async () => operationId ? { ...status, state: 'installing' as const, progress: { operationId, source: 'download' as const, phase: 'downloading' as const, receivedBytes: 50, totalBytes: 100, file: 'model.onnx' }, requiredSpaceBytes: 200, availableSpaceBytes: 1000 } : status),
    downloadRetrievalModel: download, cancelRetrievalModelInstall: cancel,
  };
  render(<RetrievalModelPanel api={api} busy={false} workId="work" onBusyChange={busy} />);
  await screen.findByText('尚未安装模型');
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '下载固定版本模型' }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  expect(operationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(await screen.findByRole('progressbar', { name: '模型安装进度' })).toHaveAttribute('value', '50');
  expect(screen.getByText('model.onnx')).toBeInTheDocument();
  expect(busy).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '取消模型安装' }));
  await screen.findByText('安装已取消，原模型保留');
  expect(cancel).toHaveBeenCalledWith({ operationId });
  expect(busy).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

it('下载完成后忽略迟到的进度回执，未资格模型仍禁止启用', async () => {
  let complete!: (value: RetrievalModelStatus) => void;
  let late!: (value: RetrievalModelStatus) => void;
  const poll = vi.fn().mockResolvedValueOnce(status).mockImplementation(() => new Promise<RetrievalModelStatus>(resolve => { late = resolve; }));
  const api = { getRetrievalModelStatus: poll, downloadRetrievalModel: vi.fn(() => new Promise<RetrievalModelStatus>(resolve => { complete = resolve; })) };
  render(<RetrievalModelPanel api={api} busy={false} workId="work" />);
  await screen.findByText('尚未安装模型');
  fireEvent.click(screen.getByRole('button', { name: '下载固定版本模型' }));
  await waitFor(() => expect(poll).toHaveBeenCalledTimes(2));
  await act(async () => complete({ ...status, state: 'disabled', installed: true, message: '固定版本已安装' }));
  await screen.findByText('固定版本已安装');
  await act(async () => late({ ...status, state: 'installing', message: '迟到进度' }));
  expect(screen.queryByText('迟到进度')).not.toBeInTheDocument();
  expect(screen.getByText('已安装，资格待核验')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '启用语义检索' })).toBeDisabled();
});

it('下载失败说明原因并释放保护，保留原模型状态', async () => {
  const busy = vi.fn();
  const api = { getRetrievalModelStatus: async () => ({ ...status, state: 'disabled' as const, installed: true, qualified: true, message: '现有模型已停用' }), downloadRetrievalModel: vi.fn().mockRejectedValue(new Error('可用磁盘空间不足')) };
  render(<RetrievalModelPanel api={api} busy={false} workId="work" onBusyChange={busy} />);
  await screen.findByText('现有模型已停用');
  fireEvent.click(screen.getByRole('button', { name: '下载固定版本模型' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('可用磁盘空间不足');
  expect(screen.getByText('现有模型已停用')).toBeInTheDocument();
  expect(busy).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('button', { name: '下载固定版本模型' })).toBeEnabled();
});
it('未捆绑构建明确说明内置缺失，保持关键词并禁止选择不存在的内置来源', async () => {
  render(<RetrievalModelPanel api={{ getRetrievalModelStatus: async () => ({ ...status, source: 'bundled', bundledPresent: false, enabled: true }), selectRetrievalModelSource: async () => status }} busy={false} workId="work" />);
  expect(await screen.findByText('本构建未捆绑模型')).toBeInTheDocument();
  expect(screen.getByText('内置来源')).toBeInTheDocument();
  expect(screen.getByText('偏好开启')).toBeInTheDocument();
  expect(screen.getByText('当前使用关键词')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '改用内置模型' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '重建当前作品索引' })).toBeDisabled();
});
it('内置待验分别显示文件校验和资格，已开启偏好仍可停用', async () => {
  const candidate: RetrievalModelStatus = { ...status, state: 'disabled', installed: true, source: 'bundled', bundledPresent: true, enabled: true, message: undefined };
  const api = { getRetrievalModelStatus: async () => candidate, setRetrievalModelEnabled: async (enabled: boolean) => ({ ...candidate, enabled }) };
  render(<RetrievalModelPanel api={api} busy={false} workId="work" />);
  expect(await screen.findByText('内置模型待验收，当前使用关键词')).toBeInTheDocument();
  expect(screen.getByText('文件校验通过')).toBeInTheDocument();
  expect(screen.getByText('资格待核验')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '停用语义检索' }));
  expect(await screen.findByText('偏好停用')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '启用语义检索' })).toBeDisabled();
});
it('旧禁用来源说明保留，不把资格状态当作作者主动停用', async () => {
  render(<RetrievalModelPanel api={{ getRetrievalModelStatus: async () => ({ ...status, source: 'user', installed: true, state: 'disabled', enabled: false, legacyDisabled: true, bundledPresent: true }) }} busy={false} workId="work" />);
  expect(await screen.findByText(/保留旧禁用记录/)).toBeInTheDocument();
  expect(screen.getByText('手动副本')).toBeInTheDocument();
  expect(screen.getByText('偏好停用')).toBeInTheDocument();
});
it('可用内置只读无需下载，键盘可显式选择手动来源且保持停用偏好', async () => {
  const user = userEvent.setup();
  const bundled: RetrievalModelStatus = { ...status, source: 'bundled', bundledPresent: true, state: 'ready', installed: true, qualified: true, enabled: true, message: undefined };
  const api = { getRetrievalModelStatus: async () => bundled, selectRetrievalModelSource: async ({ source }: { source: 'bundled' | 'user' }) => ({ ...bundled, source, state: 'disabled' as const, enabled: false }) };
  render(<RetrievalModelPanel api={api} busy={false} workId="work" />);
  expect(await screen.findByText(/内置模型直接读取安装资源，无需重新下载/)).toBeInTheDocument();
  expect(screen.getByText('语义检索可用')).toBeInTheDocument();
  expect(screen.getByText('索引状态未读取，查询时显示进度')).toBeInTheDocument();
  const button = screen.getByRole('button', { name: '改用手动副本' }); button.focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByText('手动副本')).toBeInTheDocument();
  expect(screen.getByText('偏好停用')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重建当前作品索引' })).toBeDisabled();
});
it('手动来源损坏不显示语义可用，换源失败保留当前来源和偏好', async () => {
  const damaged: RetrievalModelStatus = { ...status, state: 'error', source: 'user', bundledPresent: true, qualified: true, enabled: false, message: '手动副本损坏' };
  const api = { getRetrievalModelStatus: async () => damaged, selectRetrievalModelSource: async () => { throw new Error('内置模型校验失败'); } };
  render(<RetrievalModelPanel api={api} busy={false} workId="work" />);
  await screen.findByText('手动副本损坏');
  expect(screen.queryByText('语义检索可用')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '改用内置模型' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('内置模型校验失败');
  expect(screen.getByText('手动副本')).toBeInTheDocument();
  expect(screen.getByText('偏好停用')).toBeInTheDocument();
});
it('来源切换未完成时锁住维护操作，完成后显示经校验的新来源', async () => {
  let complete!: (value: RetrievalModelStatus) => void;
  const damaged: RetrievalModelStatus = { ...status, state: 'error', source: 'user', bundledPresent: true, enabled: false };
  const api = { getRetrievalModelStatus: async () => damaged, selectRetrievalModelSource: () => new Promise<RetrievalModelStatus>(resolve => { complete = resolve; }), importRetrievalModel: async () => status };
  render(<RetrievalModelPanel api={api} busy={false} workId="work" />);
  fireEvent.click(await screen.findByRole('button', { name: '改用内置模型' }));
  expect(screen.getByRole('button', { name: '导入本机模型目录' })).toBeDisabled();
  await act(async () => complete({ ...damaged, source: 'bundled', installed: true, state: 'disabled' }));
  expect(screen.getByText('内置来源')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '导入本机模型目录' })).toBeEnabled();
});
