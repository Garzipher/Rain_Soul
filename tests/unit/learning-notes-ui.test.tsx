// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KnowledgeWorkspace } from '../../src/renderer/components/knowledge-workspace';
import type { AssetState } from '../../src/shared/assets';
import type { WorkDetail } from '../../src/shared/contracts';
const note = { technique: '以重复动作承载情绪', usage: '读完旧信后的克制难过', exercise: '折一张协议纸，避免照搬原句' };
const assets = { outlines: [], foreshadows: [], evidence: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null, tags: [],
  categories: [{ id: 'c', name: '内心描写', parentId: null, sortOrder: 0, systemKey: null, deletedAt: null }],
  knowledge: [{ id: 'k', body: '她把信折了两遍。', source: '原创练习', categoryId: 'c', tagIds: [], origin: null, revision: 1, deletedAt: null, learningNotes: [note] }] } as AssetState;
const work: WorkDetail = { id: 'work', title: '末班渡船', revision: 2, chapters: [], volumes: [], deletedItems: [], assets };
afterEach(cleanup);
it('收起仅呈现原句，展开可阅读手法场景练习，选参考说明附带注释', () => {
  render(<KnowledgeWorkspace work={work} assets={assets} busy={false} onAction={vi.fn()} onSearch={async () => []} onLocate={vi.fn()} onToggleReference={vi.fn()} />);
  expect(screen.queryByText(note.technique)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /展开知识/ }));
  for (const text of Object.values(note)) expect(screen.getByText(text)).toBeVisible();
  expect(screen.getByText(/选作参考时附带/)).toBeVisible();
});
it('编辑已有注释逐项填写，保存后发送独立注释，失败保留输入', async () => {
  const onAction = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<KnowledgeWorkspace work={work} assets={assets} busy={false} onAction={onAction} onSearch={async () => []} onLocate={vi.fn()} />);
  fireEvent.click(screen.getByLabelText(/^知识操作：/)); fireEvent.click(screen.getByRole('button', { name: '编辑知识' }));
  expect(screen.getByLabelText('写作手法 1')).toHaveValue(note.technique); expect(screen.getByLabelText('适用场景 1')).toHaveValue(note.usage);
  fireEvent.change(screen.getByLabelText('适用场景 1'), { target: { value: '重逢场景' } });
  fireEvent.click(screen.getByRole('button', { name: '保存知识' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/未完成/); expect(screen.getByLabelText('适用场景 1')).toHaveValue('重逢场景');
  fireEvent.click(screen.getByRole('button', { name: '保存知识' }));
  await waitFor(() => expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'updateKnowledge', body: '她把信折了两遍。', learningNotes: [{ ...note, usage: '重逢场景' }] })));
});
it('可添加学习注释；移除全部已有注释会明确发送清空请求', async () => {
  const onAction = vi.fn(async () => true);
  render(<KnowledgeWorkspace work={work} assets={assets} busy={false} onAction={onAction} onSearch={async () => []} onLocate={vi.fn()} />);
  fireEvent.click(screen.getByLabelText(/^知识操作：/)); fireEvent.click(screen.getByRole('button', { name: '编辑知识' }));
  fireEvent.click(screen.getByRole('button', { name: '添加学习注释' }));
  expect(screen.getByLabelText('写作手法 2')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: '移除学习注释 2' }));
  fireEvent.click(screen.getByRole('button', { name: '移除学习注释 1' }));
  fireEvent.click(screen.getByRole('button', { name: '保存知识' }));
  await waitFor(() => expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'updateKnowledge', learningNotes: [] })));
});
it('取消编辑不写库，再次编辑仍保留原学习注释', () => {
  const onAction = vi.fn();
  render(<KnowledgeWorkspace work={work} assets={assets} busy={false} onAction={onAction} onSearch={async () => []} onLocate={vi.fn()} />);
  fireEvent.click(screen.getByLabelText(/^知识操作：/)); fireEvent.click(screen.getByRole('button', { name: '编辑知识' }));
  fireEvent.change(screen.getByLabelText('写作手法 1'), { target: { value: '这次不保存的理解' } });
  fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));
  expect(onAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText(/^知识操作：/)); fireEvent.click(screen.getByRole('button', { name: '编辑知识' }));
  expect(screen.getByLabelText('写作手法 1')).toHaveValue(note.technique);
  expect(assets.knowledge[0].learningNotes).toEqual([note]);
});
