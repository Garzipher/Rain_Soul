// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { chooseSelect } from './select-field-helper';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KnowledgeCopyDialog, prepareKnowledgeCopy } from '../../src/renderer/components/knowledge-copy-dialog';
import type { WorkDetail } from '../../src/shared/contracts';
import type { KnowledgeOwner, KnowledgeScope } from '../../src/shared/knowledge-scope';
import { auditedKnowledgeSource } from './knowledge-source-helper';

afterEach(cleanup);
it('复制预览展示可读出处，不展开完整审计上下文，不修改待复制原始条目', () => {
  const custom = structuredClone(source), audit = auditedKnowledgeSource('原作第2章'); custom.knowledge[0].source = audit.source;
  render(<KnowledgeCopyDialog preview={prepareKnowledgeCopy(target, custom, owner)} busy={false} onConfirm={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('出处：原作第2章');
  expect(screen.getByRole('dialog')).not.toHaveTextContent('上下文独有秘词');
  expect(custom.knowledge[0].source).toBe(audit.source);
});
const owner: KnowledgeOwner = { workId: 'source', workTitle: '参考作品', sourceRevision: 4, sourceEntryId: 'entry' };
const source: KnowledgeScope = {
  categories: [{ id: 'source-category', name: '描写', parentId: null, sortOrder: 0, systemKey: null, deletedAt: null }],
  tags: [{ id: 'source-tag', name: '雨夜', deletedAt: null }, { id: 'missing', name: '内心', deletedAt: null }],
  knowledge: [{ id: 'entry', body: '雨落旧站台。', source: '原作第2章', categoryId: 'source-category', tagIds: ['source-tag', 'missing'], revision: 4, origin: null, deletedAt: null }],
  entryOwners: { entry: owner },
};
const target: WorkDetail = { id: 'target', title: '当前作品', revision: 3, chapters: [], volumes: [], deletedItems: [], assets: {
  outlines: [], foreshadows: [], evidence: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null, knowledge: [],
  categories: [{ id: 'unc', name: '未分类', parentId: null, sortOrder: 0, systemKey: 'uncategorized', deletedAt: null }, { id: 'scene', name: '景物描写', parentId: null, sortOrder: 1, systemKey: null, deletedAt: null }],
  tags: [{ id: 'target-tag', name: '雨夜', deletedAt: null }, { id: 'extra', name: '情绪', deletedAt: null }],
} };
function setup(onConfirm = vi.fn(async () => true)) {
  const onClose = vi.fn();
  render(<KnowledgeCopyDialog preview={prepareKnowledgeCopy(target, source, owner)} busy={false} onConfirm={onConfirm} onClose={onClose} />);
  return { onConfirm, onClose };
}
it('复制是普通确认操作，使用主色按钮而非删除警示色', () => {
  setup();
  expect(screen.getByRole('button', { name: '确认复制' })).toHaveClass('primary');
  expect(screen.getByRole('button', { name: '确认复制' })).not.toHaveClass('delete-button');
});
it('预览内容出处及两端字典；标签按名称匹配目标ID，未匹配不创建', async () => {
  const { onConfirm } = setup();
  expect(screen.getByRole('dialog')).toHaveTextContent('雨落旧站台。');
  expect(screen.getByRole('dialog')).toHaveTextContent('原作第2章');
  expect(screen.getByRole('dialog')).toHaveTextContent('内心');
  expect(screen.getByRole('dialog')).toHaveTextContent('请先在设置维护');
  expect(screen.getByRole('checkbox', { name: '雨夜' })).toBeChecked();
  await chooseSelect(screen.getByLabelText('目标主分类'), '景物描写');
  fireEvent.click(screen.getByRole('checkbox', { name: '情绪' }));
  fireEvent.click(screen.getByRole('button', { name: '确认复制' }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('scene', ['target-tag', 'extra']));
});
it('取消不提交，失败保留分类和标签选择并可重试', async () => {
  const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const { onClose } = setup(confirm);
  await chooseSelect(screen.getByLabelText('目标主分类'), '景物描写');
  fireEvent.click(screen.getByRole('button', { name: '确认复制' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('选择已保留');
  expect(screen.getByLabelText('目标主分类')).toHaveTextContent('景物描写');
  expect(screen.getByRole('checkbox', { name: '雨夜' })).toBeChecked();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(confirm).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledOnce();
});
it('重复确认只提交一次，处理过程中不能取消', async () => {
  let finish!: (value: boolean) => void;
  const confirm = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const { onClose } = setup(confirm);
  const button = screen.getByRole('button', { name: '确认复制' });
  fireEvent.click(button); fireEvent.click(button);
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  finish(true); await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
it('拒绝已更新/删除的来源和没有活动目标分类的字典', () => {
  expect(() => prepareKnowledgeCopy(target, source, { ...owner, sourceRevision: 2 })).toThrow('来源作品已变化');
  expect(() => prepareKnowledgeCopy(target, { ...source, knowledge: [] }, owner)).toThrow('来源知识');
  expect(() => prepareKnowledgeCopy({ ...target, assets: { ...target.assets!, categories: [] } }, source, owner)).toThrow('目标分类');
});
