// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetState } from '../../src/shared/assets';
import { KnowledgeDictionary } from '../../src/renderer/components/knowledge-dictionary';

afterEach(cleanup);
const assets: AssetState = {
  outlines: [], foreshadows: [], evidence: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null,
  categories: [
    { id: 'unc', name: '未分类', parentId: null, sortOrder: 0, systemKey: 'uncategorized', deletedAt: null },
    { id: 'scene', name: '景物描写', parentId: null, sortOrder: 1, systemKey: null, deletedAt: null },
    { id: 'weather', name: '天气', parentId: 'scene', sortOrder: 0, systemKey: null, deletedAt: null },
  ],
  tags: [{ id: 'rain', name: '雨夜', deletedAt: null }, { id: 'mood', name: '情绪', deletedAt: null }],
  knowledge: [{ id: 'entry', body: '雨落在旧站台。', source: '练习', categoryId: 'weather', tagIds: ['rain'], revision: 1, origin: null, deletedAt: null }],
};
function setup(onAction = vi.fn(async () => true), onDirtyChange = vi.fn()) {
  render(<KnowledgeDictionary assets={assets} busy={false} onAction={onAction} onDirtyChange={onDirtyChange} />);
  return { onAction, onDirtyChange };
}

describe('知识分类字典', () => {
  it('分类按层级和排序显示；同级边界禁用，排序失败保留原顺序', async () => {
    const onAction = vi.fn(async () => false);
    const scrambled = { ...assets, categories: [...assets.categories].reverse() };
    render(<KnowledgeDictionary assets={scrambled} busy={false} onAction={onAction} />);
    expect(screen.getAllByRole('button', { name: /^编辑分类：/ }).map(button => button.textContent)).toEqual(['编辑分类：未分类', '编辑分类：景物描写', '编辑分类：天气']);
    expect(screen.getByRole('button', { name: '上移分类：未分类' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下移分类：景物描写' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '上移分类：天气' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下移分类：天气' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '上移分类：景物描写' }));
    await screen.findByRole('alert');
    expect(onAction).toHaveBeenCalledWith({ type: 'moveCategory', id: 'scene', direction: 'up' });
    expect(screen.getAllByRole('button', { name: /^编辑分类：/ }).map(button => button.textContent)).toEqual(['编辑分类：未分类', '编辑分类：景物描写', '编辑分类：天气']);
  });
  it('有分类草稿时禁用排序，取消草稿后可下移同级分类', async () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByRole('button', { name: '编辑分类：景物描写' }));
    fireEvent.change(screen.getByLabelText('分类名称'), { target: { value: '保留草稿' } });
    expect(screen.getByRole('button', { name: '下移分类：未分类' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '下移分类：未分类' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'moveCategory', id: 'unc', direction: 'down' }));
  });
  it('外层存在待重试操作时禁用全部编辑，保留失败原稿', () => {
    const props = { assets, busy: false, onAction: vi.fn(async () => false) };
    const view = render(<KnowledgeDictionary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '新增分类' }));
    fireEvent.change(screen.getByLabelText('分类名称'), { target: { value: '保留原稿' } });
    view.rerender(<KnowledgeDictionary {...props} busy />);
    expect(screen.getByLabelText('分类名称')).toBeDisabled();
    expect(screen.getByLabelText('分类名称')).toHaveValue('保留原稿');
    expect(screen.getByRole('button', { name: '编辑分类：天气' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '新增标签' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存分类' })).toBeDisabled();
  });
  it('删除确认聚焦取消按钮，Tab限制在确认内，Escape关闭并返回触发按钮', () => {
    setup(); const trigger = screen.getByRole('button', { name: '删除分类：天气' }); trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog'), cancel = within(dialog).getByRole('button', { name: '取消' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(within(dialog).getByLabelText('迁移到分类')).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  });
  it('可新增并编辑层级分类，编辑失败保留内容与 dirty 状态', async () => {
    const onAction = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { onDirtyChange } = setup(onAction);
    fireEvent.click(screen.getByRole('button', { name: '新增分类' }));
    fireEvent.change(screen.getByLabelText('分类名称'), { target: { value: '人物描写' } });
    fireEvent.change(screen.getByLabelText('上级分类'), { target: { value: 'scene' } });
    fireEvent.click(screen.getByRole('button', { name: '保存分类' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/失败|未完成/);
    expect(screen.getByLabelText('分类名称')).toHaveValue('人物描写');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '保存分类' }));
    await waitFor(() => expect(screen.queryByLabelText('分类名称')).not.toBeInTheDocument());
    expect(onAction).toHaveBeenLastCalledWith({ type: 'createCategory', name: '人物描写', parentId: 'scene' });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('“未分类”不可删除；存在子分类时提示先处理子分类', () => {
    setup();
    expect(screen.getByRole('button', { name: '删除分类：未分类' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '删除分类：景物描写' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/子分类.*先处理/);
  });

  it('有知识条目的分类须先选迁移目标，确认后执行迁移删除', async () => {
    const onAction = vi.fn(async () => true); setup(onAction);
    fireEvent.click(screen.getByRole('button', { name: '删除分类：天气' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('迁移到分类'), { target: { value: 'unc' } });
    fireEvent.click(screen.getByRole('button', { name: '确认迁移并删除分类' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'deleteCategory', id: 'weather', destinationId: 'unc' }));
  });
});

describe('知识标签字典', () => {
  it('删除已使用标签前确认，成功后提示只解除标签关系', async () => {
    const onAction = vi.fn(async () => true); setup(onAction);
    fireEvent.click(screen.getByRole('button', { name: '删除标签：雨夜' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/解除关联/);
    fireEvent.click(screen.getByRole('button', { name: '确认删除标签' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'deleteTag', id: 'rain' }));
  });

  it('可新增标签；重复或空白名称不提交', async () => {
    const onAction = vi.fn(async () => true); setup(onAction);
    fireEvent.click(screen.getByRole('button', { name: '新增标签' }));
    fireEvent.change(screen.getByLabelText('标签名称'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存标签' }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('标签名称'), { target: { value: '雨夜' } });
    expect(screen.getByRole('button', { name: '保存标签' })).toBeDisabled();
  });
});
