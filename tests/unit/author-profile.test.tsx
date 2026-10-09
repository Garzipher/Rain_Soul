// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthorProfile } from '../../src/renderer/hooks/use-author-profile';
import { ProfileSettings } from '../../src/renderer/components/profile-settings';
import { Sidebar } from '../../src/renderer/components/sidebar';
import { createAdapter } from './renderer-adapter';

afterEach(cleanup);
describe('个人资料交互', () => {
  function harness(api = createAdapter().api) {
    function View() { const author = useAuthorProfile(api); return <><span data-testid="name">{author.profile?.penName}</span><ProfileSettings author={author} /></>; }
    return { api, render: () => render(<View />) };
  }
  it('加载本机资料，名称提交成功后更新显示', async () => {
    const { api, render: show } = harness();
    api.getAuthorProfile = vi.fn(async () => ({ penName: '雨魂', avatarDataUrl: null }));
    api.setPenName = vi.fn(async value => ({ penName: value.trim(), avatarDataUrl: null }));
    show();
    expect(await screen.findByDisplayValue('雨魂')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '新作者' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('新作者'));
    expect(api.setPenName).toHaveBeenCalledWith('新作者');
  });
  it('提交失败保留输入和旧资料，能够重试', async () => {
    const { api, render: show } = harness();
    api.getAuthorProfile = vi.fn(async () => ({ penName: '旧名', avatarDataUrl: null }));
    api.setPenName = vi.fn().mockRejectedValueOnce(new Error('磁盘满')).mockResolvedValueOnce({ penName: '新名', avatarDataUrl: null });
    show(); await screen.findByDisplayValue('旧名');
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '新名' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘满');
    expect(screen.getByTestId('name')).toHaveTextContent('旧名');
    expect(screen.getByLabelText('显示名称')).toHaveValue('新名');
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('新名'));
  });
  it('加载失败显示明确错误，禁止覆盖并提供重试读取', async () => {
    const { api, render: show } = harness();
    api.getAuthorProfile = vi.fn().mockRejectedValueOnce(new Error('文件损坏')).mockResolvedValueOnce({ penName: '修复后', avatarDataUrl: null });
    show(); expect(await screen.findByRole('alert')).toHaveTextContent('文件损坏');
    expect(screen.getByRole('button', { name: '上传头像' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新读取资料' }));
    expect(await screen.findByDisplayValue('修复后')).toBeInTheDocument();
  });
  it('头像选择时禁止重复提交，完成后允许移除', async () => {
    const { api, render: show } = harness();
    let complete!: (value: { penName: string; avatarDataUrl: string }) => void;
    api.chooseAvatar = vi.fn(() => new Promise<{ penName: string; avatarDataUrl: string }>(resolve => { complete = resolve; }));
    api.clearAvatar = vi.fn(async () => ({ penName: '', avatarDataUrl: null }));
    show(); await screen.findByLabelText('显示名称');
    fireEvent.click(screen.getByRole('button', { name: '上传头像' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '上传头像' })).toBeDisabled());
    complete({ penName: '', avatarDataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(await screen.findByRole('img', { name: '作者头像' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除头像' }));
    await waitFor(() => expect(screen.queryByRole('img', { name: '作者头像' })).not.toBeInTheDocument());
  });
  it('侧栏直接显示名称且允许原位修改，不显示笔名标签', async () => {
    const api = createAdapter().api;
    api.getAuthorProfile = vi.fn(async () => ({ penName: '侧栏作者', avatarDataUrl: null }));
    api.setPenName = vi.fn(async penName => ({ penName, avatarDataUrl: null }));
    function View() { const author = useAuthorProfile(api); return <Sidebar expanded page="shelf" onToggle={() => {}} onNavigate={() => {}} author={author} />; }
    render(<View />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑显示名称：侧栏作者' }));
    const input = screen.getByLabelText('修改显示名称');
    fireEvent.change(input, { target: { value: '改名作者' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: '编辑显示名称：改名作者' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑显示名称：改名作者' })).toHaveFocus());
    expect(screen.queryByText('笔名')).not.toBeInTheDocument();
  });
  it('侧栏名称保存失败时保留输入，Escape可取消', async () => {
    const api = createAdapter().api;
    api.getAuthorProfile = vi.fn(async () => ({ penName: '原作者', avatarDataUrl: null }));
    api.setPenName = vi.fn().mockRejectedValue(new Error('保存失败'));
    function View() { const author = useAuthorProfile(api); return <Sidebar expanded page="shelf" onToggle={() => {}} onNavigate={() => {}} author={author} />; }
    render(<View />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑显示名称：原作者' }));
    const input = screen.getByLabelText('修改显示名称');
    fireEvent.change(input, { target: { value: '新作者' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
    expect(input).toHaveValue('新作者');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: '编辑显示名称：原作者' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑显示名称：原作者' })).toHaveFocus();
  });
});
