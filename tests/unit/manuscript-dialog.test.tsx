// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { chooseSelect } from './select-field-helper';
import { afterEach, expect, it, vi } from 'vitest';
import { ManuscriptDialog } from '../../src/renderer/components/manuscript-dialog';
afterEach(cleanup);
const draft = { title: '旧稿', format: 'docx' as const, encoding: null, warnings: [{ code: 'images', message: '图片不导入', count: 2 }], chapters: [{ title: '第一章', volumeTitle: null, paragraphs: ['雨夜来信。'] }] };
it('预览原正文与丢弃内容提示，修改标题后确认才创建，失败保留编辑', async () => {
  const confirm = vi.fn(async () => false);
  render(<ManuscriptDialog draft={draft} busy={false} onConfirm={confirm} onClose={() => {}} />);
  expect(screen.getByText('图片不导入')).toBeInTheDocument();
  expect(screen.getByText('雨夜来信。')).toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('导入作品名称'), { target: { value: '新稿' } });
  fireEvent.change(screen.getByLabelText('导入章节 1 标题'), { target: { value: '第一封信' } });
  fireEvent.click(screen.getByRole('button', { name: '创建新作品' }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '新稿', chapters: [{ title: '第一封信', volumeTitle: null, paragraphs: ['雨夜来信。'] }] })));
  expect(screen.getByLabelText('导入作品名称')).toHaveValue('新稿');
});
it('按段落边界拆章保留空段及全部原文，新章标题可修改后相邻合并', async () => {
  const original = { ...draft, chapters: [{ title: '原章', volumeTitle: '第一卷', paragraphs: ['第一段', '', '第三段', '第四段'] }] }, confirm = vi.fn(async () => false);
  render(<ManuscriptDialog draft={original} busy={false} onConfirm={confirm} onClose={() => {}} />);
  await chooseSelect(screen.getByLabelText('第 1 章拆章位置'), /第 2 段之后/);
  fireEvent.click(screen.getByRole('button', { name: '拆分第 1 章' }));
  expect(screen.getByLabelText('导入章节 2 分卷')).toHaveValue('第一卷');
  fireEvent.change(screen.getByLabelText('导入章节 2 标题'), { target: { value: '作者指定新章' } });
  fireEvent.click(screen.getByRole('button', { name: '创建新作品' }));
  await waitFor(() => expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ chapters: [
    { title: '原章', volumeTitle: '第一卷', paragraphs: ['第一段', ''] }, { title: '作者指定新章', volumeTitle: '第一卷', paragraphs: ['第三段', '第四段'] },
  ] })));
  fireEvent.click(screen.getByRole('button', { name: '第 1 章合并下一章' }));
  fireEvent.click(screen.getByRole('button', { name: '创建新作品' }));
  await waitFor(() => expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ chapters: original.chapters })));
  expect(original.chapters[0].paragraphs).toEqual(['第一段', '', '第三段', '第四段']);
});
it('章节上移下移保留正文与分卷，首尾和不可拆章节禁止操作', async () => {
  const original = { ...draft, chapters: [
    { title: '首章', volumeTitle: null, paragraphs: ['甲'] }, { title: '中章', volumeTitle: null, paragraphs: ['乙', '丙'] }, { title: '尾章', volumeTitle: '卷三', paragraphs: ['丁'] },
  ] }, confirm = vi.fn(async () => false);
  render(<ManuscriptDialog draft={original} busy={false} onConfirm={confirm} onClose={() => {}} />);
  expect(screen.getByRole('button', { name: '上移第 1 章' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '下移第 3 章' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '拆分第 1 章' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '第 3 章合并下一章' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '上移第 2 章' }));
  expect(screen.getByLabelText('导入章节 1 标题')).toHaveValue('中章');
  expect(screen.getByLabelText('导入章节 1 分卷')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: '创建新作品' }));
  await waitFor(() => expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ chapters: [original.chapters[1], original.chapters[0], original.chapters[2]] })));
  fireEvent.click(screen.getByRole('button', { name: '下移第 1 章' }));
  fireEvent.click(screen.getByRole('button', { name: '创建新作品' }));
  await waitFor(() => expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ chapters: original.chapters })));
});
it('首屏预览按无卷优先及同名卷聚合，同卷章序保持稳定且禁止跨卷移动', async () => {
  const chapters = [
    { title: '卷一甲', volumeTitle: '卷一', paragraphs: ['甲', ''] }, { title: '卷二乙', volumeTitle: '卷二', paragraphs: ['乙'] },
    { title: '无卷丙', volumeTitle: null, paragraphs: ['丙'] }, { title: '卷一丁', volumeTitle: '卷一', paragraphs: ['丁'] },
  ], confirm = vi.fn(async () => false);
  render(<ManuscriptDialog draft={{ ...draft, chapters }} busy={false} onConfirm={confirm} onClose={() => {}} />);
  expect(screen.getByLabelText('导入章节 1 标题')).toHaveValue('无卷丙');
  expect(screen.getByLabelText('导入章节 2 标题')).toHaveValue('卷一甲');
  expect(screen.getByLabelText('导入章节 3 标题')).toHaveValue('卷一丁');
  expect(screen.getByRole('button', { name: '下移第 1 章' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '上移第 2 章' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '下移第 3 章' })).toBeDisabled();
  expect(screen.getByText(/无分卷章节在前，同名分卷聚合/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '创建新作品' }));
  await waitFor(() => expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ chapters: [chapters[2], chapters[0], chapters[3], chapters[1]] })));
  expect(chapters.map(item => item.title)).toEqual(['卷一甲', '卷二乙', '无卷丙', '卷一丁']);
});
it('卷名编辑完成后按正式规则重排，空卷名归无卷，提交顺序与预览一致', async () => {
  const chapters = [
    { title: '甲', volumeTitle: '卷一', paragraphs: ['甲', ''] }, { title: '乙', volumeTitle: '卷二', paragraphs: ['乙'] }, { title: '丙', volumeTitle: '卷三', paragraphs: ['丙'] },
  ], confirm = vi.fn(async () => false);
  render(<ManuscriptDialog draft={{ ...draft, chapters }} busy={false} onConfirm={confirm} onClose={() => {}} />);
  const movingInput = screen.getByLabelText('导入章节 3 分卷');
  fireEvent.change(movingInput, { target: { value: ' 卷一 ' } });
  fireEvent.blur(movingInput);
  expect(screen.getByLabelText('导入章节 2 标题')).toHaveValue('丙');
  expect(screen.getByLabelText('导入章节 2 分卷')).toHaveValue('卷一');
  expect(screen.getByLabelText('导入章节 2 分卷')).toBe(movingInput);
  fireEvent.change(screen.getByLabelText('导入章节 3 分卷'), { target: { value: '   ' } });
  fireEvent.blur(screen.getByLabelText('导入章节 3 分卷'));
  expect(screen.getByLabelText('导入章节 1 标题')).toHaveValue('乙');
  fireEvent.click(screen.getByRole('button', { name: '创建新作品' }));
  await waitFor(() => expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ chapters: [{ ...chapters[1], volumeTitle: null }, chapters[0], { ...chapters[2], volumeTitle: '卷一' }] })));
});
it('导入忙碌时全部编辑和结构操作禁用，不接收拆章、排序或合并', () => {
  const confirm = vi.fn(async () => true), chapters = [{ title: '首章', volumeTitle: null, paragraphs: ['甲', '乙'] }, { title: '尾章', volumeTitle: null, paragraphs: ['丙'] }];
  render(<ManuscriptDialog draft={{ ...draft, chapters }} busy onConfirm={confirm} onClose={() => {}} />);
  for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('textbox'), ...screen.getAllByRole('combobox')]) expect(control).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '拆分第 1 章' }));
  fireEvent.click(screen.getByRole('button', { name: '第 1 章合并下一章' }));
  expect(screen.getByLabelText('导入章节 1 标题')).toHaveValue('首章');
  expect(confirm).not.toHaveBeenCalled();
});
