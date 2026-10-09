// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlotWorkspace } from '../../src/renderer/components/plot-workspace';
import { KnowledgeSourceAudit } from '../../src/renderer/components/knowledge-source-audit';
import type { AssetState } from '../../src/shared/assets';
import type { WorkDetail } from '../../src/shared/contracts';
import { auditedKnowledgeSource } from './knowledge-source-helper';

afterEach(cleanup);
it('剧情关联知识的选择与已选详情均显示可读出处', () => {
  const { source } = auditedKnowledgeSource();
  const assets = { outlines: [{ id: 'plot', title: '剧情', type: 'chapter', parentId: null, summary: '', chapterId: null, knowledgeIds: ['k'], sortOrder: 0, deletedAt: null }],
    knowledge: [{ id: 'k', body: '知识摘要', source, categoryId: 'c', tagIds: [], deletedAt: null }], foreshadows: [], evidence: [] } as unknown as AssetState;
  const work = { id: 'w', title: '作品', chapters: [], volumes: [], deletedItems: [] } as unknown as WorkDetail;
  const { container } = render(<PlotWorkspace work={work} assets={assets} busy={false} onAction={vi.fn(async () => true)} onLocate={vi.fn()} />);
  expect(screen.getAllByText('作者可读出处')).toHaveLength(2);
  expect(container).not.toHaveTextContent('上下文独有秘词');
});
it('折叠审计按需显示原候选、章节版本、段落摘录和哈希，内容只读', async () => {
  const { provenance } = auditedKnowledgeSource();
  const { container } = render(<KnowledgeSourceAudit records={[provenance]} />);
  expect(screen.queryByText('候选审核原文', { exact: false })).not.toBeInTheDocument();
  const details = screen.getByText('AI 审核记录').closest('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(container).toHaveTextContent('候选审核原文'));
  expect(container).toHaveTextContent('前章 · 版本 3'); expect(container).toHaveTextContent(provenance.evidence[0].paragraphId);
  expect(container).toHaveTextContent('上下文独有秘词'); expect(container).toHaveTextContent(provenance.evidence[0].hash!);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
