// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetState, SearchResult } from '../../src/shared/assets';
import type { WorkDetail } from '../../src/shared/contracts';
import { KnowledgeWorkspace } from '../../src/renderer/components/knowledge-workspace';
import { auditedKnowledgeSource } from './knowledge-source-helper';

afterEach(cleanup);
const work: WorkDetail = { id: 'work', title: '雨落之后', revision: 1, chapters: [], volumes: [], deletedItems: [] };
const assets: AssetState = { outlines: [], foreshadows: [], evidence: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null,
  categories: [{ id: 'unc', name: '未分类', parentId: null, sortOrder: 0, systemKey: 'uncategorized', deletedAt: null }, { id: 'scene', name: '景物描写', parentId: null, sortOrder: 1, systemKey: null, deletedAt: null }],
  tags: [{ id: 'rain', name: '雨 夜', deletedAt: null }, { id: 'city', name: '城市', deletedAt: null }],
  knowledge: [{ id: 'a', body: '站台的雨水映着微弱的灯光。\n雨落在伞边，滴答作响。', source: '雨夜练习', categoryId: 'scene', tagIds: ['rain', 'city'], revision: 1, origin: null, deletedAt: null },
    { id: 'b', body: '月光流过石阶。', source: '另一篇练习', categoryId: 'unc', tagIds: ['rain'], revision: 1, origin: null, deletedAt: null }] };
function setup(options: Partial<React.ComponentProps<typeof KnowledgeWorkspace>> = {}) {
  const onAction = vi.fn(async () => true), onSearch = vi.fn(async (): Promise<SearchResult[]> => []), onDirtyChange = vi.fn();
  const props = { work, assets, busy: false, onAction, onSearch, onDirtyChange, onLocate: vi.fn(), ...options };
  return { ...props, view: render(<KnowledgeWorkspace {...props} />) };
}
describe('知识卡片与搜索', () => {
  it('书签指定的知识原位展开并聚焦，可继续编辑当前作品内容', async () => {
    setup({ selectedEntryId: 'a' });
    const card = await screen.findByRole('button', { name: /收起知识：站台/ });
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(card.closest('article')).toHaveFocus();
  });
  it('无额外卡片标题，最多两行摘要原位展开，出处和标签保留', () => {
    setup();
    const card = screen.getByRole('button', { name: /展开知识：站台/ });
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(card).toHaveClass('is-collapsed');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(card).not.toHaveClass('is-collapsed');
    expect(screen.getByText('雨夜练习')).toBeInTheDocument();
    expect(screen.queryByText('条目详情')).not.toBeInTheDocument();
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-expanded', 'false');
  });
  it('标签按 AND 筛选，内空格保留；知识页不新增标签', () => {
    setup();
    const filters = screen.getByRole('group', { name: '标签筛选' });
    fireEvent.click(within(filters).getByRole('button', { name: '雨 夜' }));
    expect(screen.getAllByRole('button', { name: /展开知识/ })).toHaveLength(2);
    fireEvent.click(within(filters).getByRole('button', { name: '城市' }));
    expect(screen.getAllByRole('button', { name: /展开知识/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '添加标签' })).not.toBeInTheDocument();
  });
  it('分类可收起，筛选和清空时仍遵守已选分类', () => {
    setup(); fireEvent.click(screen.getByRole('button', { name: '景物描写' }));
    expect(screen.queryByText('月光流过石阶。')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起分类' }));
    expect(screen.queryByRole('navigation', { name: '知识分类' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开分类' }));
    expect(screen.getByRole('navigation', { name: '知识分类' })).toBeInTheDocument();
  });
  it('旧慢搜索不能覆盖新结果，全文结果标注来源并定位章段', async () => {
    let old!: (rows: SearchResult[]) => void;
    const onSearch = vi.fn((query) => query.text === '旧' ? new Promise<SearchResult[]>(resolve => { old = resolve; }) : Promise.resolve([{ id: 'p', kind: 'paragraph' as const, chapterId: 'chapter', paragraphId: 'paragraph', title: '旧站台', snippet: '新的雨声', source: '雨落之后 / 旧站台' }]));
    const { onLocate } = setup({ onSearch });
    fireEvent.change(screen.getByLabelText('搜索范围'), { target: { value: 'all' } });
    fireEvent.change(screen.getByRole('searchbox', { name: '模糊搜索知识与正文' }), { target: { value: '旧' } });
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ text: '旧', mode: 'all' })));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '新' } });
    fireEvent.click(await screen.findByRole('button', { name: '定位正文：旧站台' }));
    expect(onLocate).toHaveBeenCalledWith('chapter', 'paragraph');
    old([]); await Promise.resolve();
    expect(screen.getByText('新的雨声')).toBeInTheDocument();
    expect(screen.getByText(/雨落之后 \/ 旧站台/)).toBeInTheDocument();
  });
  it('拆书工具明确后置，拒绝伪造可运行工具', () => {
    setup(); fireEvent.click(screen.getByRole('button', { name: '拆书工具' }));
    expect(screen.getByText('后续开发：本功能尚未交付')).toBeInTheDocument();
    expect(screen.getByText(/素材拆文/)).toBeInTheDocument();
  });
});
describe('知识编辑与跨作品权限', () => {
  it('卡片和编辑出处只显示可读文本，审计折叠只读，保存改动保留原始审计', async () => {
    const { source, audit } = auditedKnowledgeSource('雨夜练习'), custom = structuredClone(assets);
    custom.knowledge[0].source = source;
    const { onAction } = setup({ assets: custom });
    expect(screen.getByText('雨夜练习')).toBeVisible();
    expect(screen.queryByText(/"candidateId"/)).not.toBeInTheDocument();
    const details = screen.getByText('AI 审核记录').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getAllByRole('button', { name: '编辑知识' })[0]);
    expect(screen.getByLabelText('出处')).toHaveValue('雨夜练习');
    fireEvent.change(screen.getByLabelText('出处'), { target: { value: '作者修订出处' } });
    fireEvent.click(screen.getByRole('button', { name: '保存知识' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'updateKnowledge', id: 'a', source: `作者修订出处\n${audit}` })));
    expect(custom.knowledge[0].source).toBe(source);
  });
  it('新添知识失败保留输入和 dirty，重试成功才关闭', async () => {
    const onAction = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { onDirtyChange } = setup({ onAction });
    fireEvent.click(screen.getByRole('button', { name: '新增知识' }));
    fireEvent.change(screen.getByLabelText('知识内容'), { target: { value: '雨落在站台上。' } });
    fireEvent.change(screen.getByLabelText('出处'), { target: { value: '自己的练习' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '雨 夜' }));
    fireEvent.click(screen.getByRole('button', { name: '保存知识' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/未完成|失败/);
    expect(screen.getByLabelText('知识内容')).toHaveValue('雨落在站台上。');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '保存知识' }));
    await waitFor(() => expect(screen.queryByLabelText('知识内容')).not.toBeInTheDocument());
    expect(onAction).toHaveBeenLastCalledWith({ type: 'createKnowledge', body: '雨落在站台上。', source: '自己的练习', categoryId: 'unc', tagIds: ['rain'] });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it('删除先确认；失败留在确认框，不提前移除卡片', async () => {
    const onAction = vi.fn(async () => false); setup({ onAction });
    fireEvent.click(screen.getAllByRole('button', { name: '删除知识' })[0]);
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'deleteKnowledge', id: 'a' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('雨夜练习')).toBeInTheDocument();
  });
  it('其他作品只读并可复制，来源作者作品清楚', async () => {
    const onCopy = vi.fn(async () => true); setup({ scopeProps: { works: [], scopeId: 'other', canEdit: false, onScopeChange: vi.fn(), onCopy, entryOwners: { a: { workId: 'other', workTitle: '长夜列车' } } } });
    expect(screen.getByRole('button', { name: '新增知识' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '编辑知识' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '正文与知识' })).not.toBeInTheDocument();
    expect(screen.getByText('长夜列车')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '复制到当前作品' })[0]);
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith('a'));
  });
});
