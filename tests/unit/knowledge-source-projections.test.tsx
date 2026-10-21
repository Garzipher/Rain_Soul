// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlotWorkspace } from '../../src/renderer/components/plot-workspace';
import { KnowledgeSourceAudit, KnowledgeSourceVerification, WebSourceAudit } from '../../src/renderer/components/knowledge-source-audit';
import { freezeSource } from '../../src/main/freeze-source';
import type { AssetState } from '../../src/shared/assets';
import type { WorkDetail } from '../../src/shared/contracts';
import { auditedKnowledgeSource } from './knowledge-source-helper';

afterEach(cleanup);
it('简洁出处的完整校验信息按需展开，不混入AI审核材料', async () => {
  const hash = 'a'.repeat(64), original = `《雨夜》／听雨；第2段；文件 SHA-256：${hash}`;
  const { container } = render(<KnowledgeSourceVerification source={auditedKnowledgeSource(original).source} targetId="entry-1" />);
  expect(container).not.toHaveTextContent(hash);
  const details = screen.getByText('来源校验详情').closest('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(container).toHaveTextContent(hash));
  expect(container).toHaveTextContent('关联 ID：entry-1');
  expect(container).not.toHaveTextContent('上下文独有秘词');
});
it.each(['static', 'restricted-browser', 'legacy'] as const)('网页%s证据详情只显示捕获记录，旧来源不补造时间', method => {
  const source = freezeSource({ kind: 'web', title: '网页', rawBytes: Buffer.from('<script>秘密HTML</script>'), originalUrl: 'https://example.com/start',
    finalUrl: 'https://example.com/end', fetchedAt: '2026-10-10T00:00:00Z', segments: [{ text: '原文' }],
    ...(method === 'legacy' ? {} : { capture: method === 'static' ? { captureMethod: method, capturedAt: '2026-10-13T00:00:00Z', policyVersion: 1 }
      : { captureMethod: method, capturedAt: '2026-10-13T00:00:00Z', policyVersion: 1, renderedDomHash: 'd'.repeat(64) } }) });
  const { container } = render(<WebSourceAudit source={source} />);
  expect(container).toHaveTextContent(method === 'legacy' ? '捕获方式：未知（旧记录）' : method === 'static' ? '捕获方式：静态获取' : '捕获方式：受限浏览器');
  expect(container).toHaveTextContent(source.originalUrl!); expect(container).toHaveTextContent(source.bodyHash); expect(container).not.toHaveTextContent('秘密HTML');
  if (method === 'legacy') { expect(container).not.toHaveTextContent('捕获时间：'); expect(container).not.toHaveTextContent('政策版本：'); }
  else { expect(container).toHaveTextContent('捕获时间：2026-10-13T00:00:00Z'); expect(container).toHaveTextContent('政策版本：1'); }
  if (method === 'restricted-browser') expect(container).toHaveTextContent('渲染 DOM SHA-256：' + 'd'.repeat(64));
  else expect(container).not.toHaveTextContent('渲染 DOM SHA-256：');
});
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
