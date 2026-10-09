// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WritingWorkspace, type WritingWorkspaceProps } from '../../src/renderer/components/writing-workspace';
import type { WorkDetail } from '../../src/shared/contracts';
import { emptyDocument } from '../../src/shared/document';

afterEach(cleanup);
function setup() {
  const first = crypto.randomUUID(), target = crypto.randomUUID(), plot = crypto.randomUUID();
  const document = emptyDocument();
  document.content[0].content = [{ type: 'text', text: '旧信' }, { type: 'bookmark', attrs: { id: crypto.randomUUID(), kind: 'foreshadow', targetId: target } }];
  const work: WorkDetail = { id: crypto.randomUUID(), title: '定位验收', revision: 1, volumes: [], deletedItems: [], chapters: [{ id: crypto.randomUUID(), title: '第一章', volumeId: null, wordCount: 2, document }], assets: {
    outlines: [{ id: plot, type: 'chapter', parentId: null, title: '来信', summary: '', chapterId: null, knowledgeIds: [], sortOrder: 0, deletedAt: null }],
    foreshadows: [{ id: first, name: '首条伏笔', description: '', status: '未埋设', outlineId: null, deletedAt: null }, { id: target, name: '目标伏笔', description: '原文关联', status: '已埋设', outlineId: plot, deletedAt: null }],
    evidence: [], categories: [], tags: [], knowledge: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null,
  } };
  const props: WritingWorkspaceProps = {
    work, draft: work.chapters[0], busy: false, closing: false, assetRecovery: 0, status: { phase: 'clean', error: null },
    ai: { onPrepare: async () => { throw new Error('本测试不调用云端'); }, onExecute: async () => { throw new Error('本测试不调用云端'); }, onCancel: vi.fn(), onApply: async () => false, onExtract: async () => false },
    snapshots: { onList: async () => [], onPreview: async () => { throw new Error('无快照'); }, onCreate: async () => false, onRestore: async () => false },
    changeTab: async action => { action(); return true; }, onCompositionChange: vi.fn(), onSelectChapter: vi.fn(), onAddChapter: vi.fn(), onAddVolume: vi.fn(), onSelectVolume: vi.fn(), onMenu: vi.fn(), onTitleChange: vi.fn(), onDocumentChange: vi.fn(), onRetry: vi.fn(), onReturn: vi.fn(), onError: vi.fn(), onAssetAction: async () => true, onAssetDirtyChange: vi.fn(), onLocate: vi.fn(), onExport: vi.fn(), onBackup: vi.fn(),
  };
  return { props };
}
it('正文书签经过保存门禁定位具体伏笔，伏笔可再定位所属剧情', async () => {
  const { props } = setup(); render(<WritingWorkspace {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '伏笔书签：目标伏笔' }));
  fireEvent.click(screen.getByRole('button', { name: '定位伏笔架构' }));
  expect(await screen.findByLabelText('伏笔名称')).toHaveValue('目标伏笔');
  fireEvent.click(screen.getByRole('button', { name: '定位剧情节点' }));
  expect(await screen.findByLabelText('节点名称')).toHaveValue('来信');
});
it('剧情关联列表定位目标伏笔，不切到首条伏笔', async () => {
  const { props } = setup(); render(<WritingWorkspace {...props} />);
  fireEvent.click(screen.getByRole('tab', { name: '剧情架构' }));
  fireEvent.click(await screen.findByRole('button', { name: '定位伏笔：目标伏笔' }));
  expect(await screen.findByLabelText('伏笔名称')).toHaveValue('目标伏笔');
});
it('定位保存门禁失败不切换正文、不丢失当前内容', async () => {
  const { props } = setup(); props.changeTab = async () => false;
  render(<WritingWorkspace {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '伏笔书签：目标伏笔' }));
  fireEvent.click(screen.getByRole('button', { name: '定位伏笔架构' }));
  expect(screen.getByRole('tab', { name: '正文' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('章节正文')).toHaveTextContent('旧信');
});
