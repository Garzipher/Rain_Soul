// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalReferencePanel } from '../../src/renderer/components/local-reference-panel';
import type { KnowledgeEntry } from '../../src/shared/assets';
afterEach(cleanup);
it('本作品参考明确附带学习注释，来源技术字段折叠后仍可追溯', async () => {
  const hash = 'b'.repeat(64), entry = { id: 'entry', body: '她把信折了两遍。', source: '《原创练习》；文件 SHA-256：' + hash, deletedAt: null,
    learningNotes: [{ technique: '重复动作呈现克制', usage: '重逢前', exercise: '改写折纸场景' }] } as KnowledgeEntry;
  const onRetrieve = vi.fn(async (request: { queryId: string }) => ({ queryId: request.queryId, hits: [{ workId: 'work', entryId: 'entry', reliable: true }], total: 1 }));
  render(<LocalReferencePanel workId="work" revision={1} entries={[entry]} busy={false} onRetrieve={onRetrieve as never} onSelect={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('本机参考查询'), { target: { value: '克制的情绪' } });
  fireEvent.click(screen.getByRole('button', { name: '查找写作参考' }));
  await screen.findByRole('checkbox');
  expect(screen.getByText(/选作参考时附带学习注释/)).toBeVisible();
  expect(screen.getByText('重复动作呈现克制')).toBeVisible();
  expect(screen.getByText('《原创练习》', { exact: false })).toBeVisible();
  expect(screen.queryByText(new RegExp(hash))).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('来源校验详情'));
  await waitFor(() => expect(screen.getByText(new RegExp(hash))).toBeVisible());
});
it('作者主动本机检索并勾选才采用参考，回退信息可见，修订后清除选择', async () => {
  const entry = { id: 'entry', body: '雨夜的原文描写', source: '例文', deletedAt: null };
  const onRetrieve = vi.fn(async (request: { queryId: string }) => ({ queryId: request.queryId, hits: [{ workId: 'work', entryId: 'entry', bodyHash: '', excerpt: entry.body, source: entry.source, matchedBy: ['keyword'], reliable: true }], total: 1, sourceRevisions: { work: 1 }, status: 'fallback', modelFingerprint: null, message: '模型未就绪，使用关键词' }));
  const onSelect = vi.fn();
  const props = { workId: 'work', revision: 1, entries: [entry] as never, busy: false, onRetrieve: onRetrieve as never, onSelect };
  const view = render(<LocalReferencePanel {...props} />);
  expect(onRetrieve).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('本机参考查询'), { target: { value: '雨夜' } });
  fireEvent.click(screen.getByRole('button', { name: '查找写作参考' }));
  await screen.findByText('雨夜的原文描写'); expect(onSelect).not.toHaveBeenCalledWith(['entry']);
  fireEvent.click(screen.getByRole('checkbox')); expect(onSelect).toHaveBeenLastCalledWith(['entry']);
  expect(screen.getByText('模型未就绪，使用关键词')).toBeVisible();
  view.rerender(<LocalReferencePanel {...props} revision={2} />);
  await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith([]));
});
it('重新查询失败不能继续选用上次结果，错误回执身份也不展示', async () => {
  const entry = { id: 'entry', body: '上次描写', source: '', deletedAt: null };
  const onRetrieve = vi.fn(async (request: { queryId: string }) => ({ queryId: request.queryId, hits: [{ workId: 'work', entryId: 'entry', reliable: true }], total: 1 }));
  const onSelect = vi.fn();
  render(<LocalReferencePanel workId="work" revision={1} entries={[entry] as never} busy={false} onRetrieve={onRetrieve as never} onSelect={onSelect} />);
  fireEvent.change(screen.getByLabelText('本机参考查询'), { target: { value: '描写' } });
  fireEvent.click(screen.getByRole('button', { name: '查找写作参考' })); await screen.findByRole('checkbox');
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('checkbox'));
  expect(onSelect).toHaveBeenLastCalledWith([]);
  onRetrieve.mockRejectedValueOnce('故障');
  fireEvent.click(screen.getByRole('button', { name: '查找写作参考' }));
  await screen.findByText('本机检索失败。'); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  onRetrieve.mockResolvedValueOnce({ queryId: '其他请求', hits: [{ workId: 'work', entryId: 'entry', reliable: true }], total: 1 });
  fireEvent.click(screen.getByRole('button', { name: '查找写作参考' }));
  await screen.findByText(/回执不匹配/); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('切换作品或卸载时丢弃迟到结果，不可靠、已删除和其他作品条目不得选用', async () => {
  let resolve!: (value: unknown) => void;
  const onRetrieve = vi.fn((_request: { queryId: string }) => new Promise(value => { resolve = value; })), onSelect = vi.fn();
  const props = { workId: 'work', revision: 1, entries: [{ id: 'deleted', body: '已删除', deletedAt: 'today' }] as never, busy: false, onRetrieve: onRetrieve as never, onSelect };
  const view = render(<LocalReferencePanel {...props} />);
  fireEvent.change(screen.getByLabelText('本机参考查询'), { target: { value: '描写' } });
  fireEvent.click(screen.getByRole('button', { name: '查找写作参考' }));
  view.rerender(<LocalReferencePanel {...props} workId="other" />);
  resolve({ queryId: onRetrieve.mock.calls[0]?.[0]?.queryId, hits: [], total: 0 });
  await waitFor(() => expect(screen.getByRole('button', { name: '查找写作参考' })).toBeEnabled());
  expect(screen.queryByText(/没有可靠参考/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查找写作参考' })); view.unmount(); resolve({ hits: [], total: 0 });
});
