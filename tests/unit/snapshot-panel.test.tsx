// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapshotPanel } from '../../src/renderer/components/snapshot-panel';

afterEach(cleanup);
const item = { id: 'old', title: '第一稿', kind: 'manual' as const, createdAt: '2026-10-09T01:00:00Z', sourceSnapshotId: null, sourceRevision: 2, schemaVersion: 1 };
function setup(overrides = {}) {
  const props = { busy: false, revision: 3, onList: vi.fn(async () => [item]), onCreate: vi.fn(async () => true), onRestore: vi.fn(async () => true),
    onPreview: vi.fn(async () => ({ summary: item, title: '雨', chapterCount: 2, volumeCount: 1, wordCount: 30, chapters: [{ id: 'one', title: '开篇', wordCount: 30 }], knowledgeCount: 1, foreshadowCount: 2 })), ...overrides };
  render(<SnapshotPanel {...props} />); return props;
}
describe('快照面板', () => {
  it('列表可直接导出历史TXT和DOCX，不触发预览恢复；失败后可重试', async () => {
    const user = userEvent.setup(), onExport = vi.fn().mockRejectedValueOnce(new Error('磁盘不可写')).mockResolvedValue(true);
    const props = setup({ onExport });
    await user.click(await screen.findByRole('button', { name: '导出快照 TXT：第一稿' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘不可写');
    await user.click(screen.getByRole('button', { name: '导出快照 TXT：第一稿' }));
    await user.click(screen.getByRole('button', { name: '导出快照 DOCX：第一稿' }));
    expect(onExport.mock.calls).toEqual([['old', 'txt'], ['old', 'txt'], ['old', 'docx']]);
    expect(props.onRestore).not.toHaveBeenCalled(); expect(props.onPreview).not.toHaveBeenCalled();
  });
  it('创建手动快照后刷新列表，空名称不能提交', async () => {
    const user = userEvent.setup(), props = setup();
    await screen.findByText('第一稿');
    expect(screen.getByRole('button', { name: '创建快照' })).toBeDisabled();
    await user.type(screen.getByLabelText('快照名称'), '修改之前');
    await user.click(screen.getByRole('button', { name: '创建快照' }));
    expect(props.onCreate).toHaveBeenCalledWith('修改之前');
    await waitFor(() => expect(props.onList).toHaveBeenCalledTimes(2));
  });
  it('预览卷章规模后明确确认，点击取消不恢复', async () => {
    const user = userEvent.setup(), props = setup();
    await user.click(await screen.findByRole('button', { name: '预览并恢复：第一稿' }));
    expect(await screen.findByText('开篇')).toBeInTheDocument();
    expect(screen.getByText(/保留当前状态和全部历史/)).toBeInTheDocument();
    expect(props.onRestore).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(props.onRestore).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '预览并恢复：第一稿' }));
    await user.click(await screen.findByRole('button', { name: '恢复为新版本' }));
    expect(props.onRestore).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认恢复' }));
    expect(props.onRestore).toHaveBeenCalledWith('old');
  });
  it('预览失败提示重试并禁止恢复，失败创建保留输入', async () => {
    const user = userEvent.setup(), props = setup({ onPreview: vi.fn(async () => { throw new Error('快照校验失败'); }), onCreate: vi.fn(async () => false) });
    await user.click(await screen.findByRole('button', { name: '预览并恢复：第一稿' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('快照校验失败');
    expect(screen.queryByRole('button', { name: '恢复为新版本' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('快照名称'), '草稿');
    await user.click(screen.getByRole('button', { name: '创建快照' }));
    expect(screen.getByLabelText('快照名称')).toHaveValue('草稿');
    expect(props.onRestore).not.toHaveBeenCalled();
  });
});
